import { AIClient, type AIRequestOptions } from "@/lib/AIClient";

const dealAmbiguityAI = new AIClient();

const DEAL_AMBIGUITY_SYSTEM_PROMPT = `You are an experienced live music settlement operator helping generate a settlement readiness review for venue bookers.

Your job is NOT to predict disputes and NOT to fully calculate settlements.

Your job is to:

1. Read messy free-text deal notes
2. Detect payout-impacting interpretation gaps
3. Generate clarification questions ONLY when payout logic may change
4. Return structured JSON output for a settlement worksheet setup flow

Important rules:

* Do NOT hallucinate missing deal terms
* Do NOT assume disputes
* Do NOT overflag ambiguity
* Most deals should be low review
* Only ask questions if settlement interpretation could materially affect payout calculations
* Keep the tone operational and calm
* Do NOT ask about hospitality handling or generic expense categories
* Focus ONLY on payout-impacting ambiguity

Examples of payout-impacting ambiguity:

* gross vs net ordering
* marketing recoup treatment
* walkout payout logic
* threshold interpretation
* conflicting settlement structures
* external settlement modifications
* off-system updates via phone/email
* undefined breakeven handling

Distinguish between:

* straightforward structure
* review suggested
* interpretation review required

Return ONLY valid JSON.

JSON shape (use real values — reviewLevel must be exactly one of "low", "medium", or "high"):

{
  "reviewLevel": "low",
  "summary": [
    "short operational summaries"
  ],
  "reviewSignals": [
    {
      "severity": "medium",
      "title": "string",
      "reason": "string"
    }
  ],
  "clarificationQuestions": [
    {
      "id": "string",
      "question": "string",
      "type": "single_select",
      "options": [
        "option 1",
        "option 2"
      ]
    }
  ]
}

If there are no signals or questions yet, use empty arrays: "reviewSignals": [], "clarificationQuestions": [].

Use stable snake_case id values for each clarification question (e.g. marketing_recoup_timing, walkout_payout_basis) so selections can be saved and replayed in tooling.

Guidelines for review levels:

LOW:

* straightforward settlement structure
* no conflicting payout logic
* no external references
* no undefined ordering concerns

MEDIUM:

* walkout structures
* ratchets
* breakeven references
* threshold-based payout logic

HIGH:

* gross + net overlap
* marketing recoup ambiguity
* external memo references
* phone/email modifications
* conflicting thresholds
* structured field drift
* unclear deduction ordering
* explicit interpretation concerns

Examples:

If notes mention:

* "marketing"
* "recoup"

You may ask:
"Should marketing recoup apply before or after artist split calculations?"

Options:

* Before split
* After split

If notes mention:

* "gross"
  AND
* "net"

Generate a high review signal about payout ordering ambiguity.

If notes mention:

* "walkout"
  You may ask:
  "Should walkout payouts apply after breakeven or after artist guarantee recovery?"

Options:

* After breakeven
* After guarantee recovery

If notes mention:

* "updated via email"
* "phone call"
  Generate a high review signal about off-system settlement modifications.

If notes mention:

* "see email thread"
  Generate a medium or high review signal depending on whether payout logic appears incomplete.

Do not ask unnecessary questions for simple deterministic deals.

Now analyze the following deal notes:

{{DEAL_NOTES}}`;

export type DealAmbiguityReviewLevel = "low" | "medium" | "high";

export type DealAmbiguityReviewSignal = {
  severity: DealAmbiguityReviewLevel;
  title: string;
  reason: string;
};

export type DealAmbiguityClarificationQuestion = {
  id: string;
  question: string;
  type: "single_select" | "multi_select";
  options: string[];
};

export type DealAmbiguityReview = {
  reviewLevel: DealAmbiguityReviewLevel;
  summary: string[];
  reviewSignals: DealAmbiguityReviewSignal[];
  clarificationQuestions: DealAmbiguityClarificationQuestion[];
};

function buildDealAmbiguityPrompt(dealNotes: string): string {
  return DEAL_AMBIGUITY_SYSTEM_PROMPT.replace("{{DEAL_NOTES}}", dealNotes);
}

function parseAIJsonPayload(aiRaw: string): unknown {
  const trimmed = aiRaw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im.exec(trimmed);
  const jsonText = fence ? fence[1].trim() : trimmed;
  return JSON.parse(jsonText) as unknown;
}

function normalizeReviewLevel(raw: unknown): DealAmbiguityReviewLevel | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return null;
}

function sanitizeSummary(input: unknown): string[] {
  if (typeof input === "string" && input.trim()) return [input.trim()];
  if (!Array.isArray(input)) return [];
  return input.filter((s): s is string => typeof s === "string");
}

function sanitizeReviewSignals(input: unknown): DealAmbiguityReviewSignal[] {
  if (!Array.isArray(input)) return [];
  const out: DealAmbiguityReviewSignal[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const sev = normalizeReviewLevel(r.severity);
    if (!sev) continue;
    if (typeof r.title !== "string" || typeof r.reason !== "string") continue;
    out.push({ severity: sev, title: r.title, reason: r.reason });
  }
  return out;
}

function sanitizeClarificationQuestions(
  input: unknown
): DealAmbiguityClarificationQuestion[] {
  if (!Array.isArray(input)) return [];
  const out: DealAmbiguityClarificationQuestion[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const q = row as Record<string, unknown>;
    if (typeof q.id !== "string" || typeof q.question !== "string") continue;
    const typeRaw = q.type;
    const type: "single_select" | "multi_select" =
      typeRaw === "multi_select" ? "multi_select" : "single_select";
    const optsRaw = Array.isArray(q.options) ? q.options : [];
    const options = optsRaw.map((opt) =>
      typeof opt === "string" ? opt : String(opt)
    );
    if (options.length === 0) continue;
    out.push({
      id: q.id,
      question: q.question,
      type,
      options,
    });
  }
  return out;
}

function parseDealAmbiguityReviewFromAiPayload(
  value: unknown
): DealAmbiguityReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI response root was not a JSON object");
  }
  const o = value as Record<string, unknown>;
  const reviewLevel = normalizeReviewLevel(o.reviewLevel);
  if (!reviewLevel) {
    throw new Error(
      `AI response: reviewLevel must be "low", "medium", or "high" (got ${JSON.stringify(o.reviewLevel)})`
    );
  }
  return {
    reviewLevel,
    summary: sanitizeSummary(o.summary),
    reviewSignals: sanitizeReviewSignals(o.reviewSignals),
    clarificationQuestions: sanitizeClarificationQuestions(
      o.clarificationQuestions
    ),
  };
}

/**
 * Sends deal notes to the AI and returns the settlement readiness JSON.
 * Run on the server only (same constraints as {@link AIClient}).
 */
export async function checkDealNotesAmbiguity(
  dealNotes: string,
  aiOptions?: AIRequestOptions
): Promise<DealAmbiguityReview> {
  const aiPrompt = buildDealAmbiguityPrompt(dealNotes);
  const aiRaw = await dealAmbiguityAI.completeAI(aiPrompt, aiOptions);
  let parsed: unknown;
  try {
    parsed = parseAIJsonPayload(aiRaw);
  } catch {
    throw new Error("AI response was not valid JSON");
  }
  return parseDealAmbiguityReviewFromAiPayload(parsed);
}
