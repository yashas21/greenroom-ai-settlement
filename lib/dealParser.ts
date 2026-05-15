/**
 * Deal Parser — extracts structured terms from `deal_notes_freetext`
 * and surfaces conflicts (parsed prose ≠ structured DB fields) and
 * ambiguities (the kind that cause 2am settlement fights).
 *
 * Why deterministic and not an LLM?
 *
 *   In production this is an LLM call with structured output (JSON schema
 *   coerced to `ParsedTerms`). For this case-study prototype I encoded the
 *   patterns deterministically so the demo is reproducible offline and the
 *   reviewer can see exactly what's being detected. The interface — what
 *   goes in, what comes out, what the UI does with it — is identical.
 *
 *   The ambiguity catalog below (`FlagKind`) is the substantive piece. The
 *   regex layer underneath it is a stand-in for what an LLM with the same
 *   catalog would do better.
 */

import type { Deal } from "@/db/schema";
import { parseBonuses } from "@/lib/dealMath";

// ---------- Public types ----------

export type ParsedTerms = {
  guaranteeAmount: number | null;
  percentage: number | null; // 0..1
  percentageBasis: "gross" | "net" | null;
  expenseCap: number | null;
  hospitalityCap: number | null;
  walkoutPot: { thresholdGross: number; pctAboveToArtist: number } | null;
  bonusThresholds: {
    label: string;
    metric: "gross" | "tickets";
    threshold: number;
    amount: number;
  }[];
  tierRatchets: {
    label: string;
    fromCapacityPct: number;
    toPercentage: number;
  }[];
  marketingRecoup: { amount: number; basis: "gross" | "net" | "unclear" } | null;
  referencesExternal: string[]; // phrases like "see email thread"
  driftNotes: string[]; // parenthetical updates / renegotiations
};

export type FlagKind =
  | "ambiguous_recoup_scope"
  | "structured_field_conflict"
  | "bonus_in_prose_only"
  | "walkout_pot_unsupported"
  | "tier_ratchet_unsupported"
  | "deal_drift_explicit"
  | "deal_drift_renegotiated"
  | "external_reference"
  | "missing_percentage_basis";

export type Severity = "high" | "medium" | "low";

export type Flag = {
  id: string; // stable per (dealId, kind, ordinal)
  dealId: string;
  kind: FlagKind;
  severity: Severity;
  title: string;
  message: string;
  evidence: string | null; // quoted phrase from the prose
  suggestedAction: string;
  suggestedEmail: { subject: string; body: string };
};

export type DealParseResult = {
  parsed: ParsedTerms;
  flags: Flag[];
};

// ---------- Helpers ----------

function money(s: string): number | null {
  // "$2,500" / "2500" / "2,500" / "$2.5k" / "2.5k"
  const m = s.replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)(k)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] ? n * 1000 : n;
}

function moneyRe(): string {
  // matches $2,500 / 2,500 / 2500 / $2.5k / 2.5k
  return String.raw`\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?k?|\$?\d+(?:\.\d+)?k?`;
}

function near(text: string, idx: number, span = 60): string {
  const a = Math.max(0, idx - span);
  const b = Math.min(text.length, idx + span);
  return text.slice(a, b);
}

function flagId(dealId: string, kind: FlagKind, ord = 0): string {
  return `${dealId}:${kind}:${ord}`;
}

// ---------- The parser ----------

export function parseDeal(deal: Deal): DealParseResult {
  const text = (deal.dealNotesFreetext ?? "").trim();
  const parsed: ParsedTerms = {
    guaranteeAmount: null,
    percentage: null,
    percentageBasis: null,
    expenseCap: null,
    hospitalityCap: null,
    walkoutPot: null,
    bonusThresholds: [],
    tierRatchets: [],
    marketingRecoup: null,
    referencesExternal: [],
    driftNotes: [],
  };

  if (!text) {
    return { parsed, flags: [] };
  }

  // Guarantee — "$5,000 vs", "5,433 g'tee", "$1,268 guarantee", "790 g'tee"
  const gMatch = text.match(
    new RegExp(
      String.raw`(${moneyRe()})\s*(?:guarantee|g'?tee|gtee|vs)\b`,
      "i",
    ),
  );
  if (gMatch) parsed.guaranteeAmount = money(gMatch[1]);

  // Percentage + basis — "80% of net", "85% gross", "85/15 net", "vs 90% net",
  // "90% of GROSS"
  const pctOfBasis = text.match(
    /(\d{1,3})\s*%\s*(?:of\s*)?(net|gross)/i,
  );
  if (pctOfBasis) {
    parsed.percentage = parseInt(pctOfBasis[1], 10) / 100;
    parsed.percentageBasis = pctOfBasis[2].toLowerCase() as "gross" | "net";
  } else {
    // X/Y split — "85/15 split on net" or "85/15 net". Require an explicit
    // basis word; otherwise we'd false-match dates like "3/19/25".
    const split = text.match(/(\d{2,3})\s*\/\s*(\d{1,3})\s*(?:split\s*on\s*)?(net|gross)/i);
    if (split) {
      parsed.percentage = parseInt(split[1], 10) / 100;
      parsed.percentageBasis = split[3].toLowerCase() as "gross" | "net";
    }
  }

  // Expense cap — "Expenses capped $2,500", "Expense cap 2300", "expenses to 3550"
  const expCap = text.match(
    new RegExp(
      String.raw`expense[s]?\s*(?:cap(?:ped)?|to)\s*(${moneyRe()})`,
      "i",
    ),
  );
  if (expCap) parsed.expenseCap = money(expCap[1]);

  // Hospitality cap — "Hospitality cap $400", "hosp $400", "Hospitality $500"
  const hospCap = text.match(
    new RegExp(
      String.raw`(?:hospitality|hosp\.?)\s*(?:cap)?\s*(${moneyRe()})`,
      "i",
    ),
  );
  if (hospCap) parsed.hospitalityCap = money(hospCap[1]);

  // Walkout pot — "Walkout pot: 100% of gross above $X"
  const walkout = text.match(
    new RegExp(
      String.raw`walkout\s*pot[^.]*?(\d{1,3})\s*%\s*of\s*gross\s*above\s*(${moneyRe()})`,
      "i",
    ),
  );
  if (walkout) {
    parsed.walkoutPot = {
      pctAboveToArtist: parseInt(walkout[1], 10) / 100,
      thresholdGross: money(walkout[2]) ?? 0,
    };
  } else if (/walkout\s*(pot|above)/i.test(text)) {
    // Mentioned but not parseable — still record as walkoutPot stub so the
    // "unsupported" flag fires.
    parsed.walkoutPot = { pctAboveToArtist: 1, thresholdGross: 0 };
  }

  // Bonuses — "+$1,000 bonus over $25k gross", "+$400 if gross > $11,000",
  // "+$800 if gross > $21,000"
  const bonusRe = new RegExp(
    String.raw`\+\s*(${moneyRe()})\s*(?:bonus)?\s*(?:if|over)\s*gross\s*[>≥]?\s*(${moneyRe()})`,
    "gi",
  );
  for (const m of text.matchAll(bonusRe)) {
    const amount = money(m[1]);
    const threshold = money(m[2]);
    if (amount && threshold) {
      parsed.bonusThresholds.push({
        label: m[0].trim(),
        metric: "gross",
        threshold,
        amount,
      });
    }
  }

  // Tier ratchet — "ratchets to 80% over 80% capacity", "70% net at base, ratchets to 80%"
  const ratchet = text.match(
    /ratchets?\s*to\s*(\d{1,3})\s*%[^.]*?(\d{1,3})\s*%\s*capacity/i,
  );
  if (ratchet) {
    parsed.tierRatchets.push({
      label: ratchet[0].trim(),
      toPercentage: parseInt(ratchet[1], 10) / 100,
      fromCapacityPct: parseInt(ratchet[2], 10) / 100,
    });
  } else if (/escalator|ratchet/i.test(text)) {
    parsed.tierRatchets.push({
      label: "escalator (terms in prose only)",
      toPercentage: 0,
      fromCapacityPct: 0,
    });
  }

  // Marketing recoup — "Marketing recoup of $900 against gross"
  const recoup = text.match(
    new RegExp(
      String.raw`marketing\s*recoup\s*(?:of\s*)?(${moneyRe()})(?:\s*(?:against|off|vs\.?)\s*(gross|net))?`,
      "i",
    ),
  );
  if (recoup) {
    const amount = money(recoup[1]) ?? 0;
    const basisText = (recoup[2] ?? "").toLowerCase();
    parsed.marketingRecoup = {
      amount,
      basis: basisText === "gross" || basisText === "net" ? (basisText as "gross" | "net") : "unclear",
    };
  }

  // External references
  const externalRe = /(see\s+(?:email|deal\s+memo|the\s+email|the\s+deal\s+memo)[^.;]*|per\s+the\s+deal\s+memo[^.;]*)/gi;
  for (const m of text.matchAll(externalRe)) {
    parsed.referencesExternal.push(m[1].trim());
  }

  // Drift / renegotiation notes
  const driftRe = /(\[?(?:Updated|Renegotiated|Note added)[^\]\.]*\]?[^.]*\.)/gi;
  for (const m of text.matchAll(driftRe)) {
    parsed.driftNotes.push(m[1].trim());
  }

  // ---------- Flags ----------

  const flags: Flag[] = [];

  // 1. Ambiguous marketing-recoup scope (the Coastal Spell case)
  if (parsed.marketingRecoup && parsed.expenseCap != null) {
    const insideOutsideMentioned = /\b(inside|outside|in\s+addition\s+to|separate\s+from|included\s+in|on\s+top\s+of)\b/i.test(
      text,
    );
    if (!insideOutsideMentioned) {
      const mIdx = text.toLowerCase().indexOf("marketing recoup");
      flags.push({
        id: flagId(deal.id, "ambiguous_recoup_scope"),
        dealId: deal.id,
        kind: "ambiguous_recoup_scope",
        severity: "high",
        title: "Marketing recoup — inside or outside the expense cap?",
        message:
          `The deal mentions a $${parsed.marketingRecoup.amount.toLocaleString()} marketing recoup ` +
          `and a $${parsed.expenseCap.toLocaleString()} expense cap, but doesn't say whether the recoup ` +
          `counts against the cap or sits separately. This is the exact ambiguity that drove the ` +
          `Coastal Spell dispute (March 2025, $720 concession + agent goodwill).`,
        evidence: mIdx >= 0 ? near(text, mIdx, 80).trim() : null,
        suggestedAction:
          "Email the agent now for one-line confirmation. Resolve cold, in writing, before the show.",
        suggestedEmail: {
          subject: `Quick clarification on the deal — marketing recoup vs expense cap`,
          body:
            `Hi — quick housekeeping before settlement night.\n\n` +
            `The deal has a $${parsed.expenseCap.toLocaleString()} expense cap and a ` +
            `$${parsed.marketingRecoup.amount.toLocaleString()} marketing recoup. ` +
            `Want to confirm: is the recoup INSIDE the $${parsed.expenseCap.toLocaleString()} cap, ` +
            `or in addition to it?\n\n` +
            `Either way is fine — just want one source of truth in writing so we're aligned at settlement.\n\n` +
            `Thanks,\nMariana`,
        },
      });
    }
  }

  // 2. Structured field conflicts
  const conflicts: { field: string; structured: number | string | null; parsed: number | string | null }[] = [];
  if (
    parsed.guaranteeAmount != null &&
    deal.guaranteeAmount != null &&
    Math.abs(parsed.guaranteeAmount - deal.guaranteeAmount) > 1
  ) {
    conflicts.push({ field: "Guarantee", structured: deal.guaranteeAmount, parsed: parsed.guaranteeAmount });
  }
  if (
    parsed.percentage != null &&
    deal.percentage != null &&
    Math.abs(parsed.percentage - deal.percentage) > 0.001
  ) {
    conflicts.push({
      field: "Percentage",
      structured: `${(deal.percentage * 100).toFixed(0)}%`,
      parsed: `${(parsed.percentage * 100).toFixed(0)}%`,
    });
  }
  if (
    parsed.percentageBasis &&
    deal.percentageBasis &&
    parsed.percentageBasis !== deal.percentageBasis
  ) {
    conflicts.push({ field: "Basis", structured: deal.percentageBasis, parsed: parsed.percentageBasis });
  }
  if (
    parsed.expenseCap != null &&
    deal.expenseCap != null &&
    Math.abs(parsed.expenseCap - deal.expenseCap) > 1
  ) {
    conflicts.push({ field: "Expense cap", structured: deal.expenseCap, parsed: parsed.expenseCap });
  }
  if (
    parsed.hospitalityCap != null &&
    deal.hospitalityCap != null &&
    Math.abs(parsed.hospitalityCap - deal.hospitalityCap) > 1
  ) {
    conflicts.push({ field: "Hospitality cap", structured: deal.hospitalityCap, parsed: parsed.hospitalityCap });
  }
  // Bonus threshold drift — compare structured bonuses_json against parsed bonus thresholds
  const structuredBonuses = parseBonuses(deal);
  for (const pb of parsed.bonusThresholds) {
    const sb = structuredBonuses.find(
      (b) => b.type === "gross_threshold" && Math.abs(b.amount - pb.amount) < 1,
    );
    if (sb && sb.type === "gross_threshold" && Math.abs(sb.threshold - pb.threshold) > 1) {
      conflicts.push({
        field: `Bonus threshold (+$${pb.amount.toLocaleString()})`,
        structured: `gross > $${sb.threshold.toLocaleString()}`,
        parsed: `gross > $${pb.threshold.toLocaleString()}`,
      });
    }
  }

  conflicts.forEach((c, i) => {
    flags.push({
      id: flagId(deal.id, "structured_field_conflict", i),
      dealId: deal.id,
      kind: "structured_field_conflict",
      severity: "high",
      title: `${c.field}: structured ≠ prose`,
      message:
        `The structured field says ${c.structured}. The deal notes say ${c.parsed}. ` +
        `Pick one — the in-app settlement tool reads structured; Mariana trusts the prose. ` +
        `If they disagree, the 2am math will too.`,
      evidence: null,
      suggestedAction: "Update the structured field to match the prose (or vice-versa).",
      suggestedEmail: {
        subject: `Confirming the ${c.field.toLowerCase()} on the deal`,
        body:
          `Hi — looking at our records for this show. We have two readings of the ${c.field.toLowerCase()}:\n\n` +
          `• Structured: ${c.structured}\n• Deal notes: ${c.parsed}\n\n` +
          `Can you confirm which is canonical? I'll update on our end.\n\nThanks.`,
      },
    });
  });

  // 3. Bonus in prose only — bonus shape mentioned but bonusesJson empty
  if (parsed.bonusThresholds.length > 0 && structuredBonuses.length === 0) {
    flags.push({
      id: flagId(deal.id, "bonus_in_prose_only"),
      dealId: deal.id,
      kind: "bonus_in_prose_only",
      severity: "medium",
      title: "Bonuses are in prose only — settlement tool can't see them",
      message:
        `Found ${parsed.bonusThresholds.length} bonus threshold(s) in the deal notes, but ` +
        `the structured \`bonuses_json\` field is empty. The in-app settlement tool only reads ` +
        `structured bonuses — these will be invisible at settlement unless someone remembers them.`,
      evidence: parsed.bonusThresholds.map((b) => b.label).join(" · "),
      suggestedAction: "Promote prose bonuses into the structured field (one click).",
      suggestedEmail: {
        subject: ``,
        body: ``,
      },
    });
  }

  // 4. Walkout pot — schema doesn't model it
  if (parsed.walkoutPot) {
    flags.push({
      id: flagId(deal.id, "walkout_pot_unsupported"),
      dealId: deal.id,
      kind: "walkout_pot_unsupported",
      severity: "medium",
      title: "Walkout pot present — not modelled by the in-app tool",
      message:
        `This deal has a walkout pot (incremental gross above breakeven flows to the artist). ` +
        `The current settlement engine has no representation for walkout pots, so this term will ` +
        `live in the prose only. Plan to settle this one in the spreadsheet — or build it into the engine.`,
      evidence:
        parsed.walkoutPot.thresholdGross > 0
          ? `${(parsed.walkoutPot.pctAboveToArtist * 100).toFixed(0)}% above $${parsed.walkoutPot.thresholdGross.toLocaleString()}`
          : "walkout terms in prose",
      suggestedAction: "Flag to GM. Settle in the spreadsheet for now.",
      suggestedEmail: { subject: "", body: "" },
    });
  }

  // 5. Tier ratchet
  if (parsed.tierRatchets.length > 0) {
    flags.push({
      id: flagId(deal.id, "tier_ratchet_unsupported"),
      dealId: deal.id,
      kind: "tier_ratchet_unsupported",
      severity: "medium",
      title: "Tier ratchet present — engine treats this as a flat percentage",
      message:
        `Deal has an escalator/ratchet that changes the percentage based on attendance. ` +
        `The current engine applies a single percentage. The artist may be owed more than the ` +
        `app calculates if the ratchet triggers.`,
      evidence: parsed.tierRatchets.map((t) => t.label).join(" · "),
      suggestedAction: "Calculate ratchet manually and override final number.",
      suggestedEmail: { subject: "", body: "" },
    });
  }

  // 6. Drift — explicit confirmation in the prose ("structured field still reflects...")
  if (/structured\s+field\s+still\s+reflects|confirm\s+before\s+settlement/i.test(text)) {
    flags.push({
      id: flagId(deal.id, "deal_drift_explicit"),
      dealId: deal.id,
      kind: "deal_drift_explicit",
      severity: "high",
      title: "Deal notes explicitly say the structured fields are stale",
      message:
        `Whoever updated the deal flagged that the structured fields don't reflect the latest terms. ` +
        `The settlement tool will use the structured (stale) values unless someone fixes them.`,
      evidence: parsed.driftNotes[0] ?? null,
      suggestedAction: "Reconcile structured fields with the prose. Then mark resolved.",
      suggestedEmail: { subject: "", body: "" },
    });
  } else if (parsed.driftNotes.some((n) => /renegotiated|updated/i.test(n))) {
    flags.push({
      id: flagId(deal.id, "deal_drift_renegotiated"),
      dealId: deal.id,
      kind: "deal_drift_renegotiated",
      severity: "low",
      title: "Deal was renegotiated — double-check structured fields",
      message:
        `Deal notes mention a renegotiation or post-hoc update. Worth a quick eyeball to make ` +
        `sure structured fields reflect the most recent terms.`,
      evidence: parsed.driftNotes[0] ?? null,
      suggestedAction: "Eyeball the structured fields against the latest prose.",
      suggestedEmail: { subject: "", body: "" },
    });
  }

  // 7. External references — "see email thread"
  if (parsed.referencesExternal.length > 0) {
    flags.push({
      id: flagId(deal.id, "external_reference"),
      dealId: deal.id,
      kind: "external_reference",
      severity: "medium",
      title: "Deal points to information that lives outside the system",
      message:
        `The deal references material in another email/document (e.g. "see email thread"). ` +
        `That information isn't in Greenroom. At 2am, you won't have time to dig it up.`,
      evidence: parsed.referencesExternal.join(" · "),
      suggestedAction:
        "Pull the referenced terms into the deal notes now, while you have the email open.",
      suggestedEmail: { subject: "", body: "" },
    });
  }

  // 8. % present but no basis specified
  if (parsed.percentage != null && !parsed.percentageBasis && !deal.percentageBasis) {
    flags.push({
      id: flagId(deal.id, "missing_percentage_basis"),
      dealId: deal.id,
      kind: "missing_percentage_basis",
      severity: "medium",
      title: "Percentage given but no basis (gross vs net)",
      message:
        `The deal has a percentage but doesn't say whether it's of gross or net. The difference ` +
        `is usually thousands of dollars on a sold-out vs deal.`,
      evidence: null,
      suggestedAction: "Confirm with the agent before show day.",
      suggestedEmail: {
        subject: "Confirming basis on the deal — gross or net?",
        body:
          `Hi — small thing: the deal has a percentage but doesn't specify gross vs net. ` +
          `Can you confirm which? Want to make sure we're aligned before settlement.\n\nThanks.`,
      },
    });
  }

  // Sort: high → medium → low
  const sevRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  return { parsed, flags };
}

export const FLAG_LABELS: Record<FlagKind, string> = {
  ambiguous_recoup_scope: "Recoup scope ambiguity",
  structured_field_conflict: "Structured ≠ prose",
  bonus_in_prose_only: "Unstructured bonus",
  walkout_pot_unsupported: "Unsupported: walkout pot",
  tier_ratchet_unsupported: "Unsupported: tier ratchet",
  deal_drift_explicit: "Stale structured fields",
  deal_drift_renegotiated: "Renegotiated deal",
  external_reference: "Off-system reference",
  missing_percentage_basis: "Missing basis",
};
