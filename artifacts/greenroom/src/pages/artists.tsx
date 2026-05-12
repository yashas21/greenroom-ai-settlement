import { useMemo, useState } from "react";
import { AlertTriangle, ThumbsUp, ThumbsDown } from "lucide-react";
import { api } from "@/lib/api";
import { formatShowDate } from "@/lib/format";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import type { ArtistRow } from "@/lib/types";

const GENRE_COLORS: Record<string, string> = {
  indie: "bg-brand-500",
  rock: "bg-rose-500",
  folk: "bg-amber-600",
  "singer-songwriter": "bg-amber-500",
  americana: "bg-amber-700",
  "alt-country": "bg-amber-600",
  jazz: "bg-sky-600",
  blues: "bg-sky-700",
  soul: "bg-amber-800",
  "r&b": "bg-rose-600",
  pop: "bg-rose-400",
  electronic: "bg-sky-500",
  punk: "bg-ink-700",
  metal: "bg-ink-800",
  hip_hop: "bg-ink-600",
  country: "bg-amber-500",
  bluegrass: "bg-brand-600",
  experimental: "bg-ink-500",
};

function genreColor(genre: string | null): string {
  if (!genre) return "bg-ink-300";
  const lower = genre.toLowerCase().replace(/[\s-]/g, "_");
  for (const [key, color] of Object.entries(GENRE_COLORS)) {
    if (lower.includes(key.replace(/[\s-]/g, "_"))) return color;
  }
  return "bg-ink-400";
}

const DEAL_LABELS: Record<string, string> = {
  flat: "Flat",
  percentage_of_gross: "% gross",
  percentage_of_net: "% net",
  vs: "Vs deal",
  door: "Door",
};

const DEAL_FILTER_OPTIONS = ["all", "flat", "percentage_of_gross", "percentage_of_net", "vs", "door"];

function attentionTone(n: number): { card: string; chip: string } {
  if (n === 0)
    return { card: "border-ink-200/60 hover:border-ink-200", chip: "" };
  if (n <= 2)
    return {
      card: "border-amber-300/70 hover:border-amber-400 bg-amber-50/30",
      chip: "bg-amber-100 text-amber-800 ring-amber-200",
    };
  return {
    card: "border-rose-300/70 hover:border-rose-400 bg-rose-50/30",
    chip: "bg-rose-100 text-rose-800 ring-rose-200",
  };
}

export default function ArtistsPage() {
  const state = useApiData(() => api.artists(), []);
  const [dealFilter, setDealFilter] = useState<string>("all");

  const data = state.status === "ready" ? state.data : null;
  const withShows = useMemo(() => {
    if (!data) return [];
    return data
      .map((r) => ({ ...r, showCount: Number(r.showCount) }))
      .filter((r) => r.showCount > 0);
  }, [data]);
  const filtered = useMemo(() => {
    if (dealFilter === "all") return withShows;
    return withShows.filter((r) => r.dealTypes.some((d) => d.dealType === dealFilter));
  }, [withShows, dealFilter]);

  if (state.status === "loading") return <LoadingState label="Loading artists..." />;
  if (state.status === "error") return <LoadingState label={`Error: ${state.error.message}`} />;

  const buckets = {
    frequent: filtered.filter((r) => r.showCount >= 4),
    regular: filtered.filter((r) => r.showCount >= 2 && r.showCount < 4),
    occasional: filtered.filter((r) => r.showCount === 1),
  };

  return (
    <div className="px-12 py-10 max-w-7xl">
      <div className="mb-10">
        <div className="eyebrow mb-3">Roster</div>
        <h1
          className="font-display text-[48px] font-medium text-ink-900 leading-[1.05]"
          style={{ letterSpacing: "-0.02em", fontOpticalSizing: "auto" }}
        >
          Artists
        </h1>
        <p className="text-[14px] text-ink-500 mt-3 max-w-xl leading-relaxed">
          {filtered.length} of {withShows.length} artists who have played The Crescent
          in the last 24 months. Bucketed by frequency.
        </p>
      </div>

      <div className="mb-8 flex items-center gap-2 flex-wrap">
        <span className="eyebrow text-[10px] text-ink-500 mr-1">Deal type</span>
        {DEAL_FILTER_OPTIONS.map((dt) => {
          const active = dealFilter === dt;
          const count =
            dt === "all"
              ? withShows.length
              : withShows.filter((r) => r.dealTypes.some((d) => d.dealType === dt)).length;
          return (
            <button
              key={dt}
              onClick={() => setDealFilter(dt)}
              className={`px-2.5 py-1 rounded-full text-[11px] ring-1 transition-colors ${
                active
                  ? "bg-ink-900 text-white ring-ink-900"
                  : "bg-white text-ink-600 ring-ink-200 hover:ring-ink-300"
              }`}
            >
              {dt === "all" ? "All" : DEAL_LABELS[dt] ?? dt}
              <span
                className={`ml-1.5 font-mono tabular text-[10px] ${
                  active ? "text-white/70" : "text-ink-400"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-16">
        <Bucket title="Frequent" subtitle="4+ shows in the window" rows={buckets.frequent} />
        <Bucket title="Regular" subtitle="2–3 shows in the window" rows={buckets.regular} />
        <Bucket title="Occasional" subtitle="1 show" rows={buckets.occasional} />
      </div>
    </div>
  );
}

function Bucket({
  title, subtitle, rows,
}: { title: string; subtitle: string; rows: ArtistRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="flex items-baseline justify-between mb-5">
        <h2
          className="font-display text-[24px] font-medium text-ink-900"
          style={{ letterSpacing: "-0.02em" }}
        >
          {title}{" "}
          <span className="text-ink-300 font-sans text-[14px] font-normal">
            ({rows.length})
          </span>
        </h2>
        <span className="text-[12px] text-ink-400">{subtitle}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((row) => <ArtistCard key={row.artist.id} row={row} />)}
      </div>
    </section>
  );
}

function ArtistCard({ row }: { row: ArtistRow }) {
  const { artist, agent, agency, showCount, lastShowDate, topDealType, topPositive, topNegative, attentionCount } = row;
  const tone = attentionTone(attentionCount);

  return (
    <div
      className={`group relative rounded-lg border bg-white p-5 transition-all duration-150 hover:shadow-[0_4px_16px_rgba(26,24,20,0.06)] hover:-translate-y-0.5 ${tone.card}`}
    >
      <div className={`absolute top-4 right-4 w-2 h-2 rounded-full ${genreColor(artist.genre)} opacity-60`} />
      <div className="text-[15px] font-medium text-ink-900 group-hover:text-brand-800 transition-colors leading-tight pr-5">
        {artist.name}
      </div>
      <div className="text-[11.5px] text-ink-400 capitalize mt-0.5">
        {artist.genre ?? "—"}
      </div>

      <div className="flex items-center gap-1.5 mt-3 flex-wrap">
        <div className="flex gap-[3px]">
          {Array.from({ length: Math.min(showCount, 8) }).map((_, i) => (
            <div
              key={i}
              className={`w-[5px] h-[5px] rounded-full ${genreColor(artist.genre)}`}
            />
          ))}
          {showCount > 8 && (
            <span className="text-[9px] text-ink-400 ml-0.5">+{showCount - 8}</span>
          )}
        </div>
        <span className="text-[11px] font-mono tabular text-ink-500 ml-1">
          {showCount} {showCount === 1 ? "show" : "shows"}
        </span>
        {topDealType && (
          <span className="ml-1 px-1.5 py-0.5 rounded bg-ink-50 text-ink-600 text-[10px] ring-1 ring-ink-200/70">
            {DEAL_LABELS[topDealType] ?? topDealType}
          </span>
        )}
        {attentionCount > 0 && (
          <span
            className={`ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ring-1 ${tone.chip}`}
            title={`${attentionCount} needs-attention flag${attentionCount === 1 ? "" : "s"}`}
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            <span className="font-mono tabular">{attentionCount}</span>
          </span>
        )}
      </div>

      {(topPositive || topNegative) && (
        <div className="mt-3 flex flex-col gap-1.5">
          {topPositive && (
            <div className="flex items-start gap-1.5 text-[11px] leading-snug">
              <ThumbsUp className="h-3 w-3 text-emerald-600 shrink-0 mt-[2px]" />
              <span className="text-ink-700">{topPositive}</span>
            </div>
          )}
          {topNegative && (
            <div className="flex items-start gap-1.5 text-[11px] leading-snug">
              <ThumbsDown className="h-3 w-3 text-rose-600 shrink-0 mt-[2px]" />
              <span className="text-ink-700">{topNegative}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-ink-100/60">
        <div className="text-[11px] text-ink-500 truncate pr-2">
          {agent ? (
            <>
              {agent.name}
              {agency && <span className="text-ink-400"> · {agency.name}</span>}
            </>
          ) : (
            <span className="text-ink-300">No agent</span>
          )}
        </div>
        {lastShowDate && (
          <div className="text-[10.5px] font-mono tabular text-ink-400 shrink-0">
            {formatShowDate(lastShowDate)}
          </div>
        )}
      </div>
    </div>
  );
}
