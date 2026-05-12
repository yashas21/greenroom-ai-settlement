import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft, FileSpreadsheet, AlertCircle, Clock, TrendingUp, FileJson, Loader2,
  Shield, Check, X, Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription, Field,
} from "@/components/ui/card";
import { StatusBadge, DealTypeBadge, PlainBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseBonuses } from "@/lib/dealMath";
import {
  formatMoney, formatMoneyCompact, formatShowDateFull, relativeShowDate,
} from "@/lib/format";
import type { Bonus, SwitchSuggestion, Deal, Settlement } from "@/lib/types";
import { useApiData, LoadingState } from "@/hooks/useApiData";
import NotFound from "./not-found";

const COMP_LABELS: Record<string, string> = {
  artist_gl: "Artist guest list",
  label: "Label / management",
  press: "Press",
  venue_staff: "Venue staff",
  sponsor: "Sponsor",
  promo: "Promo / radio",
  other: "Other",
};

function ExportJsonButton({ showId, artistName, date }: { showId: string; artistName: string; date: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function handleClick() {
    setState("loading");
    setErr(null);
    try {
      const data = await api.showExport(showId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = artistName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      a.href = url;
      a.download = `greenroom-${date}-${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setState("idle");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to generate JSON");
      setState("error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="ghost" size="sm" onClick={handleClick} disabled={state === "loading"}>
        {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileJson className="h-3.5 w-3.5" />}
        {state === "loading" ? "Generating…" : "Generate JSON"}
      </Button>
      {state === "error" && err && (
        <span className="text-[11px] text-rose-600">{err}</span>
      )}
    </div>
  );
}

export default function ShowDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const state = useApiData(() => api.show(id), [id]);

  if (state.status === "loading") return <LoadingState label="Loading show..." />;
  if (state.status === "error") {
    if (state.error.message === "not_found") return <NotFound />;
    return <LoadingState label={`Error: ${state.error.message}`} />;
  }

  const data = state.data;
  const { show, artist, agent, agency, deal, settlement, ticketSales, expenses, comps } = data;

  const grossSoFar = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const totalTickets = ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);
  const totalExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);
  const absorbedTotal = expenses
    .filter((e) => e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);

  const totalCompCount = comps.reduce((s, c) => s + c.count, 0);
  const compsCountingTowardGross = comps
    .filter((c) => c.countsTowardGross)
    .reduce((s, c) => s + c.count, 0);

  const bonuses = deal ? parseBonuses(deal) : [];

  const isUnsupported = data.isUnsupportedDeal;
  const isDisputed = data.isDisputed;

  return (
    <div className="max-w-7xl">
      <div className={`px-12 pt-10 pb-14 ${isDisputed ? "bg-gradient-to-b from-rose-50/40 to-canvas" : "bg-gradient-to-b from-brand-50/30 to-canvas"}`}>
        <Link
          href="/shows"
          className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-900 mb-8 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All shows
        </Link>

        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-1.5 mb-4">
              <StatusBadge status={show.status} />
              {deal && <DealTypeBadge type={deal.dealType} />}
              {isUnsupported && <PlainBadge variant="amber">Unsupported</PlainBadge>}
              {isDisputed && <PlainBadge variant="rose">Disputed</PlainBadge>}
              {bonuses.length > 0 && (
                <PlainBadge variant="brand">
                  {bonuses.length} bonus{bonuses.length === 1 ? "" : "es"}
                </PlainBadge>
              )}
            </div>
            <h1
              className="font-display text-[56px] font-medium text-ink-900 leading-[1.02]"
              style={{ letterSpacing: "-0.025em", fontOpticalSizing: "auto" }}
            >
              {artist?.name ?? "—"}
            </h1>
            <div className="text-[14px] text-ink-400 mt-3 flex items-center gap-2">
              <span className="text-ink-600 font-medium">{formatShowDateFull(show.date)}</span>
              <span className="text-ink-300">·</span>
              <span>{relativeShowDate(show.date)}</span>
              <span className="text-ink-200">·</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                doors {show.doorsTime} · set {show.setTime}
              </span>
            </div>
          </div>
          <div className="mt-6 shrink-0 flex flex-col items-end gap-2">
            <Link href={`/shows/${show.id}/settle`}>
              <Button variant="brand" size="lg">
                <FileSpreadsheet className="h-4 w-4" />
                {settlement ? "View settlement" : "Settle show"}
              </Button>
            </Link>
            <ExportJsonButton showId={show.id} artistName={artist?.name ?? "show"} date={show.date} />
          </div>
        </div>

        <div className="flex items-baseline gap-10 mt-8 pt-5 border-t border-ink-200/40">
          <MiniStat label="Gross" value={formatMoneyCompact(grossSoFar)} />
          <MiniStat label="Tickets" value={String(totalTickets)} />
          <MiniStat label="Expenses" value={formatMoneyCompact(totalExpenses)} />
          {settlement?.totalToArtist != null && (
            <MiniStat label="To artist" value={formatMoneyCompact(settlement.totalToArtist)} accent />
          )}
        </div>
      </div>

      <div className="px-12 pb-12">
        {show.internalNotes && (
          <div className="mb-8 mt-1 rounded-lg bg-amber-50/50 ring-1 ring-amber-200/60 p-5 flex gap-3">
            <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
            <div>
              <div className="eyebrow text-[10px] text-amber-800 mb-1.5">
                Mariana&apos;s notes
              </div>
              <div className="text-[13px] text-ink-800 leading-relaxed">
                {show.internalNotes}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-2">
          {deal && (deal.dealType === "vs" || deal.dealType === "percentage_of_net" || deal.dealType === "door") && (
            <SmartSwitchPanel
              showId={show.id}
              deal={deal}
              settlement={settlement}
              initial={data.switchSuggestion}
            />
          )}

          <Card className="md:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Deal terms</CardTitle>
                <CardDescription>
                  What was negotiated. Mariana enters this from the email
                  thread with the agent.
                </CardDescription>
              </div>
              {deal && <DealTypeBadge type={deal.dealType} />}
            </CardHeader>
            <CardContent className="space-y-5">
              {deal ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Field
                      label="Guarantee" mono
                      value={deal.guaranteeAmount != null ? formatMoney(deal.guaranteeAmount) : "—"}
                    />
                    <Field
                      label="Percentage" mono
                      value={deal.percentage != null
                        ? `${(deal.percentage * 100).toFixed(0)}% ${deal.percentageBasis ? `of ${deal.percentageBasis}` : ""}`
                        : "—"}
                    />
                    <Field
                      label="Expense cap" mono
                      value={deal.expenseCap != null ? formatMoney(deal.expenseCap) : "—"}
                    />
                    <Field
                      label="Hospitality cap" mono
                      value={deal.hospitalityCap != null ? formatMoney(deal.hospitalityCap) : "—"}
                    />
                  </div>

                  {bonuses.length > 0 && (
                    <div className="rounded-lg ring-1 ring-brand-200/50 bg-brand-50/20 p-4">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <TrendingUp className="h-3.5 w-3.5 text-brand-700" />
                        <div className="eyebrow text-[10px] text-brand-800">
                          Bonuses & escalators (structured)
                        </div>
                      </div>
                      <ul className="space-y-2">
                        {bonuses.map((b, i) => (
                          <li key={i} className="text-[12.5px] text-ink-800 flex items-start gap-2">
                            <BonusBadge type={b.type} />
                            <span className="leading-relaxed">{b.label}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="text-[11px] text-ink-400 mt-3 leading-snug">
                        Stored in{" "}
                        <code className="font-mono text-[10px] bg-white/80 px-1 py-0.5 rounded ring-1 ring-ink-200/40">
                          bonuses_json
                        </code>
                        . The in-app tool only reads structured bonuses — anything
                        in the prose below is invisible to it.
                      </div>
                    </div>
                  )}

                  {deal.dealNotesFreetext && (
                    <div>
                      <div className="eyebrow text-[10px] text-ink-500 mb-2">
                        Deal notes (free text — what Mariana actually trusts)
                      </div>
                      <div className="text-[13px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/50 leading-relaxed font-[450]" style={{ fontStyle: "italic" }}>
                        {deal.dealNotesFreetext}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[13px] text-ink-400">No deal entered yet.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Artist & agent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Artist" value={artist?.name ?? "—"} />
              <Field
                label="Genre"
                value={<span className="capitalize">{artist?.genre ?? "—"}</span>}
              />
              <Field label="Prior shows here" value={String(artist?.priorShowCount ?? 0)} mono />
              <Field
                label="Agent"
                value={agent ? `${agent.name}${agency ? ` · ${agency.name}` : ""}` : "—"}
              />
              {agent?.preferencesNotes && (
                <div>
                  <div className="eyebrow text-[10px] text-ink-500 mb-2">Agent notes</div>
                  <div className="text-[12.5px] text-ink-800 bg-amber-50/50 ring-1 ring-amber-200/50 rounded-lg p-3 leading-relaxed">
                    {agent.preferencesNotes}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Box office</CardTitle>
              <CardDescription>From integrated ticketing.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <div className="eyebrow text-[10px] text-ink-400">Gross</div>
                  <div className="text-[28px] font-mono tabular font-semibold text-ink-900 mt-1 leading-none">
                    {formatMoneyCompact(grossSoFar)}
                  </div>
                </div>
                {totalTickets > 0 ? (
                  <div className="text-[12px] text-ink-500 pt-4 border-t border-ink-100/80 leading-relaxed">
                    <span className="font-mono tabular font-medium text-ink-700">{totalTickets}</span>{" "}
                    tickets ·{" "}
                    <span className="font-mono tabular">{formatMoney(totalFees)}</span>{" "}
                    in fees
                    <div className="mt-1.5 text-ink-400">
                      Net{" "}
                      <span className="font-mono tabular text-ink-700">
                        {formatMoneyCompact(grossSoFar - totalFees)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[12px] text-ink-400 pt-3 border-t border-ink-100/80">
                    No sales yet.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Comps</CardTitle>
                <CardDescription>
                  {totalCompCount} comp tickets across {comps.length}{" "}
                  categor{comps.length === 1 ? "y" : "ies"}.
                  {compsCountingTowardGross > 0 && (
                    <>
                      {" "}
                      <span className="text-amber-700 font-medium">
                        {compsCountingTowardGross} count toward gross.
                      </span>
                    </>
                  )}
                </CardDescription>
              </div>
              <PlainBadge variant="default">{totalCompCount} total</PlainBadge>
            </CardHeader>
            <CardContent>
              {comps.length === 0 ? (
                <div className="text-[13px] text-ink-400">
                  No comps recorded for this show.
                </div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left border-b border-ink-100/80">
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">Category</th>
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Count</th>
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Face value</th>
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Counts toward gross?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100/60">
                    {comps.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2.5">
                          {COMP_LABELS[c.category] ?? c.category}
                          {c.notes && <span className="text-ink-400 ml-1">· {c.notes}</span>}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular">{c.count}</td>
                        <td className="py-2.5 text-right font-mono tabular text-ink-500">
                          {formatMoney(c.faceValue * c.count)}
                        </td>
                        <td className="py-2.5 text-right">
                          {c.countsTowardGross ? (
                            <span className="text-amber-700 font-medium">Yes</span>
                          ) : (
                            <span className="text-ink-400">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card className="md:col-span-3">
            <CardHeader>
              <div>
                <CardTitle>Expenses</CardTitle>
                <CardDescription>Entered during the week, often incompletely.</CardDescription>
              </div>
              {absorbedTotal > 0 && (
                <PlainBadge variant="amber">{formatMoney(absorbedTotal)} absorbed</PlainBadge>
              )}
            </CardHeader>
            <CardContent>
              {expenses.length === 0 ? (
                <div className="text-[13px] text-ink-400">No expenses entered yet.</div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left border-b border-ink-100/80">
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">Category</th>
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold">Description</th>
                      <th className="py-2 eyebrow text-[10px] text-ink-400 font-semibold text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100/60">
                    {expenses.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2.5 capitalize">
                          {e.category}
                          {e.absorbedByVenue && (
                            <PlainBadge variant="amber" className="ml-2">absorbed</PlainBadge>
                          )}
                        </td>
                        <td className="py-2.5 text-ink-500">{e.description ?? "—"}</td>
                        <td className="py-2.5 text-right font-mono tabular">{formatMoney(e.amount)}</td>
                      </tr>
                    ))}
                    <tr className="font-medium">
                      <td className="py-3" colSpan={2}>Total (passed through)</td>
                      <td className="py-3 text-right font-mono tabular">{formatMoney(totalExpenses)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label, value, accent = false,
}: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="eyebrow text-[9px] text-ink-400">{label}</div>
      <div className={`text-[18px] font-mono tabular font-semibold mt-0.5 leading-none ${accent ? "text-brand-700" : "text-ink-900"}`}>
        {value}
      </div>
    </div>
  );
}

const TIER_LABEL: Record<"A" | "B" | "C" | "D", string> = {
  A: "High confidence",
  B: "Solid",
  C: "Directional",
  D: "Thin sample",
};

const TIER_COLOR: Record<"A" | "B" | "C" | "D", string> = {
  A: "bg-emerald-50 text-emerald-800 ring-emerald-200/60",
  B: "bg-brand-50 text-brand-800 ring-brand-200/60",
  C: "bg-amber-50 text-amber-800 ring-amber-200/60",
  D: "bg-ink-100 text-ink-600 ring-ink-200/60",
};

function SmartSwitchPanel({
  showId, deal, settlement, initial,
}: {
  showId: string;
  deal: Deal;
  settlement: Settlement | null;
  initial: SwitchSuggestion | null;
}) {
  const [sug, setSug] = useState<SwitchSuggestion | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(fn: () => Promise<SwitchSuggestion>) {
    setBusy(true); setErr(null);
    try { setSug(await fn()); }
    catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
    finally { setBusy(false); }
  }

  const generate = () => call(() => api.generateSwitch(showId));
  const accept = () => call(() => api.acceptSwitch(showId));
  const decline = () => call(() => api.declineSwitch(showId));

  return (
    <Card className="md:col-span-3 ring-1 ring-brand-200/60 bg-gradient-to-br from-brand-50/30 to-canvas">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-brand-700" />
            Smart Switch
          </CardTitle>
          <CardDescription>
            {settlement
              ? <>Convert this <code className="font-mono text-[11px] bg-white/70 px-1 py-0.5 rounded ring-1 ring-ink-200/40">{deal.dealType}</code> deal into a structure the in-app settle wizard can close cleanly, using historical payouts from comparable shows.</>
              : <>This show hasn't happened yet. Use the suggestion as a <strong>negotiation lever</strong> the next time you're on the phone with the agent — historical payouts on comparable past <code className="font-mono text-[11px] bg-white/70 px-1 py-0.5 rounded ring-1 ring-ink-200/40">{deal.dealType}</code> deals at this venue, rounded into a clean flat or hybrid.</>
            }
          </CardDescription>
        </div>
        {sug && (
          <PlainBadge variant={sug.status === "accepted" ? "brand" : sug.status === "declined" ? "default" : "amber"}>
            {sug.status === "suggested" ? "Pending" : sug.status === "accepted" ? "Accepted" : "Declined"}
          </PlainBadge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!sug && (
          <div className="flex items-center justify-between gap-4">
            <div className="text-[13px] text-ink-600 leading-relaxed max-w-xl">
              {settlement
                ? <>Generate a suggestion based on every comparable past deal at this venue. Hindsight will compare it to what the show actually paid.</>
                : <>Generate a suggestion based on every comparable past deal at this venue. Accept to mark intent to push the agent toward this structure; decline to record why this deal stays as-is.</>
              }
            </div>
            <Button variant="brand" onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {busy ? "Computing…" : "Generate suggestion"}
            </Button>
          </div>
        )}

        {sug && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-3">
                {sug.shape === "flat" && sug.suggestedFlat != null && (
                  <div>
                    <div className="eyebrow text-[10px] text-ink-500 mb-1.5">Suggested structure</div>
                    <div className="flex items-baseline gap-3">
                      <span className="text-[40px] font-mono tabular font-semibold text-ink-900 leading-none">
                        {formatMoney(sug.suggestedFlat)}
                      </span>
                      <span className="text-[13px] text-ink-500">flat guarantee</span>
                    </div>
                    {sug.bandLow != null && sug.bandHigh != null && (
                      <div className="text-[12px] text-ink-500 mt-2">
                        Historical band <span className="font-mono tabular">{formatMoney(sug.bandLow)}</span> – <span className="font-mono tabular">{formatMoney(sug.bandHigh)}</span> (P10–P90)
                      </div>
                    )}
                  </div>
                )}

                {sug.shape === "door_hybrid" && (
                  <div>
                    <div className="eyebrow text-[10px] text-ink-500 mb-1.5">Suggested structure</div>
                    <div className="text-[20px] font-display font-medium text-ink-900 leading-tight">
                      <span className="font-mono tabular">{formatMoney(sug.doorFloor ?? 0)}</span> floor
                      {" + "}
                      <span className="font-mono tabular">{Math.round((sug.doorSplitPct ?? 0) * 100)}%</span> of pool above
                      {" "}
                      <span className="font-mono tabular">{formatMoney(sug.doorExpenseCap ?? 0)}</span> expense cap
                    </div>
                    {sug.bandHigh != null && (
                      <div className="text-[12px] text-ink-500 mt-2">
                        Projected artist payout <span className="font-mono tabular">~{formatMoney(sug.bandLow ?? 0)}</span> – <span className="font-mono tabular">{formatMoney(sug.bandHigh)}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="text-[13px] text-ink-700 leading-relaxed pt-3 border-t border-ink-200/40">
                  {sug.basis}
                </div>

                {settlement?.totalToArtist != null && sug.suggestedFlat != null && (
                  <div className="rounded-lg bg-white/60 ring-1 ring-ink-200/50 p-3 mt-2">
                    <div className="eyebrow text-[10px] text-ink-500 mb-1">Hindsight (this show actually settled)</div>
                    <div className="text-[12.5px] text-ink-700 leading-relaxed">
                      Suggested flat <span className="font-mono tabular font-medium">{formatMoney(sug.suggestedFlat)}</span> vs actual payout <span className="font-mono tabular font-medium">{formatMoney(settlement.totalToArtist)}</span>
                      {" — "}
                      {(() => {
                        const delta = sug.suggestedFlat - settlement.totalToArtist;
                        const sign = delta >= 0 ? "+" : "−";
                        return (
                          <span className={delta >= 0 ? "text-emerald-700" : "text-rose-700"}>
                            {sign}{formatMoney(Math.abs(delta))} {delta >= 0 ? "venue would have paid more" : "venue would have saved"}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <div className="eyebrow text-[10px] text-ink-500 mb-2">Confidence</div>
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ring-1 text-[12px] font-medium ${TIER_COLOR[sug.confidenceTier]}`}>
                    <span className="font-mono tabular text-[14px] font-bold">{sug.confidenceTier}</span>
                    <span>{TIER_LABEL[sug.confidenceTier]}</span>
                  </div>
                  <div className="text-[11px] text-ink-500 mt-2">
                    Based on <span className="font-mono tabular">{sug.sampleSize}</span> comparable past deal{sug.sampleSize === 1 ? "" : "s"}.
                  </div>
                </div>

                {sug.status === "suggested" && (
                  <div className="flex flex-col gap-2 pt-2 border-t border-ink-200/40">
                    <Button variant="brand" onClick={accept} disabled={busy}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Accept suggestion
                    </Button>
                    <Button variant="ghost" onClick={decline} disabled={busy}>
                      <X className="h-3.5 w-3.5" />
                      Decline — keep as-is
                    </Button>
                  </div>
                )}
                {sug.status !== "suggested" && sug.decidedAt && (
                  <div className="text-[11px] text-ink-500 pt-2 border-t border-ink-200/40">
                    {sug.status === "accepted" ? "Accepted" : "Declined"} {new Date(sug.decidedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>

            {err && <div className="text-[12px] text-rose-600">{err}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BonusBadge({ type }: { type: Bonus["type"] }) {
  const labels: Record<Bonus["type"], string> = {
    gross_threshold: "gross",
    sellout: "sellout",
    attendance_threshold: "attend",
    tier_ratchet: "ratchet",
  };
  return (
    <span className="inline-flex shrink-0 items-center px-1.5 py-px rounded text-[9px] font-mono uppercase tracking-wider bg-white ring-1 ring-brand-200/50 text-brand-800">
      {labels[type]}
    </span>
  );
}
