import { useState, useMemo } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Search, Calendar } from "lucide-react";
import { DealTypeBadge, PlainBadge } from "@/components/ui/badge";

type Status = "booked" | "advanced" | "day_of" | "settled" | "closed";

export type ShowRow = {
  show: { id: string; status: Status };
  artist: { name: string } | null;
  deal: { dealType: string; guaranteeFormatted: string | null } | null;
  settlement: { totalFormatted: string | null; status: string } | null;
  dateFormatted: string;
  dateRelative: string;
  month: string;
  isUnsupported: boolean;
  isDisputed: boolean;
};

const lifecycleStatusVariants: Record<
  string,
  { variant: "default" | "amber" | "brand" | "rose" | "sky"; label: string }
> = {
  draft: { variant: "default", label: "Draft" },
  submitted: { variant: "sky", label: "Submitted" },
  in_review: { variant: "sky", label: "In review" },
  signed: { variant: "brand", label: "Signed" },
  disputed: { variant: "rose", label: "Disputed" },
  revised: { variant: "amber", label: "Revised" },
  finalized: { variant: "brand", label: "Finalized" },
  paid: { variant: "brand", label: "Paid" },
  voided: { variant: "default", label: "Voided" },
};

function getAccentColor(row: ShowRow): string {
  if (row.settlement) {
    const s = row.settlement.status;
    if (s === "paid" || s === "finalized" || s === "signed") return "bg-brand-500";
    if (s === "disputed") return "bg-rose-500";
    if (s === "revised") return "bg-amber-500";
    if (s === "submitted" || s === "in_review") return "bg-sky-400";
    return "bg-ink-300";
  }
  return "bg-ink-200";
}

function groupByMonth(rows: ShowRow[]): { month: string; rows: ShowRow[] }[] {
  const groups: Map<string, ShowRow[]> = new Map();
  for (const row of rows) {
    if (!groups.has(row.month)) groups.set(row.month, []);
    groups.get(row.month)!.push(row);
  }
  return Array.from(groups.entries()).map(([month, rows]) => ({ month, rows }));
}

export function ShowsList({ rows }: { rows: ShowRow[] }) {
  const [query, setQuery] = useState("");
  const [unsupportedOnly, setUnsupportedOnly] = useState(false);
  const [disputedOnly, setDisputedOnly] = useState(false);

  const unsupportedCount = useMemo(() => rows.filter((r) => r.isUnsupported).length, [rows]);
  const disputedCount = useMemo(() => rows.filter((r) => r.isDisputed).length, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (unsupportedOnly) out = out.filter((r) => r.isUnsupported);
    if (disputedOnly) out = out.filter((r) => r.isDisputed);
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter(
        (r) =>
          r.artist?.name.toLowerCase().includes(q) ||
          r.deal?.dealType.toLowerCase().includes(q) ||
          r.dateFormatted.toLowerCase().includes(q),
      );
    }
    return out;
  }, [rows, query, unsupportedOnly, disputedOnly]);

  const months = useMemo(() => groupByMonth(filtered), [filtered]);

  return (
    <div>
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search artists, deals…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64 pl-9 pr-3 py-2 text-[13px] bg-white border border-ink-200/60 rounded-lg text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-700/20 focus:border-brand-300 transition-all"
          />
        </div>
        <FilterToggle
          active={unsupportedOnly}
          onClick={() => setUnsupportedOnly((v) => !v)}
          variant="amber"
          label="Unsupported only"
          count={unsupportedCount}
        />
        <FilterToggle
          active={disputedOnly}
          onClick={() => setDisputedOnly((v) => !v)}
          variant="rose"
          label="Disputed only"
          count={disputedCount}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-20 text-center">
          <Calendar className="h-8 w-8 text-ink-200 mx-auto mb-3" />
          <div className="text-[14px] text-ink-500">
            {query ? `No shows matching "${query}"` : "No shows yet."}
          </div>
          {query && (
            <button
              onClick={() => setQuery("")}
              className="mt-2 text-[12px] text-brand-700 hover:text-brand-800 font-medium"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {months.map(({ month, rows }) => (
            <section key={month}>
              <div className="flex items-baseline justify-between mb-1 px-1 sticky top-0 bg-canvas/95 backdrop-blur-sm z-10 py-2 -my-1">
                <h3 className="text-[13px] font-semibold text-ink-900">{month}</h3>
                <span className="text-[11px] font-mono tabular text-ink-400">
                  {rows.length} {rows.length === 1 ? "show" : "shows"}
                </span>
              </div>
              <div className="border-t border-ink-200/50">
                <ul>
                  {rows.map((row) => (
                    <ShowListRow key={row.show.id} row={row} />
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}

      {query && filtered.length > 0 && (
        <div className="mt-4 text-center">
          <span className="text-[12px] text-ink-400">
            {filtered.length} of {rows.length} shows
          </span>
        </div>
      )}
    </div>
  );
}

function ShowListRow({ row }: { row: ShowRow }) {
  const { show, artist, deal, settlement } = row;
  const accent = getAccentColor(row);

  return (
    <li className="relative group list-none">
      <div
        className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full transition-all duration-150 group-hover:top-1 group-hover:bottom-1 ${accent}`}
      />
      <Link
        href={`/shows/${show.id}`}
        className="grid grid-cols-[84px_1fr_120px_auto_24px] items-center gap-4 pl-5 pr-2 py-3 rounded-lg hover:bg-white/80 hover:shadow-[0_1px_4px_rgba(26,24,20,0.04)] transition-all duration-150"
      >
        <div>
          <div className="text-[12.5px] font-medium text-ink-800 tabular">
            {row.dateFormatted}
          </div>
          <div className="text-[10px] text-ink-400 mt-px">{row.dateRelative}</div>
        </div>

        <div className="min-w-0">
          <div className="text-[14.5px] font-medium text-ink-900 truncate group-hover:text-brand-800 transition-colors">
            {artist?.name ?? "—"}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {deal && <DealTypeBadge type={deal.dealType} />}
            {row.isUnsupported && <PlainBadge variant="amber">Unsupported</PlainBadge>}
            {row.isDisputed && <PlainBadge variant="rose">Disputed</PlainBadge>}
            {deal?.guaranteeFormatted && (
              <span className="font-mono tabular text-[11px] text-ink-500">
                {deal.guaranteeFormatted}
                {deal.dealType === "vs" ? " min" : ""}
              </span>
            )}
          </div>
        </div>

        <div className="text-right">
          {settlement?.totalFormatted ? (
            <>
              <div className="font-mono tabular text-[14px] font-semibold text-ink-900">
                {settlement.totalFormatted}
              </div>
              <div className="text-[9px] text-ink-400 uppercase tracking-[0.08em] mt-px">
                to artist
              </div>
            </>
          ) : null}
        </div>

        <div className="flex justify-end">
          {settlement ? <SettlementPill status={settlement.status} /> : null}
        </div>

        <ArrowUpRight className="h-3.5 w-3.5 text-ink-200 group-hover:text-ink-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all duration-150" />
      </Link>
    </li>
  );
}

function FilterToggle({
  active, onClick, variant, label, count,
}: {
  active: boolean;
  onClick: () => void;
  variant: "amber" | "rose";
  label: string;
  count: number;
}) {
  const palette = variant === "amber"
    ? {
        on: "bg-amber-50 text-amber-800 ring-amber-300 hover:bg-amber-100/80",
        off: "bg-white text-ink-600 ring-ink-200/60 hover:bg-amber-50/50 hover:text-amber-800",
        dot: "bg-amber-600",
      }
    : {
        on: "bg-rose-50 text-rose-800 ring-rose-300 hover:bg-rose-100/80",
        off: "bg-white text-ink-600 ring-ink-200/60 hover:bg-rose-50/50 hover:text-rose-800",
        dot: "bg-rose-600",
      };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium ring-1 ring-inset transition-all ${active ? palette.on : palette.off}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? palette.dot : "bg-ink-300"}`} />
      {label}
      <span className={`font-mono tabular text-[10.5px] ${active ? "" : "text-ink-400"}`}>
        {count}
      </span>
    </button>
  );
}

function SettlementPill({ status }: { status: string }) {
  const v = lifecycleStatusVariants[status] ?? {
    variant: "default" as const,
    label: status,
  };
  return <PlainBadge variant={v.variant}>{v.label}</PlainBadge>;
}
