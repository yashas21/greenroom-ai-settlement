import { useMemo, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowUpRight, Search, Calendar, X, Shield, Wrench } from "lucide-react";
import { DealTypeBadge, PlainBadge } from "@/components/ui/badge";

type Status = "booked" | "advanced" | "day_of" | "settled" | "closed";
type SwitchStatus = "suggested" | "accepted" | "declined";
type Tense = "past" | "upcoming";

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
  tense: Tense;
  switchStatus: SwitchStatus | null;
  complexity: "simple" | "medium" | "complex" | null;
  sizeBucket: string | null;
  dealType: string | null;
  expenseCategories: string[];
  recoupCategories: string[];
  disputedRecoupCategories: string[];
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

const COMPLEXITY_LABELS: Record<string, string> = {
  simple: "Simple",
  medium: "Medium",
  complex: "Complex",
};

const DEAL_TYPE_LABELS: Record<string, string> = {
  flat: "Flat",
  percentage_of_gross: "% of gross",
  percentage_of_net: "% of net",
  vs: "Vs deal",
  door: "Door deal",
};

const EXPENSE_CAT_LABELS: Record<string, string> = {
  production: "Production",
  sound: "Sound",
  lights: "Lights",
  hospitality: "Hospitality",
  marketing: "Marketing",
  backline: "Backline",
  security: "Security",
  other: "Other",
};

const RECOUP_CAT_LABELS: Record<string, string> = {
  marketing: "Marketing",
  hospitality_overage: "Hospitality overage",
  production_overage: "Production overage",
  prior_advance: "Prior advance",
  damages: "Damages",
  other: "Other",
};

function getAccentColor(row: ShowRow): string {
  if (row.tense === "upcoming") return "bg-brand-300";
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

type Filters = {
  query: string;
  unsupportedOnly: boolean;
  disputedOnly: boolean;
  switchSuggestedOnly: boolean;
  upcomingOnly: boolean;
  switchEligibleOnly: boolean;
  switchedOnly: boolean;
  complexity: string | null;
  size: string | null;
  dealType: string | null;
  expenseCategory: string | null;
  recoupCategory: string | null;
  recoupDisputedOnly: boolean;
};

const EMPTY_FILTERS: Filters = {
  query: "",
  unsupportedOnly: false,
  disputedOnly: false,
  switchSuggestedOnly: false,
  upcomingOnly: false,
  switchEligibleOnly: false,
  switchedOnly: false,
  complexity: null,
  size: null,
  dealType: null,
  expenseCategory: null,
  recoupCategory: null,
  recoupDisputedOnly: false,
};

// Smart Guaranteed Price applies to any non-flat deal (vs, % of net, % of gross,
// door). Smart Switch is narrower — door (any size) or vs/% of net in $1–5K.
// "Actionable upcoming" uses the SGP set, since either lever counts as action.
const SGP_ELIGIBLE_DEAL_TYPES = new Set([
  "vs",
  "percentage_of_net",
  "percentage_of_gross",
  "door",
]);
const SWITCH_ELIGIBLE_DEAL_TYPES = new Set(["vs", "percentage_of_net", "door"]);
const SWITCH_BUCKETS_FOR_VS_PN = new Set(["$1–5K"]);

function isSwitchEligible(row: ShowRow): boolean {
  if (row.dealType === null) return false;
  if (!SWITCH_ELIGIBLE_DEAL_TYPES.has(row.dealType)) return false;
  if (row.dealType === "door") return true;
  return SWITCH_BUCKETS_FOR_VS_PN.has(row.sizeBucket ?? "");
}

// Show-lifecycle states where the deal is effectively locked in — no point
// proposing a Smart Switch or Smart Guaranteed Price anymore.
const LOCKED_SHOW_STATUSES = new Set(["settled", "closed"]);

// Settlement-lifecycle states where the proposal is past the negotiation window:
// signed = both sides agreed; finalized = settlement closed; paid = money moved.
// Anything earlier (draft / submitted / in_review / revised / disputed) is still
// fair game for a switch or a guarantee redraft.
const LOCKED_SETTLEMENT_STATUSES = new Set(["signed", "finalized", "paid"]);

// "Actionable upcoming" = an upcoming show whose proposal is still open enough
// for the booker to either (a) accept the Smart Switch suggestion before the
// agent signs, or (b) redraft the proposal using the Smart Guaranteed Price.
// We exclude:
//  - past shows (date already happened)
//  - flat deals (neither engine has anything to recommend)
//  - shows whose status says the deal is locked (settled/closed)
//  - shows whose settlement is past the negotiation window (signed/finalized/paid)
//  - for Switch-eligible rows only: shows where the booker already accepted or
//    declined the switch (the switch decision is irrelevant for SGP-only rows)
function isActionableUpcoming(row: ShowRow): boolean {
  if (row.tense !== "upcoming") return false;
  if (row.dealType === null || !SGP_ELIGIBLE_DEAL_TYPES.has(row.dealType)) return false;
  if (LOCKED_SHOW_STATUSES.has(row.show.status)) return false;
  if (row.settlement && LOCKED_SETTLEMENT_STATUSES.has(row.settlement.status)) return false;
  if (
    isSwitchEligible(row) &&
    (row.switchStatus === "accepted" || row.switchStatus === "declined")
  ) {
    return false;
  }
  return true;
}

function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  return {
    query: params.get("q") ?? "",
    unsupportedOnly: params.get("unsupported") === "1",
    disputedOnly: params.get("disputed") === "1",
    switchSuggestedOnly: params.get("switch") === "1",
    upcomingOnly: params.get("upcoming") === "1",
    switchEligibleOnly: params.get("switchEligible") === "1",
    switchedOnly: params.get("switched") === "1",
    complexity: params.get("complexity"),
    size: params.get("size"),
    dealType: params.get("dealType"),
    expenseCategory: params.get("expense"),
    recoupCategory: params.get("recoup"),
    recoupDisputedOnly: params.get("recoupDisputed") === "1",
  };
}

function buildQueryString(f: Filters): string {
  const params = new URLSearchParams();
  if (f.query.trim()) params.set("q", f.query.trim());
  if (f.unsupportedOnly) params.set("unsupported", "1");
  if (f.disputedOnly) params.set("disputed", "1");
  if (f.switchSuggestedOnly) params.set("switch", "1");
  if (f.upcomingOnly) params.set("upcoming", "1");
  if (f.switchEligibleOnly) params.set("switchEligible", "1");
  if (f.switchedOnly) params.set("switched", "1");
  if (f.complexity) params.set("complexity", f.complexity);
  if (f.size) params.set("size", f.size);
  if (f.dealType) params.set("dealType", f.dealType);
  if (f.expenseCategory) params.set("expense", f.expenseCategory);
  if (f.recoupCategory) params.set("recoup", f.recoupCategory);
  if (f.recoupDisputedOnly) params.set("recoupDisputed", "1");
  const s = params.toString();
  return s ? `?${s}` : "";
}

function isFilterActive(f: Filters): boolean {
  return (
    !!f.query ||
    f.unsupportedOnly ||
    f.disputedOnly ||
    f.switchSuggestedOnly ||
    f.upcomingOnly ||
    f.switchEligibleOnly ||
    f.switchedOnly ||
    !!f.complexity ||
    !!f.size ||
    !!f.dealType ||
    !!f.expenseCategory ||
    !!f.recoupCategory ||
    f.recoupDisputedOnly
  );
}

export function ShowsList({ rows }: { rows: ShowRow[] }) {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const filters = useMemo(() => parseFilters(search), [search]);

  const update = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filters, ...patch };
      setLocation(`/shows${buildQueryString(next)}`, { replace: true });
    },
    [filters, setLocation],
  );

  const unsupportedCount = useMemo(() => rows.filter((r) => r.isUnsupported).length, [rows]);
  const disputedCount = useMemo(() => rows.filter((r) => r.isDisputed).length, [rows]);
  const upcomingCount = useMemo(() => rows.filter((r) => r.tense === "upcoming").length, [rows]);
  const upcomingActionableCount = useMemo(
    () => rows.filter(isActionableUpcoming).length,
    [rows],
  );
  const switchAcceptedCount = useMemo(
    () => rows.filter((r) => r.switchStatus === "accepted").length,
    [rows],
  );
  const switchSuggestedCount = useMemo(
    () => rows.filter((r) => r.switchStatus === "suggested").length,
    [rows],
  );
  const filtered = useMemo(() => {
    let out = rows;
    if (filters.upcomingOnly) out = out.filter((r) => r.tense === "upcoming");
    if (filters.switchEligibleOnly) out = out.filter(isActionableUpcoming);
    if (filters.switchedOnly) out = out.filter((r) => r.switchStatus === "accepted");
    if (filters.unsupportedOnly) out = out.filter((r) => r.isUnsupported);
    if (filters.disputedOnly) out = out.filter((r) => r.isDisputed);
    if (filters.switchSuggestedOnly)
      out = out.filter((r) => r.switchStatus === "suggested");
    if (filters.complexity) out = out.filter((r) => r.complexity === filters.complexity);
    if (filters.size) out = out.filter((r) => r.sizeBucket === filters.size);
    if (filters.dealType) out = out.filter((r) => r.dealType === filters.dealType);
    if (filters.expenseCategory)
      out = out.filter((r) => r.expenseCategories.includes(filters.expenseCategory!));
    if (filters.recoupCategory) {
      const cat = filters.recoupCategory;
      out = out.filter((r) =>
        filters.recoupDisputedOnly
          ? r.disputedRecoupCategories.includes(cat)
          : r.recoupCategories.includes(cat),
      );
    } else if (filters.recoupDisputedOnly) {
      out = out.filter((r) => r.disputedRecoupCategories.length > 0);
    }
    if (filters.query.trim()) {
      const q = filters.query.toLowerCase();
      out = out.filter(
        (r) =>
          r.artist?.name.toLowerCase().includes(q) ||
          r.deal?.dealType.toLowerCase().includes(q) ||
          r.dateFormatted.toLowerCase().includes(q),
      );
    }
    return out;
  }, [rows, filters]);

  const months = useMemo(() => groupByMonth(filtered), [filtered]);

  const drillFiltersActive =
    !!filters.complexity ||
    !!filters.size ||
    !!filters.dealType ||
    !!filters.expenseCategory ||
    !!filters.recoupCategory ||
    filters.recoupDisputedOnly;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search artists, deals…"
            value={filters.query}
            onChange={(e) => update({ query: e.target.value })}
            className="w-64 pl-9 pr-3 py-2 text-[13px] bg-white border border-ink-200/60 rounded-lg text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-700/20 focus:border-brand-300 transition-all"
          />
        </div>
        <FilterToggle
          active={filters.switchEligibleOnly}
          onClick={() => update({
            switchEligibleOnly: !filters.switchEligibleOnly,
            upcomingOnly: false,
          })}
          variant="brand"
          label="Actionable upcoming"
          count={upcomingActionableCount}
          icon={<Shield className="h-3 w-3" />}
        />
        <FilterToggle
          active={filters.upcomingOnly}
          onClick={() => update({
            upcomingOnly: !filters.upcomingOnly,
            switchEligibleOnly: false,
          })}
          variant="brand"
          label="Upcoming only"
          count={upcomingCount}
        />
        {switchAcceptedCount > 0 && (
          <button
            type="button"
            onClick={() => update({ switchedOnly: !filters.switchedOnly })}
            aria-pressed={filters.switchedOnly}
            className={`text-[11px] px-2 py-1 rounded ring-1 inline-flex items-center gap-1 transition-colors ${
              filters.switchedOnly
                ? "bg-emerald-100 text-emerald-900 ring-emerald-300"
                : "bg-emerald-50/70 text-emerald-700 ring-emerald-200/60 hover:bg-emerald-100/70"
            }`}
            title="Show only deals where Smart Switch was accepted"
          >
            <span aria-hidden>🎯</span>
            {switchAcceptedCount} switched
          </button>
        )}
        <FilterToggle
          active={filters.unsupportedOnly}
          onClick={() => update({ unsupportedOnly: !filters.unsupportedOnly })}
          variant="amber"
          label="Unsupported only"
          count={unsupportedCount}
        />
        <FilterToggle
          active={filters.disputedOnly}
          onClick={() => update({ disputedOnly: !filters.disputedOnly })}
          variant="rose"
          label="Disputed only"
          count={disputedCount}
        />
        <FilterToggle
          active={filters.switchSuggestedOnly}
          onClick={() => update({ switchSuggestedOnly: !filters.switchSuggestedOnly })}
          variant="brand"
          label="Smart Switch pending"
          count={switchSuggestedCount}
        />
        {filters.upcomingOnly && upcomingActionableCount > 0 && !filters.switchEligibleOnly && (
          <button
            type="button"
            onClick={() => update({ switchEligibleOnly: true, upcomingOnly: false })}
            className="text-[11px] text-brand-700 bg-brand-50/50 hover:bg-brand-50 px-2 py-1 rounded ring-1 ring-brand-200/60 inline-flex items-center gap-1 transition-colors"
          >
            <Shield className="h-2.5 w-2.5" />
            {upcomingActionableCount} actionable now (Smart Switch or Improve Deal) — narrow to these →
          </button>
        )}
        {isFilterActive(filters) && (
          <button
            type="button"
            onClick={() => setLocation("/shows", { replace: true })}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] text-ink-500 hover:text-ink-800 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {drillFiltersActive && (
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] eyebrow text-ink-400">Drill-down:</span>
          {filters.complexity && (
            <DrillChip
              label={`Complexity: ${COMPLEXITY_LABELS[filters.complexity] ?? filters.complexity}`}
              onClear={() => update({ complexity: null })}
            />
          )}
          {filters.size && (
            <DrillChip
              label={`Size: ${filters.size}`}
              onClear={() => update({ size: null })}
            />
          )}
          {filters.dealType && (
            <DrillChip
              label={`Deal type: ${DEAL_TYPE_LABELS[filters.dealType] ?? filters.dealType}`}
              onClear={() => update({ dealType: null })}
            />
          )}
          {filters.expenseCategory && (
            <DrillChip
              label={`Expense: ${EXPENSE_CAT_LABELS[filters.expenseCategory] ?? filters.expenseCategory}`}
              onClear={() => update({ expenseCategory: null })}
            />
          )}
          {filters.recoupCategory && (
            <DrillChip
              label={`Recoup: ${RECOUP_CAT_LABELS[filters.recoupCategory] ?? filters.recoupCategory}${filters.recoupDisputedOnly ? " (disputed)" : ""}`}
              onClear={() => update({ recoupCategory: null, recoupDisputedOnly: false })}
            />
          )}
          {filters.recoupDisputedOnly && !filters.recoupCategory && (
            <DrillChip
              label="Recoup: any disputed"
              onClear={() => update({ recoupDisputedOnly: false })}
            />
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="py-20 text-center">
          <Calendar className="h-8 w-8 text-ink-200 mx-auto mb-3" />
          <div className="text-[14px] text-ink-500">
            {filters.query ? `No shows matching "${filters.query}"` : "No shows match these filters."}
          </div>
          {isFilterActive(filters) && (
            <button
              onClick={() => setLocation("/shows", { replace: true })}
              className="mt-2 text-[12px] text-brand-700 hover:text-brand-800 font-medium"
            >
              Clear filters
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

      {isFilterActive(filters) && filtered.length > 0 && (
        <div className="mt-4 text-center">
          <span className="text-[12px] text-ink-400">
            {filtered.length} of {rows.length} shows
          </span>
        </div>
      )}
    </div>
  );
}

function DrillChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-brand-50 text-brand-800 text-[11px] font-medium ring-1 ring-inset ring-brand-200">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="rounded-full p-0.5 hover:bg-brand-100 transition-colors"
        aria-label={`Clear ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function ShowListRow({ row }: { row: ShowRow }) {
  const { show, artist, deal, settlement } = row;
  const accent = getAccentColor(row);
  const isActionable = isActionableUpcoming(row);
  const switchEligible = isSwitchEligible(row);
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
            {row.tense === "upcoming" && <PlainBadge variant="brand">Upcoming</PlainBadge>}
            {row.isUnsupported && <PlainBadge variant="amber">Unsupported</PlainBadge>}
            {row.isDisputed && <PlainBadge variant="rose">Disputed</PlainBadge>}
            {row.switchStatus && <SwitchPill status={row.switchStatus} />}
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
          {isActionable ? (
            switchEligible ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-brand-700 text-white ring-1 ring-brand-700 group-hover:bg-brand-800 transition-colors shadow-[0_1px_2px_rgba(0,80,60,0.18)]"
                title="Open deal page to run a Smart Switch suggestion"
              >
                <Shield className="h-3 w-3" />
                Run Smart Switch
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-emerald-700 text-white ring-1 ring-emerald-700 group-hover:bg-emerald-800 transition-colors shadow-[0_1px_2px_rgba(8,100,80,0.18)]"
                title="Open deal page to propose structural improvements (caps, conversions)"
              >
                <Wrench className="h-3 w-3" />
                Improve Deal
              </span>
            )
          ) : settlement ? (
            <SettlementPill status={settlement.status} />
          ) : null}
        </div>

        <ArrowUpRight className="h-3.5 w-3.5 text-ink-200 group-hover:text-ink-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all duration-150" />
      </Link>
    </li>
  );
}

function SwitchPill({ status }: { status: SwitchStatus }) {
  if (status === "accepted") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide uppercase bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
        title="Smart Switch suggestion accepted — booker will push this on next renegotiation"
      >
        <span aria-hidden>🎯</span>
        Switched
      </span>
    );
  }
  const map = {
    suggested: { variant: "amber" as const, label: "Switch pending" },
    declined: { variant: "default" as const, label: "Switch declined" },
  } as const;
  const v = map[status];
  return (
    <PlainBadge variant={v.variant}>
      <Shield className="h-2.5 w-2.5 mr-1 inline-block" />
      {v.label}
    </PlainBadge>
  );
}

function FilterToggle({
  active, onClick, variant, label, count, icon,
}: {
  active: boolean;
  onClick: () => void;
  variant: "amber" | "rose" | "brand";
  label: string;
  count: number;
  icon?: React.ReactNode;
}) {
  const palette = variant === "amber"
    ? {
        on: "bg-amber-50 text-amber-800 ring-amber-300 hover:bg-amber-100/80",
        off: "bg-white text-ink-600 ring-ink-200/60 hover:bg-amber-50/50 hover:text-amber-800",
        dot: "bg-amber-600",
      }
    : variant === "rose"
    ? {
        on: "bg-rose-50 text-rose-800 ring-rose-300 hover:bg-rose-100/80",
        off: "bg-white text-ink-600 ring-ink-200/60 hover:bg-rose-50/50 hover:text-rose-800",
        dot: "bg-rose-600",
      }
    : {
        on: "bg-brand-50 text-brand-800 ring-brand-300 hover:bg-brand-100/80",
        off: "bg-white text-ink-600 ring-ink-200/60 hover:bg-brand-50/50 hover:text-brand-800",
        dot: "bg-brand-600",
      };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium ring-1 ring-inset transition-all ${active ? palette.on : palette.off}`}
    >
      {icon ? (
        <span className={active ? "" : "text-ink-400"}>{icon}</span>
      ) : (
        <span className={`w-1.5 h-1.5 rounded-full ${active ? palette.dot : "bg-ink-300"}`} />
      )}
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
