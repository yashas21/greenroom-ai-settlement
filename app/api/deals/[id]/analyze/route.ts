/**
 * POST /api/deals/[id]/analyze
 *
 * Reads the deal's prose notes + structured fields, calls the Anthropic API
 * to extract terms and surface ambiguities/conflicts, then persists the result.
 *
 * [id] is the deal_id (e.g. "deal_show_0007"), not the show_id.
 *
 * Transaction semantics:
 *   - Deletes all "open" clarifications for this deal (preserves dismissed/resolved)
 *   - Inserts fresh clarifications from the model response
 *   - Updates deal.last_analyzed_at and deal.extraction_confidence
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { deals, dealClarifications } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getDealWithClarifications } from "@/lib/queries";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a deal-extraction assistant for Greenroom, software for independent music venues. Your job: read a deal description (prose notes) and surface anything that could cause a settlement dispute. The booker will review your output and accept or dismiss each flag — a flag is a query, not a verdict.

YOUR THREE JOBS:
1. EXTRACT structured terms from the prose.
2. COMPARE your extraction to the existing structured fields provided. Where they materially disagree, raise a flag with flag_type="conflict".
3. FLAG AMBIGUITIES — places where prose admits multiple readings, or references external info (emails, deal memos, phone calls) not provided. Use flag_type="ambiguity" or "missing_reference".

DEAL TYPES:
- "flat": fixed guarantee, no upside
- "vs": guarantee versus % of net, whichever greater
- "percentage_of_net": % of net, no guarantee
- "percentage_of_gross": % of gross
- "door_deal": split of door
- "walkout": artist takes incremental gross above a breakeven (often combined with vs)
- "complex": multi-tier or unusual

CONVENTIONS — apply these BEFORE flagging:
- "85/15 split" or "85/15 on net": first number is artist share by convention. Don't flag unless prose explicitly contradicts this.
- Hospitality cap is a sub-cap within the expense cap unless prose says otherwise. Don't flag the placement.
- "vs" deals: artist takes whichever is HIGHER. Don't flag the direction.

SEVERITY RUBRIC:
- HIGH: would change settlement by >$200, OR there is an explicit conflict between prose and a structured field, OR the term references external info that materially affects payout.
- MEDIUM: real but lower-dollar ambiguity, or a vague term that needs definition (e.g., "breakeven" without a basis).
- LOW: minor wording, or a term with strong convention but worth confirming.

WHY THIS MATTERS:
Last March a deal said "expenses capped at $2,500, marketing recoup of $900 against gross." Venue read the recoup as separate from cap, agent read it as inside. $720 dispute. Patterns to catch: recoups with unclear placement, bonus thresholds with unclear metric (gross? tickets? net?), splits without explicit artist share, references to external docs, renegotiations where the structured fields might be stale.

OUTPUT — respond with valid JSON only, no preamble:

{
  "extracted": {
    "deal_type": "flat" | "vs" | "percentage_of_net" | "percentage_of_gross" | "door_deal" | "walkout" | "complex",
    "guarantee_amount": number | null,
    "percentage": number | null,
    "percentage_basis": "gross" | "net_after_expenses" | null,
    "expense_cap": number | null,
    "hospitality_cap": number | null,
    "bonuses": [{"description": string, "threshold": number | null, "threshold_metric": "gross"|"tickets"|"net"|null, "amount": number | null}],
    "walkout": {"enabled": boolean, "threshold": number | null, "threshold_basis": string | null, "artist_share": number | null} | null
  },
  "flags": [
    {
      "flag_type": "conflict" | "ambiguity" | "missing_reference",
      "severity": "high" | "medium" | "low",
      "field": string,
      "issue": string,
      "extracted_value": string | null,
      "structured_value": string | null,
      "interpretation_a": string | null,
      "interpretation_b": string | null,
      "financial_impact": string,
      "recommended_clarification": string
    }
  ],
  "external_references": [string],
  "extraction_confidence": number
}`;

/** Strip markdown code fences if the model wraps its JSON in them. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: dealId } = await params;

  // 1. Fetch the deal
  const [deal] = await db
    .select()
    .from(deals)
    .where(eq(deals.id, dealId));

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  if (!deal.dealNotesFreetext) {
    return NextResponse.json(
      { error: "Deal has no prose notes to analyze" },
      { status: 422 },
    );
  }

  // 2. Build the structured fields snapshot (everything except the prose)
  const structuredFields = {
    deal_type: deal.dealType,
    guarantee_amount: deal.guaranteeAmount,
    percentage: deal.percentage,
    percentage_basis: deal.percentageBasis,
    expense_cap: deal.expenseCap,
    hospitality_cap: deal.hospitalityCap,
    bonuses_json: deal.bonusesJson ? JSON.parse(deal.bonusesJson) : null,
  };

  const userMessage = `Existing structured fields in the database:
${JSON.stringify(structuredFields, null, 2)}

Deal prose notes:
${deal.dealNotesFreetext}`;

  // 3. Call Anthropic
  let rawContent: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const block = response.content[0];
    if (block.type !== "text") {
      throw new Error("Unexpected response type from model");
    }
    rawContent = block.text;
  } catch (err) {
    console.error("[analyze] Anthropic call failed:", err);
    return NextResponse.json(
      { error: "AI analysis failed", detail: String(err) },
      { status: 502 },
    );
  }

  // 4. Parse the JSON response defensively
  let parsed: {
    extracted: Record<string, unknown>;
    flags: Array<{
      flag_type: "conflict" | "ambiguity" | "missing_reference";
      severity: "high" | "medium" | "low";
      field?: string;
      issue: string;
      extracted_value?: string | null;
      structured_value?: string | null;
      interpretation_a?: string | null;
      interpretation_b?: string | null;
      financial_impact?: string;
      recommended_clarification?: string;
    }>;
    external_references: string[];
    extraction_confidence: number;
  };

  try {
    parsed = JSON.parse(extractJson(rawContent));
  } catch {
    console.error("[analyze] JSON parse failed. Raw:", rawContent.slice(0, 500));
    return NextResponse.json(
      { error: "Model returned malformed JSON", raw: rawContent.slice(0, 500) },
      { status: 502 },
    );
  }

  // 5. Persist in a transaction
  const now = Date.now();

  await db.transaction(async (tx) => {
    // Delete only the open clarifications — preserve dismissed/resolved for audit
    const openRows = await tx
      .select({ id: dealClarifications.id })
      .from(dealClarifications)
      .where(
        and(
          eq(dealClarifications.dealId, dealId),
          eq(dealClarifications.status, "open"),
        ),
      );

    if (openRows.length > 0) {
      await tx.delete(dealClarifications).where(
        inArray(
          dealClarifications.id,
          openRows.map((r) => r.id),
        ),
      );
    }

    // Insert new clarifications
    if (parsed.flags.length > 0) {
      const rows = parsed.flags.map((flag, i) => ({
        id: `clr_${dealId}_${now}_${i}`,
        dealId,
        flagType: flag.flag_type,
        severity: flag.severity,
        field: flag.field ?? null,
        issue: flag.issue,
        extractedValue: flag.extracted_value ?? null,
        structuredValue: flag.structured_value ?? null,
        interpretationA: flag.interpretation_a ?? null,
        interpretationB: flag.interpretation_b ?? null,
        financialImpact: flag.financial_impact ?? null,
        recommendedClarification: flag.recommended_clarification ?? null,
        status: "open" as const,
        dismissalReason: null,
        createdAt: now,
        resolvedAt: null,
      }));

      await tx.insert(dealClarifications).values(rows);
    }

    // Update deal metadata
    await tx
      .update(deals)
      .set({
        lastAnalyzedAt: now,
        extractionConfidence: parsed.extraction_confidence ?? null,
      })
      .where(eq(deals.id, dealId));
  });

  // 6. Return the fresh deal + clarifications
  const result = await getDealWithClarifications(deal.showId);
  return NextResponse.json(result);
}
