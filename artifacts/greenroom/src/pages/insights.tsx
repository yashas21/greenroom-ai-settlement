import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Sparkles, Shield, ChevronRight, ArrowUpRight, Clock, DollarSign } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import type { InsightsCell, AttentionKind, SwitchSavingsItem, SwitchProjectedCell } from "@/lib/types";

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
      <section className="px-12 py-10 max-w-[1280px]">
        <div className="eyebrow text-[10px] text-brand-700 mb-2">
          Deal anatomy · qualitative
        </div>
        <h1 className="text-4xl font-serif text-ink-900 mb-2 tracking-tight">Insights</h1>
        <p className="text-[14px] text-ink-600 max-w-2xl mb-6 leading-relaxed">
          Same Deal type × deal size grid as Deal Analysis, but each cell names the dominant
          friction kind for those deals and clusters the actual recurring complaints behind it.
        </p>
        <SwitchSavingsSection />
        <SwitchProjectedGridSection />
        <LoadingState label="Clustering complaint themes... this can take a minute on first load." />
      </section>
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

      <SwitchSavingsSection />
      <SwitchProjectedGridSection />

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

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(Math.round(n));
  if (v >= 1000) return `${sign}$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return `${sign}$${v.toLocaleString()}`;
}

function fmtMinutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const TIER_TONE: Record<string, string> = {
  A: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  B: "bg-sky-50 text-sky-700 ring-sky-200",
  C: "bg-amber-50 text-amber-700 ring-amber-200",
  D: "bg-ink-50 text-ink-600 ring-ink-200",
};

const SHAPE_LABEL: Record<string, string> = {
  flat: "Flat",
  door_hybrid: "Door hybrid",
};

const DEAL_TYPE_LABEL: Record<string, string> = {
  vs: "Vs",
  percentage_of_net: "% of net",
  door: "Door",
};

function SwitchSavingsSection() {
  const state = useApiData(() => api.switchSavings(3), []);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (state.status === "loading")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-ink-400">Loading Smart Switch savings…</div>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-rose-600">
            Couldn't load savings: {state.error.message}
          </div>
        </CardContent>
      </Card>
    );

  const data = state.data;
  if (data.items.length === 0) {
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-4 w-4 text-brand-700" />
            <span className="eyebrow text-[10px] text-ink-500">
              Smart Switch · last {data.windowMonths} months
            </span>
          </div>
          <div className="text-[13px] text-ink-500">
            No vs / % of net / door deals settled in the last {data.windowMonths} months — nothing
            for Smart Switch to compare against.
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalDollars = data.totalMoneySavedToVenue;
  const totalMins = data.totalMinutesSaved;

  return (
    <Card className="mb-6">
      <CardContent>
        <div className="flex items-baseline justify-between mb-1">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-brand-700" />
            <h2 className="text-[15px] font-semibold text-ink-900">
              Smart Switch could have helped
            </h2>
            <span className="eyebrow text-[10px] text-ink-400">
              · last {data.windowMonths} months
            </span>
          </div>
          <div className="text-[11px] text-ink-400 font-mono tabular">
            {data.items.length} of {data.totalCandidates} eligible deals shown
          </div>
        </div>
        <p className="text-[12px] text-ink-500 mb-4 leading-relaxed">
          Past settled <span className="font-mono">vs / % of net / door</span> deals re-scored
          against the Smart Switch counterfactual. Money is venue payout delta; time is a
          back-of-the-envelope estimate from recoups + sign-off thread length.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-md ring-1 ring-emerald-200/60 bg-emerald-50/40 p-3">
            <div className="flex items-center gap-1.5 eyebrow text-[10px] text-emerald-700 mb-1">
              <DollarSign className="h-3 w-3" />
              Money saved (top {data.items.length})
            </div>
            <div className="text-[22px] font-serif text-ink-900 tabular">
              {fmtMoney(totalDollars)}
            </div>
            <div className="text-[10px] text-ink-400">
              cumulative venue-side payout reduction vs. actual
            </div>
          </div>
          <div className="rounded-md ring-1 ring-sky-200/60 bg-sky-50/40 p-3">
            <div className="flex items-center gap-1.5 eyebrow text-[10px] text-sky-700 mb-1">
              <Clock className="h-3 w-3" />
              Time saved (top {data.items.length})
            </div>
            <div className="text-[22px] font-serif text-ink-900 tabular">
              {fmtMinutes(totalMins)}
            </div>
            <div className="text-[10px] text-ink-400">
              fewer minutes spent on settlement-night arithmetic + back-and-forth
            </div>
          </div>
        </div>

        <ul className="space-y-1.5">
          {data.items.map((it) => (
            <SavingsRow
              key={it.showId}
              item={it}
              expanded={expandedId === it.showId}
              onToggle={() =>
                setExpandedId(expandedId === it.showId ? null : it.showId)
              }
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SavingsRow({
  item,
  expanded,
  onToggle,
}: {
  item: SwitchSavingsItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tierClass = TIER_TONE[item.confidenceTier] ?? TIER_TONE.D;
  const moneyPositive = item.moneySavedToVenue > 0;
  return (
    <li className="rounded-md ring-1 ring-ink-200/60 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-ink-50/60 rounded-md transition-colors"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-ink-400 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-ink-900 truncate">
              {item.artistName ?? "—"}
            </span>
            <span className="text-[10px] font-mono tabular text-ink-400">{item.date}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-50 text-ink-600 ring-1 ring-ink-200">
              {DEAL_TYPE_LABEL[item.dealType] ?? item.dealType} → {SHAPE_LABEL[item.switchShape]}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ring-1 ${tierClass}`}
              title="Confidence tier"
            >
              Tier {item.confidenceTier}
            </span>
            {item.hadDispute && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                disputed
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div
              className={`text-[13px] font-mono tabular font-semibold ${moneyPositive ? "text-emerald-700" : "text-ink-500"}`}
            >
              {moneyPositive ? "+" : ""}
              {fmtMoney(item.moneySavedToVenue)}
            </div>
            <div className="text-[9px] text-ink-400 uppercase tracking-[0.06em]">money</div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-mono tabular font-semibold text-sky-700">
              {fmtMinutes(item.minutesSaved)}
            </div>
            <div className="text-[9px] text-ink-400 uppercase tracking-[0.06em]">time</div>
          </div>
        </div>
      </button>

      {expanded && <SavingsBreakdown item={item} />}
    </li>
  );
}

function SavingsBreakdown({ item }: { item: SwitchSavingsItem }) {
  const a = item.breakdown.actual;
  const c = item.breakdown.counterfactual;
  return (
    <div className="border-t border-ink-200/50 px-3 py-3 bg-ink-50/30 rounded-b-md text-[12px] leading-relaxed space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
          <div className="eyebrow text-[10px] text-ink-500 mb-1.5">What actually happened</div>
          <div className="font-mono tabular text-[11px] text-ink-700 space-y-0.5">
            <div className="flex justify-between">
              <span>Gross box office</span>
              <span>${a.gross.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Expenses</span>
              <span>${a.expenses.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Recoups ({a.recoupLines.length})</span>
              <span>${a.recoupTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-semibold text-ink-900 pt-1 border-t border-ink-200/60 mt-1">
              <span>Paid to artist</span>
              <span>${a.payout.toLocaleString()}</span>
            </div>
            <div className="text-[10px] text-ink-400 pt-1">
              Settlement status: <span className="font-medium">{a.settlementStatus}</span>
            </div>
          </div>
          {a.recoupLines.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {a.recoupLines.slice(0, 4).map((rl, i) => (
                <li
                  key={i}
                  className="text-[10.5px] flex justify-between gap-2 truncate"
                  title={rl.label}
                >
                  <span
                    className={`truncate ${rl.status === "disputed" ? "text-rose-700" : "text-ink-500"}`}
                  >
                    {rl.status === "disputed" ? "✗ " : "· "}
                    {rl.label}
                  </span>
                  <span className="font-mono tabular text-ink-500 shrink-0">
                    ${rl.amount.toLocaleString()}
                  </span>
                </li>
              ))}
              {a.recoupLines.length > 4 && (
                <li className="text-[10px] text-ink-400 italic">
                  +{a.recoupLines.length - 4} more
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="rounded ring-1 ring-brand-200 bg-brand-50/30 p-2.5">
          <div className="eyebrow text-[10px] text-brand-700 mb-1.5">
            Smart Switch counterfactual
          </div>
          <div className="font-mono tabular text-[11px] text-ink-700 space-y-0.5">
            <div className="flex justify-between">
              <span>Shape</span>
              <span>{SHAPE_LABEL[c.shape]}</span>
            </div>
            {c.shape === "flat" ? (
              <div className="flex justify-between">
                <span>Suggested flat</span>
                <span>${(c.flat ?? 0).toLocaleString()}</span>
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Floor</span>
                  <span>${(c.doorFloor ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Split above cap</span>
                  <span>{Math.round((c.doorSplitPct ?? 0) * 100)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Expense cap</span>
                  <span>${(c.doorExpenseCap ?? 0).toLocaleString()}</span>
                </div>
              </>
            )}
            <div className="flex justify-between font-semibold text-ink-900 pt-1 border-t border-brand-200/60 mt-1">
              <span>Projected payout</span>
              <span>${c.projectedPayout.toLocaleString()}</span>
            </div>
          </div>
          <div className="text-[10.5px] text-ink-600 mt-2 leading-snug">{c.basis}</div>
        </div>
      </div>

      <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
        <div className="eyebrow text-[10px] text-ink-500 mb-1">Why money</div>
        <div className="text-[11.5px] text-ink-700">{item.breakdown.moneyRationale}</div>
      </div>

      <div className="rounded ring-1 ring-ink-200/60 bg-white p-2.5">
        <div className="eyebrow text-[10px] text-ink-500 mb-1">Why time</div>
        <div className="text-[11.5px] text-ink-700">{item.breakdown.timeSavedRationale}</div>
        <div className="mt-1.5 text-[10.5px] text-ink-500 font-mono tabular">
          ~{item.estimatedMinutesSpent} min actual → ~{item.estimatedMinutesUnderSwitch} min under
          Smart Switch = <span className="text-sky-700 font-semibold">{fmtMinutes(item.minutesSaved)}</span> saved
        </div>
      </div>

      <div className="text-right">
        <Link
          href={`/shows/${item.showId}`}
          className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-800 font-medium"
        >
          Open show <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

const PROJ_DEAL_LABEL: Record<string, string> = {
  vs: "Vs",
  percentage_of_net: "% of net",
  door: "Door",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function deltaTone(actual: number, projected: number): string {
  if (actual === projected) return "text-ink-400";
  return projected < actual ? "text-emerald-700" : "text-rose-700";
}

function SwitchProjectedGridSection() {
  const state = useApiData(() => api.switchProjectedGrid(12), []);

  if (state.status === "loading")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-ink-400">Loading projected grid…</div>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="text-[12px] text-rose-600">
            Couldn't load projected grid: {state.error.message}
          </div>
        </CardContent>
      </Card>
    );

  const data = state.data;
  if (data.cells.length === 0) {
    return (
      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-4 w-4 text-brand-700" />
            <span className="eyebrow text-[10px] text-ink-500">
              Projected grid · last {data.windowMonths} months
            </span>
          </div>
          <div className="text-[13px] text-ink-500">
            No vs / % of net / door deals settled in this window — nothing to project.
          </div>
        </CardContent>
      </Card>
    );
  }

  const cellByKey = new Map(
    data.cells.map((c) => [`${c.dealType}|${c.bucket}`, c]),
  );

  return (
    <Card className="mb-6">
      <CardContent>
        <div className="flex items-baseline justify-between mb-1">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-brand-700" />
            <h2 className="text-[15px] font-semibold text-ink-900">
              If Smart Switch had been used
            </h2>
            <span className="eyebrow text-[10px] text-ink-400">
              · last {data.windowMonths} months · projected grid
            </span>
          </div>
          <div className="text-[11px] text-ink-400 font-mono tabular">
            {data.totalDealsModelled} of {data.totalCandidates} deals modelled
          </div>
        </div>
        <p className="text-[12px] text-ink-500 mb-3 leading-relaxed">
          The Deal Analysis cross-tab, recomputed with each settled vs / % of net / door deal
          replaced by its Smart Switch counterfactual. <span className="font-mono">losing</span>{" "}
          re-derived from the projected payout; <span className="font-mono">disputed</span> and{" "}
          <span className="font-mono">attention</span> assumed to drop to 0 (pre-agreed terms
          eliminate recoup arithmetic, which is what every settlement-flow attention kind in
          this app traces back to).
        </p>

        <details className="mb-5 rounded-md ring-1 ring-ink-200/60 bg-ink-50/30 px-3 py-2 text-[11px] text-ink-600">
          <summary className="cursor-pointer text-ink-700 font-medium">
            How the flat contract is computed
          </summary>
          <div className="mt-2 leading-relaxed space-y-2">
            <p>
              For each <span className="font-mono">vs</span> or{" "}
              <span className="font-mono">% of net</span> deal, the suggested flat is the
              historical average artist payout for deals in the same{" "}
              <span className="font-mono">deal type × size bucket</span> cell, rounded to the
              nearest $50:
            </p>
            <pre className="font-mono text-[10.5px] bg-white rounded px-2 py-1.5 ring-1 ring-ink-200/50 overflow-x-auto">
{`bucket            = classifySizeBucket(deal)        // $0–1K | $1–5K | $5–15K | $15K+ | Uncapped %
cell              = pastSettled[dealType][bucket]   // need cell.n >= 3, else no suggestion
suggestedFlat     = roundTo50( cell.avgPayout )     // mean totalToArtist across the cell
confidenceBand    = [ roundTo50(cell.p10Payout), roundTo50(cell.p90Payout) ]`}
            </pre>
            <p>
              Counterfactual losing-money for the projection then uses{" "}
              <span className="font-mono">gross − suggestedFlat − actualExpenses &lt; 0</span>.
              Door deals use a separate hybrid:{" "}
              <span className="font-mono">$500 floor + 60% × max(0, gross·0.9 − expenseCap)</span>{" "}
              with <span className="font-mono">expenseCap = min($1,500, avg cell expenses)</span>.
            </p>
          </div>
        </details>

        <div className="grid grid-cols-4 gap-3 mb-5">
          <ProjStatCard label="Money saved" value={fmtMoney(data.totalMoneySavedToVenue)} tone="emerald" />
          <ProjStatCard label="Loss-making nights avoided" value={String(data.totalLosingMoneyAvoided)} tone="emerald" />
          <ProjStatCard label="Disputes avoided" value={String(data.totalDisputesAvoided)} tone="emerald" />
          <ProjStatCard label="Attention items avoided" value={String(data.totalAttentionAvoided)} tone="emerald" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border-separate border-spacing-y-1.5">
            <thead>
              <tr className="text-left">
                <th className="py-1.5 eyebrow text-[10px] text-ink-400 font-semibold pr-3 align-bottom w-[110px]">
                  Deal type
                </th>
                {data.buckets.map((b) => (
                  <th
                    key={b}
                    className="py-1.5 px-2 eyebrow text-[10px] text-ink-400 font-semibold text-left align-bottom"
                  >
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.dealTypes.map((dt) => (
                <tr key={dt} className="align-top">
                  <td className="py-1.5 pr-3 align-top">
                    <div className="text-ink-900 font-medium text-[12px] leading-tight pt-2">
                      {PROJ_DEAL_LABEL[dt] ?? dt}
                    </div>
                  </td>
                  {data.buckets.map((b) => (
                    <td key={b} className="px-1 align-top">
                      <ProjCellBox cell={cellByKey.get(`${dt}|${b}`) ?? null} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjStatCard({ label, value, tone }: { label: string; value: string; tone: "emerald" | "sky" }) {
  const ring = tone === "emerald" ? "ring-emerald-200/60 bg-emerald-50/40" : "ring-sky-200/60 bg-sky-50/40";
  const eyeb = tone === "emerald" ? "text-emerald-700" : "text-sky-700";
  return (
    <div className={`rounded-md ring-1 p-3 ${ring}`}>
      <div className={`eyebrow text-[10px] mb-1 ${eyeb}`}>{label}</div>
      <div className="text-[18px] font-serif text-ink-900 tabular">{value}</div>
    </div>
  );
}

function ProjCellBox({ cell }: { cell: SwitchProjectedCell | null }) {
  if (!cell || cell.count === 0) {
    return (
      <div className="rounded-md ring-1 ring-ink-200/40 p-2 text-[10px] text-ink-300 bg-ink-50/30">
        no deals
      </div>
    );
  }
  const moneyPositive = cell.moneySavedToVenue > 0;
  return (
    <div className="rounded-md ring-1 ring-ink-200/60 bg-white p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono tabular text-ink-500">n={cell.count}</span>
        <span className={`text-[10px] font-mono tabular font-semibold ${moneyPositive ? "text-emerald-700" : "text-ink-400"}`}>
          {moneyPositive ? "+" : ""}
          {fmtMoney(cell.moneySavedToVenue)}
        </span>
      </div>
      <ProjMetricRow
        label="losing"
        actual={cell.actualLosingRate}
        projected={cell.projectedLosingRate}
        actualN={cell.actualLosingMoney}
        projectedN={cell.projectedLosingMoney}
      />
      <ProjMetricRow
        label="disputed"
        actual={cell.actualDisputeRate}
        projected={cell.projectedDisputeRate}
        actualN={cell.actualDisputed}
        projectedN={cell.projectedDisputed}
      />
      <ProjMetricRow
        label="attention"
        actual={cell.actualAttentionRate}
        projected={cell.projectedAttentionRate}
        actualN={cell.actualAttention}
        projectedN={cell.projectedAttention}
      />
    </div>
  );
}

function ProjMetricRow({
  label,
  actual,
  projected,
  actualN,
  projectedN,
}: {
  label: string;
  actual: number;
  projected: number;
  actualN: number;
  projectedN: number;
}) {
  const tone = deltaTone(actual, projected);
  return (
    <div className="flex items-center justify-between text-[10.5px] font-mono tabular leading-tight py-0.5">
      <span className="text-ink-400">{label}</span>
      <span className="flex items-center gap-1">
        <span className="text-ink-600">
          {pct(actual)}
          <span className="text-ink-300"> ({actualN})</span>
        </span>
        <span className="text-ink-300">→</span>
        <span className={`font-semibold ${tone}`}>{pct(projected)}</span>
      </span>
    </div>
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
