"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Table2, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  SettlementWorkspaceSeed,
  WorkspaceExpenseCategory,
  WorkspaceExpenseLineSeed,
  WorkspaceRevenueLineSeed,
} from "@/lib/settlementWorkspaceSeed";
import { saveWorkspaceSettlement } from "./actions";

const EXPENSE_CATEGORIES: { value: WorkspaceExpenseCategory; label: string }[] = [
  { value: "production", label: "Production" },
  { value: "sound", label: "Sound" },
  { value: "lights", label: "Lights" },
  { value: "hospitality", label: "Hospitality" },
  { value: "marketing", label: "Marketing" },
  { value: "backline", label: "Backline" },
  { value: "security", label: "Security" },
  { value: "other", label: "Other" },
];

function newEmptyExpenseLine(): WorkspaceExpenseLineSeed {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `exp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    label: "",
    category: "other",
    actual: "0",
    venueAbsorbed: false,
  };
}

function parsePositiveCap(s: string): number | null {
  const n = parseFloat(String(s).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** If sum(amounts) > cap, scale each amount down proportionally so the sum equals cap. */
function scaleGroupToCap(amounts: number[], cap: number | null): number[] {
  if (amounts.length === 0) return [];
  if (cap == null) return amounts.slice();
  const total = amounts.reduce((a, b) => a + b, 0);
  if (total <= cap || total <= 0) return amounts.slice();
  const scale = cap / total;
  return amounts.map((a) => a * scale);
}

function parseAmount(s: string): number {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatDisplay(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export type SettlementWorkspaceProps = SettlementWorkspaceSeed & {
  showId: string;
};

export function SettlementWorkspace({
  showId,
  dealType,
  initialRevenue,
  initialExpenses,
  initialLogic,
  initialPayoutNotes,
}: SettlementWorkspaceProps) {
  const router = useRouter();
  const [savePending, startSaveTransition] = useTransition();
  const [saveFeedback, setSaveFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [revenue, setRevenue] = useState<WorkspaceRevenueLineSeed[]>(() => [
    ...initialRevenue,
  ]);
  const [expenses, setExpenses] = useState<WorkspaceExpenseLineSeed[]>(() => [
    ...initialExpenses,
  ]);
  const [logic, setLogic] = useState(() => ({
    ...initialLogic,
    expenseCap: initialLogic.expenseCap ?? "",
    hospitalityCap: initialLogic.hospitalityCap ?? "",
  }));
  const [payoutNotes, setPayoutNotes] = useState(() => ({
    ...initialPayoutNotes,
  }));

  const { effectiveDeductibleByIndex, deductibleTotal, expenseCapApplied } =
    useMemo(() => {
    const capExpenseGlobal = parsePositiveCap(logic.expenseCap ?? "");
    const capHospitality = parsePositiveCap(logic.hospitalityCap ?? "");

    const actualNums = expenses.map((e) => parseAmount(e.actual));

    const hospitalityIdx: number[] = [];
    for (let i = 0; i < expenses.length; i++) {
      if (expenses[i].venueAbsorbed) continue;
      if (expenses[i].category === "hospitality") hospitalityIdx.push(i);
    }

    const hAmounts = hospitalityIdx.map((i) => actualNums[i]);
    const hScaled = scaleGroupToCap(hAmounts, capHospitality);

    const fromHospitality = new Map<number, number>();
    hospitalityIdx.forEach((i, j) => fromHospitality.set(i, hScaled[j] ?? 0));

    const preGlobal: number[] = expenses.map((e, i) => {
      if (e.venueAbsorbed) return 0;
      if (e.category === "hospitality") return fromHospitality.get(i) ?? 0;
      return actualNums[i];
    });

    const sumPre = preGlobal.reduce((s, n) => s + n, 0);
    let effective: number[];
    if (
      capExpenseGlobal != null &&
      sumPre > capExpenseGlobal + 1e-9 &&
      sumPre > 0
    ) {
      const factor = capExpenseGlobal / sumPre;
      effective = preGlobal.map((n) => n * factor);
    } else {
      effective = preGlobal.slice();
    }

    const deductibleTotal = effective.reduce((s, n) => s + n, 0);
    const expenseCapApplied =
      capExpenseGlobal != null &&
      sumPre > capExpenseGlobal + 1e-9 &&
      sumPre > 0;
    return {
      effectiveDeductibleByIndex: effective,
      deductibleTotal,
      expenseCapApplied,
    };
  }, [expenses, logic.expenseCap, logic.hospitalityCap]);

  const grossRevenue = useMemo(
    () =>
      revenue
        .filter((r) => r.bucket === "gross")
        .reduce((s, r) => s + parseAmount(r.amount), 0),
    [revenue]
  );
  const ticketingFees = useMemo(
    () =>
      revenue
        .filter((r) => r.bucket === "fees")
        .reduce((s, r) => s + parseAmount(r.amount), 0),
    [revenue]
  );
  const netTicketRevenue = grossRevenue - ticketingFees;
  const netRevenue = netTicketRevenue - deductibleTotal;
  const artistPctRaw = parseAmount(logic.artistPercentage) / 100;
  const artistPct = Number.isFinite(artistPctRaw) ? artistPctRaw : 0;
  const artistShare = netRevenue * artistPct;
  const guaranteeAmount = parseAmount(logic.guarantee);
  const guaranteeForVs = Number.isFinite(guaranteeAmount) ? guaranteeAmount : 0;
  const isVsDeal = dealType === "vs";
  const finalPayout = isVsDeal
    ? Math.max(artistShare, guaranteeForVs)
    : artistShare;

  const inputClass =
    "h-8 w-full min-w-0 rounded-md border border-ink-200/90 bg-white px-2.5 text-[13px] font-mono tabular text-ink-900 shadow-sm placeholder:text-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 focus-visible:border-brand-500/50";

  const selectClass =
    "h-8 w-full min-w-0 rounded-md border border-ink-200/90 bg-white px-2 text-[12px] text-ink-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 focus-visible:border-brand-500/50";

  return (
    <div className="w-full rounded-lg border border-ink-200/80 bg-white shadow-[0_1px_2px_rgba(26,24,20,0.03)] overflow-hidden">
      <div className="px-5 py-4 border-b border-ink-100/80 flex flex-wrap items-start gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 rounded-md bg-brand-50 p-2 text-brand-700 ring-1 ring-brand-200/60">
            <Table2 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-ink-900 tracking-tight">
              Settlement workspace
            </h3>
            <p className="text-[12px] text-ink-500 mt-0.5 leading-relaxed">
              Worksheet UI only — figures below are for layout and do not run
              production settlement logic.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 space-y-4 w-full">
          {/* Revenue */}
          <Card className="border-ink-200/70 shadow-none">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-[12px]">Revenue</CardTitle>
              <CardDescription className="text-[11px]">
                Ticket and related revenue lines before artist split.
              </CardDescription>
            </CardHeader>
            <CardContent className="py-3 px-4 space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] gap-x-3 gap-y-1 text-[10px] font-medium uppercase tracking-wide text-ink-400 px-0.5">
                <span>Line</span>
                <span className="text-right">Amount</span>
              </div>
              {revenue.map((row, idx) => (
                <div key={row.id} className="space-y-1">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] gap-x-3 gap-y-2 items-center">
                    <label className="text-[12.5px] text-ink-800 flex items-center gap-2 min-w-0">
                      <span className="truncate">{row.label}</span>
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-ink-400 tabular">
                        {row.bucket === "gross" ? "Gross" : "Fees"}
                      </span>
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={inputClass}
                      value={row.amount}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setRevenue((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, amount: v } : r
                          )
                        );
                      }}
                    />
                  </div>
                  {row.helper && (
                    <p className="text-[11px] text-ink-400 leading-snug pl-0.5 col-span-2">
                      {row.helper}
                    </p>
                  )}
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] gap-x-3 pt-2 mt-1 border-t border-ink-100/90 items-center">
                <span className="text-[12px] font-medium text-ink-700">
                  Net ticket revenue
                </span>
                <span className="text-right font-mono tabular text-[13px] text-ink-900">
                  {formatDisplay(netTicketRevenue)}
                </span>
              </div>
              <p className="text-[11px] text-ink-400 leading-snug">
                Net ticket revenue = sum of lines tagged Gross minus sum of
                lines tagged Fees (from ticket_sales captures in the database).
              </p>
            </CardContent>
          </Card>

          {/* Expenses */}
          <Card className="border-ink-200/70 shadow-none">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-[12px]">Expenses & deductions</CardTitle>
              <CardDescription className="text-[11px]">
                Add or remove lines. Deductibles start from actuals (hospitality
                lines share the{" "}
                <span className="font-medium text-ink-600">hospitality cap</span>
                ). If the total exceeds the deal{" "}
                <span className="font-medium text-ink-600">expense cap</span>,
                every line is scaled down so the total equals the cap — same
                numbers as the payout summary. Venue-absorbed lines do not
                reduce artist net.
              </CardDescription>
            </CardHeader>
            <CardContent className="py-3 px-4 space-y-3">
              {expenses.length === 0 ? (
                <div className="rounded-md border border-dashed border-ink-200/80 bg-ink-50/30 px-4 py-6 text-center">
                  <p className="text-[12px] text-ink-500 mb-3">
                    No expense lines yet.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setExpenses([newEmptyExpenseLine()])}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add expense
                  </Button>
                </div>
              ) : (
                <>
                  <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_8.5rem_5.5rem_5.5rem_5.5rem_2.25rem] gap-x-2 text-[10px] font-medium uppercase tracking-wide text-ink-400 px-0.5">
                    <span>Description</span>
                    <span>Category</span>
                    <span className="text-center">Venue</span>
                    <span className="text-right">Actual</span>
                    <span className="text-right">Deductible</span>
                    <span />
                  </div>
                  {expenses.map((row, idx) => {
                    const eff = effectiveDeductibleByIndex[idx] ?? 0;
                    const actualN = parseAmount(row.actual);
                    const scaled =
                      !row.venueAbsorbed && eff < actualN - 0.005;
                    return (
                      <div
                        key={row.id}
                        className="rounded-md bg-canvas-soft/50 ring-1 ring-ink-100/80 p-3 space-y-2"
                      >
                        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_8.5rem_5.5rem_5.5rem_5.5rem_2.25rem] gap-2 lg:gap-x-2 lg:items-center">
                          <div>
                            <span className="lg:hidden text-[10px] uppercase text-ink-400 font-medium">
                              Description
                            </span>
                            <input
                              type="text"
                              placeholder="e.g. Posters · radio"
                              className={cn(inputClass, "mt-0.5 lg:mt-0 font-sans")}
                              value={row.label}
                              onChange={(ev) => {
                                const v = ev.target.value;
                                setExpenses((prev) =>
                                  prev.map((e, i) =>
                                    i === idx ? { ...e, label: v } : e
                                  )
                                );
                              }}
                            />
                          </div>
                          <div>
                            <span className="lg:hidden text-[10px] uppercase text-ink-400 font-medium">
                              Category
                            </span>
                            <select
                              className={cn(selectClass, "mt-0.5 lg:mt-0")}
                              value={row.category}
                              onChange={(ev) => {
                                const v = ev.target
                                  .value as WorkspaceExpenseCategory;
                                setExpenses((prev) =>
                                  prev.map((e, i) =>
                                    i === idx ? { ...e, category: v } : e
                                  )
                                );
                              }}
                            >
                              {EXPENSE_CATEGORIES.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-2 lg:justify-center">
                            <input
                              type="checkbox"
                              id={`venue-${row.id}`}
                              className="h-3.5 w-3.5 rounded border-ink-300 text-brand-700 focus:ring-brand-600/30"
                              checked={row.venueAbsorbed}
                              onChange={(ev) => {
                                const v = ev.target.checked;
                                setExpenses((prev) =>
                                  prev.map((e, i) =>
                                    i === idx ? { ...e, venueAbsorbed: v } : e
                                  )
                                );
                              }}
                            />
                            <label
                              htmlFor={`venue-${row.id}`}
                              className="text-[11px] text-ink-600 lg:sr-only cursor-pointer"
                            >
                              Venue absorbed
                            </label>
                          </div>
                          <div>
                            <span className="lg:hidden text-[10px] uppercase text-ink-400 font-medium">
                              Actual
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              className={cn(inputClass, "mt-0.5 lg:mt-0")}
                              value={row.actual}
                              onChange={(ev) => {
                                const v = ev.target.value;
                                setExpenses((prev) =>
                                  prev.map((e, i) =>
                                    i === idx ? { ...e, actual: v } : e
                                  )
                                );
                              }}
                            />
                          </div>
                          <div>
                            <span className="lg:hidden text-[10px] uppercase text-ink-400 font-medium">
                              Deductible
                            </span>
                            <div
                              className={cn(
                                inputClass,
                                "mt-0.5 lg:mt-0 flex items-center justify-end bg-ink-50/50 text-ink-800",
                                scaled && "ring-1 ring-amber-300/60 bg-amber-50/40"
                              )}
                              title={
                                scaled
                                  ? "Reduced to fit deal cap (split across same-category lines)"
                                  : undefined
                              }
                            >
                              {formatDisplay(eff)}
                            </div>
                          </div>
                          <div className="flex lg:justify-end">
                            <button
                              type="button"
                              className="rounded-md p-2 text-ink-400 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                              aria-label="Remove expense line"
                              onClick={() =>
                                setExpenses((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        {row.helper && (
                          <p className="text-[11px] text-ink-400 leading-snug">
                            {row.helper}
                          </p>
                        )}
                        {scaled && (
                          <p className="text-[10px] text-amber-800/90 leading-snug">
                            Deductible is below actual because of hospitality cap
                            and/or total expense cap (Settlement logic).
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 w-full sm:w-auto"
                    onClick={() =>
                      setExpenses((prev) => [...prev, newEmptyExpenseLine()])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add expense
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Settlement logic */}
          <Card className="border-ink-200/70 shadow-none">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-[12px]">Settlement logic</CardTitle>
              <CardDescription className="text-[11px]">
                Deal mechanics — fields are placeholders until rules engine ships.
              </CardDescription>
            </CardHeader>
            <CardContent className="py-3 px-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="eyebrow text-[10px] text-ink-500 mb-1.5 block">
                  Split basis
                </label>
                <select
                  className={selectClass}
                  value={logic.dealBasis}
                  onChange={(ev) =>
                    setLogic((l) => ({ ...l, dealBasis: ev.target.value }))
                  }
                >
                  <option value="net_after_deductions">Net after deductions</option>
                  <option value="gross_before_expenses">Gross before expenses</option>
                  <option value="door_net">Door / net walk</option>
                </select>
              </div>
              <div>
                <label className="eyebrow text-[10px] text-ink-500 mb-1.5 block">
                  Artist percentage
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    className={inputClass}
                    value={logic.artistPercentage}
                    onChange={(ev) =>
                      setLogic((l) => ({
                        ...l,
                        artistPercentage: ev.target.value,
                      }))
                    }
                  />
                  <span className="text-[12px] text-ink-500 shrink-0">%</span>
                </div>
              </div>
              <div>
                <label className="eyebrow text-[10px] text-ink-500 mb-1.5 block">
                  Guarantee (reference)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  value={logic.guarantee}
                  onChange={(ev) =>
                    setLogic((l) => ({ ...l, guarantee: ev.target.value }))
                  }
                />
              </div>
              <div>
                <label className="eyebrow text-[10px] text-ink-500 mb-1.5 block">
                  Expense cap (total deductible)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  value={logic.expenseCap}
                  onChange={(ev) =>
                    setLogic((l) => ({ ...l, expenseCap: ev.target.value }))
                  }
                />
                <p className="text-[10px] text-ink-400 mt-1 leading-snug">
                  From deal <code className="text-[9px]">expense_cap</code>. When
                  set, if the sum of all deductible lines (after hospitality
                  pooling) is higher than this amount, each line is scaled so the
                  total equals the cap — used in net revenue and final payout.
                </p>
              </div>
              <div>
                <label className="eyebrow text-[10px] text-ink-500 mb-1.5 block">
                  Hospitality cap
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  value={logic.hospitalityCap}
                  onChange={(ev) =>
                    setLogic((l) => ({ ...l, hospitalityCap: ev.target.value }))
                  }
                />
                <p className="text-[10px] text-ink-400 mt-1 leading-snug">
                  From deal <code className="text-[9px]">hospitality_cap</code>.
                  Same proportional split across hospitality lines.
                </p>
              </div>
              <div className="sm:col-span-2 space-y-2">
                <label className="eyebrow text-[10px] text-ink-500 block">
                  Guarantee vs percentage (notes)
                </label>
                <input
                  type="text"
                  className={cn(inputClass, "font-sans text-left")}
                  value={payoutNotes.guaranteeApplied}
                  onChange={(ev) =>
                    setPayoutNotes((n) => ({
                      ...n,
                      guaranteeApplied: ev.target.value,
                    }))
                  }
                />
                <label className="eyebrow text-[10px] text-ink-500 block pt-1">
                  Walkout / breakeven (notes)
                </label>
                <input
                  type="text"
                  className={cn(inputClass, "font-sans text-left text-[12px]")}
                  value={payoutNotes.walkoutNote}
                  onChange={(ev) =>
                    setPayoutNotes((n) => ({
                      ...n,
                      walkoutNote: ev.target.value,
                    }))
                  }
                />
                <p className="text-[11px] text-ink-400 leading-snug">
                  Example: “Walkout not triggered — breakeven not reached”
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Final payout summary (in flow) */}
          <Card className="border-ink-200/70 shadow-none">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-[12px]">Final payout summary</CardTitle>
              <CardDescription className="text-[11px]">
                Line-by-line recap mirroring the sticky summary — edit sources
                above.
              </CardDescription>
            </CardHeader>
            <CardContent className="py-3 px-4 space-y-0 divide-y divide-ink-100/90">
              <SummaryRow label="Gross revenue" value={grossRevenue} />
              <SummaryRow
                label={
                  expenseCapApplied
                    ? "Deductible expenses (at expense cap)"
                    : "Deductible expenses"
                }
                value={deductibleTotal}
              />
              <SummaryRow label="Net revenue (preview)" value={netRevenue} />
              <SummaryRow label="Artist share (preview)" value={artistShare} />
              {isVsDeal && (
                <SummaryRow label="Guarantee (vs floor)" value={guaranteeForVs} />
              )}
              <SummaryRow
                label={
                  isVsDeal
                    ? "Final payout (preview, vs: max of share & guarantee)"
                    : "Final payout (preview)"
                }
                value={finalPayout}
                emphasize
              />
              {isVsDeal && (
                <p className="text-[11px] text-ink-500 pt-1 pb-0.5 leading-snug">
                  {finalPayout === artistShare && artistShare > guaranteeForVs
                    ? "Percentage share is above guarantee — payout uses the share."
                    : finalPayout === guaranteeForVs && guaranteeForVs > artistShare
                      ? "Guarantee is above percentage share — payout uses the guarantee."
                      : "Share and guarantee tie at this preview — payout uses that amount."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sticky outcome */}
        <aside className="w-full lg:w-[17.5rem] shrink-0 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-lg border border-ink-200/80 bg-canvas-soft/80 ring-1 ring-ink-100/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-100/80 bg-white/60">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                Settlement outcome
              </div>
              <p className="text-[11px] text-ink-500 mt-1 leading-snug">
                Live preview from worksheet inputs — not audited.
              </p>
            </div>
            <div className="px-4 py-3 space-y-0 divide-y divide-ink-100/80">
              <StickyRow label="Gross revenue" value={grossRevenue} />
              <StickyRow
                label={
                  expenseCapApplied
                    ? "Deductible expenses (capped)"
                    : "Deductible expenses"
                }
                value={deductibleTotal}
              />
              <StickyRow label="Net revenue" value={netRevenue} />
              <StickyRow label="Artist share" value={artistShare} />
              {isVsDeal && (
                <StickyRow label="Guarantee (vs)" value={guaranteeForVs} />
              )}
              <div className="pt-3 mt-1">
                <div className="rounded-md bg-brand-700 px-3 py-2.5 text-white shadow-sm ring-1 ring-inset ring-brand-800/20">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-100/90">
                    {isVsDeal ? "Final payout (vs max)" : "Final payout"}
                  </div>
                  <div className="font-mono tabular text-[18px] font-semibold mt-0.5 tracking-tight">
                    ${formatDisplay(finalPayout)}
                  </div>
                  {isVsDeal && (
                    <p className="text-[10px] text-brand-100/85 mt-2 leading-snug">
                      {finalPayout === artistShare && artistShare > guaranteeForVs
                        ? "Using percentage share (above guarantee)."
                        : finalPayout === guaranteeForVs && guaranteeForVs > artistShare
                          ? "Using guarantee (above percentage share)."
                          : "Share and guarantee match this preview."}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-ink-100/80 bg-white/40 space-y-2">
              <Button
                type="button"
                variant="brand"
                size="sm"
                className="w-full gap-1.5"
                disabled={savePending}
                onClick={() => {
                  setSaveFeedback(null);
                  startSaveTransition(async () => {
                    const res = await saveWorkspaceSettlement(showId, {
                      totalToArtist: finalPayout,
                      grossBoxOffice: grossRevenue,
                      netBoxOffice: netTicketRevenue,
                      totalExpenses: deductibleTotal,
                      snapshot: {
                        dealType,
                        grossRevenue,
                        ticketingFees,
                        netTicketRevenue,
                        deductibleTotal,
                        netRevenue,
                        artistShare,
                        finalPayout,
                        isVsDeal,
                        guaranteeForVs: isVsDeal ? guaranteeForVs : undefined,
                        expenseCapApplied,
                        logic: { ...logic },
                        expenseLineCount: expenses.length,
                        revenueLineCount: revenue.length,
                      },
                    });
                    if (res.ok) {
                      setSaveFeedback({
                        tone: "success",
                        message: "Settlement totals saved from this workspace.",
                      });
                      router.refresh();
                    } else {
                      setSaveFeedback({
                        tone: "error",
                        message: res.error,
                      });
                    }
                  });
                }}
              >
                <Save className="h-3.5 w-3.5" />
                {savePending ? "Saving…" : "Save settlement totals"}
              </Button>
              {saveFeedback && (
                <p
                  className={
                    saveFeedback.tone === "success"
                      ? "text-[11px] text-emerald-800 leading-snug"
                      : "text-[11px] text-rose-800 leading-snug"
                  }
                >
                  {saveFeedback.message}
                </p>
              )}
              <p className="text-[10px] text-ink-400 leading-snug">
                Writes gross, net ticket revenue, deductible total, and payout to
                this show&apos;s settlement row (draft or in-flight). Blocked
                when status is paid or voided.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 py-2.5 text-[12.5px]",
        emphasize &&
          "rounded-md bg-brand-50/50 ring-1 ring-brand-200/45 px-3 py-3 my-0.5"
      )}
    >
      <span
        className={cn(
          "text-ink-600",
          emphasize && "font-semibold text-ink-900"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-mono tabular text-ink-900 text-[13px]",
          emphasize && "text-brand-800 font-semibold text-[15px]"
        )}
      >
        ${formatDisplay(value)}
      </span>
    </div>
  );
}

function StickyRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 first:pt-0">
      <span className="text-[11.5px] text-ink-500 leading-tight">{label}</span>
      <span className="font-mono tabular text-[12.5px] text-ink-900 text-right shrink-0">
        ${formatDisplay(value)}
      </span>
    </div>
  );
}
