import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney, formatMoneyCompact } from "@/lib/format";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import type { DealAnalysis } from "@/lib/types";

const COMPLEXITY_META: Record<
  "simple" | "medium" | "complex",
  { label: string; blurb: string; bar: string; ring: string; bg: string; fg: string }
> = {
  simple: {
    label: "Simple",
    blurb: "Flat with no caps or bonuses.",
    bar: "bg-brand-700/90",
    ring: "ring-brand-200/60",
    bg: "bg-brand-50/30",
    fg: "text-brand-800",
  },
  medium: {
    label: "Medium",
    blurb: "% of gross, or has expense / hospitality caps.",
    bar: "bg-sky-500/90",
    ring: "ring-sky-200/60",
    bg: "bg-sky-50/30",
    fg: "text-sky-800",
  },
  complex: {
    label: "Complex",
    blurb: "Vs / door / % of net, or has bonuses or freetext notes.",
    bar: "bg-amber-500/90",
    ring: "ring-amber-200/60",
    bg: "bg-amber-50/30",
    fg: "text-amber-800",
  },
};

const DEAL_LABELS: Record<string, string> = {
  flat: "Flat",
  percentage_of_gross: "% of gross",
  percentage_of_net: "% of net",
  vs: "Vs deal",
  door: "Door deal",
};

const RECOUP_LABELS: Record<string, string> = {
  marketing: "Marketing",
  hospitality_overage: "Hospitality overage",
  production_overage: "Production overage",
  prior_advance: "Prior advance",
  damages: "Damages",
  other: "Other",
};

const EXPENSE_LABELS: Record<string, string> = {
  production: "Production",
  sound: "Sound",
  lights: "Lights",
  hospitality: "Hospitality",
  marketing: "Marketing",
  backline: "Backline",
  security: "Security",
  other: "Other",
};

export default function DealAnalysisPage() {
  const state = useApiData(() => api.dealAnalysis(), []);

  if (state.status === "loading") return <LoadingState label="Loading deal analysis..." />;
  if (state.status === "error") return <LoadingState label={`Error: ${state.error.message}`} />;

  const d = state.data;

  return (
    <div className="px-12 py-10 max-w-7xl">
      <div className="mb-14">
        <div className="eyebrow mb-3">Deal anatomy · Last 24 months</div>
        <h1
          className="font-display text-[48px] font-medium text-ink-900 leading-[1.05]"
          style={{ letterSpacing: "-0.02em", fontOpticalSizing: "auto" }}
        >
          Deal Analysis
        </h1>
        <p className="text-[14px] text-ink-500 mt-3 max-w-xl leading-relaxed">
          {d.totalDeals} past deals at The Crescent, broken down by what they
          cost the venue to handle and what they returned.
        </p>
      </div>

      <ComplexitySection data={d} />
      <SizeSection data={d} />
      <CostsSection data={d} />
      <RevenueSection data={d} />
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2
        className="font-display text-[24px] font-medium text-ink-900"
        style={{ letterSpacing: "-0.02em" }}
      >
        {title}
      </h2>
      {subtitle && (
        <p className="text-[13px] text-ink-500 mt-1.5 max-w-2xl leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function ComplexitySection({ data }: { data: DealAnalysis }) {
  return (
    <section className="mb-16">
      <SectionHeader
        title="By complexity"
        subtitle="A derived score Mariana can use to spot which deals are quietly burning hours. Complex deals are also the ones the in-app tool can't settle."
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {data.byComplexity.map((c) => {
          const meta = COMPLEXITY_META[c.bucket];
          const inToolPct = c.count > 0 ? (c.inToolCount / c.count) * 100 : 0;
          return (
            <div
              key={c.bucket}
              className={`relative rounded-xl border border-ink-200/60 ${meta.bg} p-5 ring-1 ring-inset ${meta.ring}`}
            >
              <div className={`eyebrow text-[10px] mb-2 ${meta.fg}`}>
                {meta.label}
              </div>
              <div className="flex items-baseline gap-2">
                <div
                  className="text-[40px] font-mono tabular font-bold text-ink-900 leading-none"
                  style={{ letterSpacing: "-0.02em" }}
                >
                  {c.count}
                </div>
                <div className="text-[12px] font-mono tabular text-ink-500">
                  {(c.pct * 100).toFixed(0)}%
                </div>
              </div>
              <p className="text-[12px] text-ink-600 mt-2 leading-relaxed">
                {meta.blurb}
              </p>
              <div className="mt-4 pt-4 border-t border-ink-200/40 space-y-2">
                <Row
                  label="Avg payout"
                  value={c.avgPayout > 0 ? formatMoneyCompact(c.avgPayout) : "—"}
                />
                <Row label="Settled in tool" value={`${c.inToolCount} of ${c.count}`} />
                <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                  <div
                    className="h-full bg-brand-700"
                    style={{ width: `${inToolPct}%` }}
                  />
                </div>
                <div className="text-[10px] text-ink-400">
                  {inToolPct.toFixed(0)}% in tool ·{" "}
                  {(100 - inToolPct).toFixed(0)}% spreadsheet
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SizeSection({ data }: { data: DealAnalysis }) {
  const maxCount = Math.max(...data.bySize.map((b) => b.count), 1);
  return (
    <section className="mb-16">
      <SectionHeader
        title="By deal size"
        subtitle="Bucketed by guarantee. The high end is where disputes actually move money."
      />
      <Card>
        <CardContent>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left border-b border-ink-100/80">
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">
                  Bucket
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">
                  Volume
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Avg gross
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Avg to artist
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Dispute rate
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100/60">
              {data.bySize.map((b) => {
                const barWidth = (b.count / maxCount) * 100;
                const alarming = b.disputeRate >= 0.1;
                return (
                  <tr key={b.bucket}>
                    <td className="py-3 font-medium text-ink-900">{b.bucket}</td>
                    <td className="py-3 pr-6">
                      <div className="flex items-center gap-2 max-w-xs">
                        <div
                          className="h-5 rounded-[3px] bg-ink-300/80 flex items-center min-w-[24px]"
                          style={{ width: `${Math.max(barWidth, 3)}%` }}
                        >
                          <span className="text-[10px] font-mono tabular font-medium text-white px-1.5">
                            {b.count}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono tabular text-ink-400">
                          {(b.pct * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 text-right font-mono tabular">
                      {b.avgGross > 0 ? formatMoneyCompact(b.avgGross) : "—"}
                    </td>
                    <td className="py-3 text-right font-mono tabular">
                      {b.avgToArtist > 0 ? formatMoneyCompact(b.avgToArtist) : "—"}
                    </td>
                    <td
                      className={`py-3 text-right font-mono tabular ${
                        alarming ? "text-rose-700 font-semibold" : "text-ink-600"
                      }`}
                    >
                      {(b.disputeRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}

function CostsSection({ data }: { data: DealAnalysis }) {
  const { costs } = data;
  const expenseEntries = Object.entries(costs.expensesByCategory).sort(
    ([, a], [, b]) => b - a,
  );
  const recoupEntries = Object.entries(costs.recoupsByCategory).sort(
    ([, a], [, b]) => b.amount - a.amount,
  );
  const maxExpense = Math.max(...expenseEntries.map(([, v]) => v), 1);
  const maxRecoup = Math.max(...recoupEntries.map(([, v]) => v.amount), 1);

  return (
    <section className="mb-16">
      <SectionHeader
        title="Costs"
        subtitle="What the venue actually spends and recoups against the artist's share. Recoups are the most frequent dispute trigger."
      />
      <div className="flex items-baseline gap-10 pb-5 mb-6 border-b border-ink-200/60">
        <Stat label="Total expenses" value={formatMoneyCompact(costs.totalExpenses)} mono />
        <Stat label="Total recouped" value={formatMoneyCompact(costs.totalRecoups)} mono />
        <Stat
          label="Disputed recoup value"
          value={formatMoney(costs.disputedRecoupValue)}
          mono
          alarming={costs.disputedRecoupValue > 0}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card>
          <CardContent>
            <div className="eyebrow text-[10px] text-ink-500 mb-4">
              Expenses by category
            </div>
            {expenseEntries.length === 0 ? (
              <div className="text-[13px] text-ink-400">No expenses recorded.</div>
            ) : (
              <div className="space-y-2">
                {expenseEntries.map(([cat, amount]) => {
                  const pct = (amount / maxExpense) * 100;
                  return (
                    <div key={cat} className="flex items-center gap-3">
                      <div className="w-28 text-right">
                        <span className="text-[12px] text-ink-700">
                          {EXPENSE_LABELS[cat] ?? cat}
                        </span>
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <div
                          className="h-6 rounded-[3px] bg-ink-300/80 flex items-center min-w-[24px]"
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        />
                        <span className="text-[11px] font-mono tabular text-ink-600 whitespace-nowrap">
                          {formatMoneyCompact(amount)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="eyebrow text-[10px] text-rose-700 mb-4">
              Recoups by category · disputed value highlighted
            </div>
            {recoupEntries.length === 0 ? (
              <div className="text-[13px] text-ink-400">No recoups recorded.</div>
            ) : (
              <div className="space-y-2">
                {recoupEntries.map(([cat, v]) => {
                  const pct = (v.amount / maxRecoup) * 100;
                  const disputedPct =
                    v.amount > 0 ? (v.disputedAmount / v.amount) * 100 : 0;
                  return (
                    <div key={cat} className="flex items-center gap-3">
                      <div className="w-32 text-right">
                        <span className="text-[12px] text-ink-700">
                          {RECOUP_LABELS[cat] ?? cat}
                        </span>
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <div
                          className="h-6 rounded-[3px] bg-ink-300/70 relative flex items-center min-w-[24px] overflow-hidden"
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        >
                          {disputedPct > 0 && (
                            <div
                              className="h-full bg-rose-500/90"
                              style={{ width: `${disputedPct}%` }}
                            />
                          )}
                        </div>
                        <span className="text-[11px] font-mono tabular text-ink-600 whitespace-nowrap">
                          {formatMoneyCompact(v.amount)}
                        </span>
                        {v.disputedAmount > 0 && (
                          <span className="text-[10px] font-mono tabular text-rose-700 whitespace-nowrap">
                            ({formatMoneyCompact(v.disputedAmount)} disputed)
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function RevenueSection({ data }: { data: DealAnalysis }) {
  const { revenue } = data;
  const dealTypes = Object.keys(revenue.byDealType).sort(
    (a, b) => revenue.byDealType[b].gross - revenue.byDealType[a].gross,
  );
  const maxMonthGross = Math.max(...revenue.months.map((m) => m.gross), 1);

  return (
    <section className="mb-10">
      <SectionHeader
        title="Revenue"
        subtitle="Gross box office, net to venue (gross minus what goes to the artist and to expenses), and total to artist — by deal type and by month."
      />
      <Card className="mb-5">
        <CardContent>
          <div className="eyebrow text-[10px] text-ink-500 mb-4">
            By deal type
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left border-b border-ink-100/80">
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">
                  Deal type
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Shows
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Gross
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  To artist
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">
                  Net to venue
                </th>
                <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold pl-4">
                  Trend (gross / month)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100/60">
              {dealTypes.map((t) => {
                const r = revenue.byDealType[t];
                const supported = t === "flat" || t === "percentage_of_gross";
                const monthGross = revenue.months.map((m) => m.byType[t] ?? 0);
                const peak = Math.max(...monthGross, 1);
                return (
                  <tr key={t}>
                    <td className="py-2.5">
                      <span className="text-ink-900 font-medium">
                        {DEAL_LABELS[t] ?? t}
                      </span>
                      {!supported && (
                        <span className="ml-2 text-[9px] text-amber-700 uppercase tracking-[0.08em] font-semibold">
                          unsupported
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular text-ink-600">
                      {r.count}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular">
                      {formatMoneyCompact(r.gross)}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular text-ink-600">
                      {formatMoneyCompact(r.toArtist)}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular text-brand-800 font-semibold">
                      {formatMoneyCompact(r.netToVenue)}
                    </td>
                    <td className="py-2.5 pl-4">
                      <div className="flex items-end gap-[2px] h-7">
                        {monthGross.map((g, i) => (
                          <div
                            key={i}
                            className={`w-[3px] rounded-[1px] ${
                              supported ? "bg-brand-600/70" : "bg-amber-500/70"
                            }`}
                            style={{ height: `${(g / peak) * 100}%`, minHeight: g > 0 ? "2px" : "1px" }}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="eyebrow text-[10px] text-ink-500 mb-4">
            By month · last 24
          </div>
          <div className="flex items-end gap-[3px] h-32">
            {revenue.months.map((m) => {
              const h = (m.gross / maxMonthGross) * 100;
              return (
                <div
                  key={m.month}
                  className="flex-1 flex flex-col items-center gap-1 group"
                  title={`${m.label}: ${formatMoney(m.gross)} gross · ${formatMoney(m.netToVenue)} net to venue`}
                >
                  <div className="flex-1 flex items-end w-full">
                    <div
                      className="w-full rounded-t-[2px] bg-brand-600/80 group-hover:bg-brand-700 transition-colors"
                      style={{ height: `${Math.max(h, 1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-[3px] mt-1.5">
            {revenue.months.map((m, i) => (
              <div
                key={m.month}
                className="flex-1 text-center text-[8.5px] font-mono tabular text-ink-400"
              >
                {i % 3 === 0 ? m.label : ""}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-[12px]">
      <span className="text-ink-500">{label}</span>
      <span className="font-mono tabular text-ink-800 font-medium">{value}</span>
    </div>
  );
}

function Stat({
  label, value, mono = false, alarming = false,
}: {
  label: string; value: string; mono?: boolean; alarming?: boolean;
}) {
  return (
    <div>
      <div className={`eyebrow text-[10px] ${alarming ? "text-rose-700" : "text-ink-400"}`}>
        {label}
      </div>
      <div
        className={`text-[28px] font-medium mt-1 leading-none ${
          alarming ? "text-rose-700" : "text-ink-900"
        } ${mono ? "font-mono tabular !font-semibold" : "font-display"}`}
        style={!mono ? { letterSpacing: "-0.02em" } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
