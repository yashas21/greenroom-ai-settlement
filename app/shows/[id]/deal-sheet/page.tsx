import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, AlertTriangle, ScrollText } from "lucide-react";
import { getShowById } from "@/lib/queries";
import { parseDeal } from "@/lib/dealParser";
import { getClarifications } from "@/lib/clarifications";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Field,
} from "@/components/ui/card";
import { PlainBadge, DealTypeBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, formatShowDateFull } from "@/lib/format";
import { FlagCard } from "@/components/deal-sheet/flag-card";

export default async function DealSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getShowById(id);
  if (!data) notFound();

  const { show, artist, agent, agency, deal } = data;
  if (!deal) {
    return (
      <div className="max-w-5xl px-12 py-10">
        <p className="text-[13px] text-ink-500">No deal entered for this show yet.</p>
      </div>
    );
  }

  const { parsed, flags } = parseDeal(deal);
  const resolutions = await getClarifications(flags.map((f) => f.id));

  const openFlags = flags.filter((f) => !resolutions[f.id]);
  const closedFlags = flags.filter((f) => resolutions[f.id]);
  const highOpen = openFlags.filter((f) => f.severity === "high").length;

  const status =
    openFlags.length === 0
      ? ("clean" as const)
      : highOpen > 0
        ? ("blocked" as const)
        : ("attention" as const);

  const statusUI = {
    clean: {
      tone: "brand" as const,
      Icon: ShieldCheck,
      headline: "Deal is settle-ready",
      sub: "No open ambiguities. The 2am math will match the morning math.",
      hero: "from-brand-50/40 to-canvas",
    },
    attention: {
      tone: "amber" as const,
      Icon: AlertTriangle,
      headline: `${openFlags.length} item${openFlags.length === 1 ? "" : "s"} need attention`,
      sub: "Resolvable now, while you have the agent on email. Don't let these surface at the table.",
      hero: "from-amber-50/40 to-canvas",
    },
    blocked: {
      tone: "rose" as const,
      Icon: AlertTriangle,
      headline: `${highOpen} high-severity issue${highOpen === 1 ? "" : "s"} — resolve before show day`,
      sub: "Each one of these has a track record of becoming a settlement dispute. Five minutes now saves an hour Friday night.",
      hero: "from-rose-50/40 to-canvas",
    },
  }[status];

  const StatusIcon = statusUI.Icon;

  // Build the parsed-vs-structured comparison rows
  const rows: { field: string; structured: string; parsed: string; match: boolean }[] = [
    {
      field: "Guarantee",
      structured: deal.guaranteeAmount != null ? formatMoney(deal.guaranteeAmount) : "—",
      parsed: parsed.guaranteeAmount != null ? formatMoney(parsed.guaranteeAmount) : "—",
      match:
        deal.guaranteeAmount == null ||
        parsed.guaranteeAmount == null ||
        Math.abs((deal.guaranteeAmount ?? 0) - (parsed.guaranteeAmount ?? 0)) < 1,
    },
    {
      field: "Percentage",
      structured:
        deal.percentage != null
          ? `${(deal.percentage * 100).toFixed(0)}%${deal.percentageBasis ? ` of ${deal.percentageBasis}` : ""}`
          : "—",
      parsed:
        parsed.percentage != null
          ? `${(parsed.percentage * 100).toFixed(0)}%${parsed.percentageBasis ? ` of ${parsed.percentageBasis}` : ""}`
          : "—",
      match:
        (deal.percentage ?? null) === (parsed.percentage ?? null) &&
        (deal.percentageBasis ?? null) === (parsed.percentageBasis ?? null),
    },
    {
      field: "Expense cap",
      structured: deal.expenseCap != null ? formatMoney(deal.expenseCap) : "—",
      parsed: parsed.expenseCap != null ? formatMoney(parsed.expenseCap) : "—",
      match:
        deal.expenseCap == null ||
        parsed.expenseCap == null ||
        Math.abs((deal.expenseCap ?? 0) - (parsed.expenseCap ?? 0)) < 1,
    },
    {
      field: "Hospitality cap",
      structured: deal.hospitalityCap != null ? formatMoney(deal.hospitalityCap) : "—",
      parsed: parsed.hospitalityCap != null ? formatMoney(parsed.hospitalityCap) : "—",
      match:
        deal.hospitalityCap == null ||
        parsed.hospitalityCap == null ||
        Math.abs((deal.hospitalityCap ?? 0) - (parsed.hospitalityCap ?? 0)) < 1,
    },
  ];

  return (
    <div className="max-w-7xl">
      <div className={`px-12 pt-10 pb-10 bg-gradient-to-b ${statusUI.hero}`}>
        <Link
          href={`/shows/${show.id}`}
          className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-900 mb-6 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to show
        </Link>

        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <div className="eyebrow text-[10px] text-ink-500 mb-3">Deal Sheet</div>
            <h1
              className="font-display text-[40px] font-medium text-ink-900 leading-[1.05]"
              style={{ letterSpacing: "-0.02em" }}
            >
              {artist?.name}
            </h1>
            <div className="text-[13px] text-ink-500 mt-2 flex items-center gap-2">
              <span className="text-ink-700 font-medium">
                {formatShowDateFull(show.date)}
              </span>
              <span className="text-ink-300">·</span>
              <DealTypeBadge type={deal.dealType} />
              {agent && (
                <>
                  <span className="text-ink-300">·</span>
                  <span>
                    {agent.name}
                    {agency && ` · ${agency.name}`}
                  </span>
                </>
              )}
            </div>
          </div>

          <div
            className={`shrink-0 rounded-lg ring-1 ring-inset px-4 py-3 ${
              status === "clean"
                ? "bg-brand-50 ring-brand-200/80"
                : status === "blocked"
                  ? "bg-rose-50 ring-rose-200/80"
                  : "bg-amber-50 ring-amber-200/80"
            }`}
          >
            <div className="flex items-center gap-2">
              <StatusIcon
                className={`h-5 w-5 ${
                  status === "clean"
                    ? "text-brand-700"
                    : status === "blocked"
                      ? "text-rose-700"
                      : "text-amber-700"
                }`}
              />
              <div>
                <div
                  className={`text-[13px] font-semibold ${
                    status === "clean"
                      ? "text-brand-800"
                      : status === "blocked"
                        ? "text-rose-800"
                        : "text-amber-800"
                  }`}
                >
                  {statusUI.headline}
                </div>
                <div className="text-[11.5px] text-ink-600 max-w-xs leading-snug mt-0.5">
                  {statusUI.sub}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-12 pb-12 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column: flags */}
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Open ambiguities</CardTitle>
                <CardDescription>
                  Detected by parsing the deal notes against the structured
                  fields and the catalog of patterns we know cause settlement
                  fights.
                </CardDescription>
              </div>
              <PlainBadge variant={statusUI.tone}>
                {openFlags.length} open
              </PlainBadge>
            </CardHeader>
            <CardContent className="space-y-3">
              {openFlags.length === 0 ? (
                <div className="text-[13px] text-ink-500 italic">
                  Nothing to clarify. This deal will settle clean.
                </div>
              ) : (
                openFlags.map((f) => (
                  <FlagCard
                    key={f.id}
                    flag={f}
                    showId={show.id}
                    resolution={null}
                  />
                ))
              )}
            </CardContent>
          </Card>

          {closedFlags.length > 0 && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Resolved & acknowledged</CardTitle>
                  <CardDescription>
                    The audit trail. Every resolution becomes a record you can
                    point to if a dispute reopens.
                  </CardDescription>
                </div>
                <PlainBadge>{closedFlags.length} closed</PlainBadge>
              </CardHeader>
              <CardContent className="space-y-3">
                {closedFlags.map((f) => (
                  <FlagCard
                    key={f.id}
                    flag={f}
                    showId={show.id}
                    resolution={resolutions[f.id]}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: structured-vs-parsed comparison + the source prose */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Structured ↔ prose</CardTitle>
              <CardDescription>
                What the database stores vs what the deal notes actually say.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {rows.map((r) => (
                <div
                  key={r.field}
                  className={`rounded-md p-3 ring-1 ring-inset ${
                    r.match
                      ? "bg-canvas-soft ring-ink-200/40"
                      : "bg-rose-50/40 ring-rose-200/60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="eyebrow text-[10px] text-ink-500">
                      {r.field}
                    </div>
                    {!r.match && (
                      <PlainBadge variant="rose">conflict</PlainBadge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                    <div>
                      <div className="text-[10px] text-ink-400 mb-0.5">
                        Structured
                      </div>
                      <div className="font-mono tabular text-ink-900">
                        {r.structured}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-400 mb-0.5">
                        From prose
                      </div>
                      <div
                        className={`font-mono tabular ${
                          r.match ? "text-ink-900" : "text-rose-800 font-medium"
                        }`}
                      >
                        {r.parsed}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Things that aren't in the structured schema at all */}
              {(parsed.walkoutPot ||
                parsed.tierRatchets.length > 0 ||
                parsed.marketingRecoup ||
                parsed.bonusThresholds.length > 0 ||
                parsed.referencesExternal.length > 0) && (
                <div className="pt-2 mt-2 border-t border-ink-100">
                  <div className="eyebrow text-[10px] text-ink-500 mb-2">
                    Found in prose only (no structured field exists)
                  </div>
                  <ul className="space-y-1.5 text-[12px] text-ink-800">
                    {parsed.marketingRecoup && (
                      <li>
                        Marketing recoup: ${parsed.marketingRecoup.amount.toLocaleString()} (basis:{" "}
                        <span
                          className={
                            parsed.marketingRecoup.basis === "unclear"
                              ? "text-rose-700 font-medium"
                              : ""
                          }
                        >
                          {parsed.marketingRecoup.basis}
                        </span>
                        )
                      </li>
                    )}
                    {parsed.walkoutPot && <li>Walkout pot present</li>}
                    {parsed.tierRatchets.map((t, i) => (
                      <li key={i}>Tier ratchet: {t.label}</li>
                    ))}
                    {parsed.bonusThresholds.map((b, i) => (
                      <li key={i}>Bonus: {b.label}</li>
                    ))}
                    {parsed.referencesExternal.map((r, i) => (
                      <li key={i} className="text-amber-800">
                        Off-system reference: &ldquo;{r}&rdquo;
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <ScrollText className="h-3.5 w-3.5 text-ink-500" /> Source prose
              </CardTitle>
              <CardDescription>
                What Mariana actually trusts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="text-[12.5px] text-ink-800 leading-relaxed font-[450]"
                style={{ fontStyle: "italic" }}
              >
                {deal.dealNotesFreetext ?? <span className="text-ink-400">No deal notes.</span>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="text-[11.5px] text-ink-500 leading-relaxed">
              <Field
                label="How this works"
                value={
                  <span className="text-[12px] text-ink-700 leading-relaxed font-normal">
                    The parser reads <code className="font-mono text-[10.5px] bg-canvas-soft px-1 py-0.5 rounded">deal_notes_freetext</code> against a catalog of patterns
                    learned from the dispute archive — recoup-scope ambiguity,
                    bonus drift, walkout pots, off-system references. In
                    production this is an LLM call with structured output. Here
                    it&apos;s deterministic so the demo reproduces offline.
                  </span>
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
