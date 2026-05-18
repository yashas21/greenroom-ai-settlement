/**
 * Persisted AI clarification selections per show (`shows.readiness_answers_json`).
 */

export type ReadinessAnswersMap = Record<string, string | string[]>;

export function parseReadinessAnswersJson(
  raw: string | null | undefined
): ReadinessAnswersMap {
  if (!raw?.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: ReadinessAnswersMap = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") out[k] = val;
      else if (Array.isArray(val) && val.every((x) => typeof x === "string")) {
        out[k] = val as string[];
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function answerAsString(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? v.join(" · ") : v;
}
