import type { ShowListRow, ShowDetail, ArtistRow, Reports, DealAnalysis, AttentionItem, InsightsPayload, LlmStatus, SaveLlmSettingsInput } from "./types";

const BASE = `${import.meta.env.BASE_URL}api`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (res.status === 404) throw new Error("not_found");
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  shows: () => get<ShowListRow[]>("/shows"),
  show: (id: string) => get<ShowDetail>(`/shows/${encodeURIComponent(id)}`),
  artists: () => get<ArtistRow[]>("/artists"),
  reports: () => get<Reports>("/reports"),
  dealAnalysis: () => get<DealAnalysis>("/deal-analysis"),
  needsAttention: () => get<AttentionItem[]>("/needs-attention"),
  insights: () => get<InsightsPayload>("/insights"),
  showExport: (id: string) => get<unknown>(`/shows/${encodeURIComponent(id)}/export`),
  llmSettings: () => get<LlmStatus>("/settings/llm"),
  saveLlmSettings: async (input: SaveLlmSettingsInput): Promise<LlmStatus> => {
    const res = await fetch(`${BASE}/settings/llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`API error ${res.status}: ${txt}`);
    }
    return res.json() as Promise<LlmStatus>;
  },
};
