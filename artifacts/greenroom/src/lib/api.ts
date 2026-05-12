import type { ShowListRow, ShowDetail, ArtistRow, Reports, DealAnalysis } from "./types";

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
  showExport: (id: string) => get<unknown>(`/shows/${encodeURIComponent(id)}/export`),
};
