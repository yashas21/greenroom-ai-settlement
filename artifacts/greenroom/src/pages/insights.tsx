import { useLocation } from "wouter";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import type { InsightsCell, AttentionKind } from "@/lib/types";

const DEAL_LABELS: Record<string, string> = {
  flat: "Flat",
  percentage_of_gross: "% of gross",
  percentage_of_net: "% of net",
  vs: "Vs deal",
  door: "Door deal",
};

const KIND_LABEL: Record<AttentionKind, string> = {
  stale_disputed: "Stale dispute",
  disputed_recoups_but_signed: "Disputed recoup",
  show_settled_no_settlement: "Missing settlement",
  notes_say_closed_but_status_open: "Notes vs status",
};

const KIND_TONE: Record<AttentionKind, { bg: string; fg: string; ring: string }> = {
  stale_disputed: { bg: "bg-sky-50", fg: "text-sky-700", ring: "ring-sky-200" },
  disputed_recoups_but_signed: { bg: "bg-rose-50", fg: "text-rose-700", ring: "ring-rose-200" },
  show_settled_no_settlement: { bg: "bg-amber-50", fg: "text-amber-700", ring: "ring-amber-200" },
  notes_say_closed_but_status_open: { bg: "bg-amber-50", fg: "text-amber-700", ring: "ring-amber-200" },
};

export default function InsightsPage() {
  const state = useApiData(() => api.insights(), []);

  if (state.status === "loading")
    return (
      <LoadingState label="Clustering complaint themes... this can take a minute on first load." />
    );
  if (state.status === "error")
    return <LoadingState label={`Error: ${state.error.message}`} />;

  const data = state.data;
  const activeBuckets = data.buckets.filter((b) =>
    data.cells.some((c) => c.bucket === b),
  );
  const cellByKey = new Map(
    data.cells.map((c) => [`${c.dealType}|${c.bucket}`, c]),
  );

  const coverage = data.enrichmentCoverage;
  const coveragePct = coverage.total > 0
    ? Math.round((coverage.withSummary / coverage.total) * 100)
    : 0;

  return (
    <section className="px-12 py-10 max-w-[1280px]">
      <div className="eyebrow text-[10px] text-brand-700 mb-2">
        Deal anatomy · qualitative
      </div>
      <h1 className="text-4xl font-serif text-ink-900 mb-2 tracking-tight">
        Insights
      </h1>
      <p className="text-[14px] text-ink-600 max-w-2xl mb-1 leading-relaxed">
        Same Deal type × deal size grid as Deal Analysis, but each cell
        names the dominant friction kind for those deals and clusters the
        actual recurring complaints behind it.
      </p>
      <p className="text-[12px] text-ink-400 mb-8">
        Per-deal positive/negative summaries from <span className="font-mono tabular">{coverage.withSummary}</span> of{" "}
        <span className="font-mono tabular">{coverage.total}</span> settlements ({coveragePct}%) — call{" "}
        <code className="text-[11px] bg-ink-50 px-1 py-0.5 rounded">POST /api/insights/enrich</code>{" "}
        to extend coverage.
      </p>

      <Card>
        <CardContent>
          <div className="flex items-baseline justify-between mb-5">
            <div className="eyebrow text-[10px] text-ink-500">
              Top friction kind · top 5 complaint themes
            </div>
            <div className="text-[10px] text-ink-400 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-violet-500" />
              themes clustered by Anthropic
            </div>
          </div>

          <table className="w-full text-[12px] border-separate border-spacing-y-2">
            <thead>
              <tr className="text-left">
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold pr-3 align-bottom">
                  Deal type
                </th>
                {activeBuckets.map((b) => (
                  <th
                    key={b}
                    className="py-2 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-left align-bottom"
                  >
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.dealTypes.map((dt) => (
                <tr key={dt} className="align-top">
                  <td className="py-2 pr-3 align-top w-[110px]">
                    <div className="text-ink-900 font-medium text-[12px] leading-tight pt-2">
                      {DEAL_LABELS[dt] ?? dt}
                    </div>
                  </td>
                  {activeBuckets.map((b) => (
                    <td key={b} className="px-1.5 align-top">
                      <CellBox cell={cellByKey.get(`${dt}|${b}`) ?? null} dt={dt} bucket={b} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}

function CellBox({
  cell,
  dt,
  bucket,
}: {
  cell: InsightsCell | null;
  dt: string;
  bucket: string;
}) {
  const [, setLocation] = useLocation();
  if (!cell) {
    return (
      <div className="h-full min-h-[140px] flex items-center justify-center text-ink-300 text-[10px] font-mono">
        —
      </div>
    );
  }
  const tone = cell.topKind ? KIND_TONE[cell.topKind] : null;
  const params = new URLSearchParams({ dealType: dt, size: bucket });

  return (
    <div className="rounded-md ring-1 ring-ink-200/50 bg-white p-2.5 min-h-[140px] flex flex-col gap-2">
      <div className="flex items-center justify-between text-[10px] font-mono tabular text-ink-400">
        <span>n={cell.count}</span>
        <span
          className="cursor-pointer hover:text-brand-700 underline-offset-2 hover:underline"
          onClick={() => setLocation(`/shows?${params.toString()}`)}
        >
          {cell.attentionCount} flagged
        </span>
      </div>

      {cell.topKind && tone ? (
        <div
          className={`px-2 py-1 rounded ${tone.bg} ${tone.fg} ring-1 ${tone.ring} text-[10.5px] font-medium leading-tight flex items-center justify-between`}
        >
          <span>{KIND_LABEL[cell.topKind]}</span>
          <span className="font-mono tabular ml-1.5">{cell.topKindCount}</span>
        </div>
      ) : (
        <div className="px-2 py-1 rounded bg-ink-50 text-ink-400 text-[10.5px] italic">
          no flags
        </div>
      )}

      <div className="flex flex-col gap-1">
        {cell.bubbles.length === 0 ? (
          <div className="text-[10px] text-ink-400 italic leading-tight">
            {cell.topKind && cell.topKindCount > 0
              ? cell.sampleSize === 0
                ? "no enriched summaries yet"
                : "no themes extracted"
              : "no complaints to cluster"}
          </div>
        ) : (
          cell.bubbles.map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-1 text-[10.5px] leading-tight"
              title={b.theme}
            >
              <span className="text-ink-700 truncate">{b.theme}</span>
              <span className="font-mono tabular text-ink-400 shrink-0">
                ×{b.count}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
