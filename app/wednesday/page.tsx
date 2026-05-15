import Link from "next/link";
import { CalendarClock, AlertTriangle, ShieldCheck, Eye } from "lucide-react";
import { getRiskRows, summarize } from "@/lib/riskQueries";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PlainBadge, DealTypeBadge } from "@/components/ui/badge";
import { FLAG_LABELS } from "@/lib/dealParser";
import { formatShowDateFull, relativeShowDate } from "@/lib/format";

export default async function WednesdayPage() {
  const allRows = await getRiskRows({ pastOnly: true });
  // For demo: bias toward shows that have something interesting going on, then
  // recent/upcoming. In real life this would filter to shows in the next 14 days.
  const interesting = allRows
    .filter((r) => r.openFlags.length > 0 || r.signoffMismatch)
    .sort((a, b) => {
      // High flags first, then mismatches, then by date desc
      if (b.highOpenCount !== a.highOpenCount) return b.highOpenCount - a.highOpenCount;
      if (b.openFlags.length !== a.openFlags.length)
        return b.openFlags.length - a.openFlags.length;
      if (a.signoffMismatch !== b.signoffMismatch)
        return a.signoffMismatch ? -1 : 1;
      return b.date.localeCompare(a.date);
    });

  const summary = summarize(allRows);

  return (
    <div className="max-w-7xl px-12 pt-10 pb-12">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <CalendarClock className="h-4 w-4 text-brand-700" />
          <span className="eyebrow text-[10px] text-brand-800">
            Wednesday View
          </span>
        </div>
        <h1
          className="font-display text-[40px] font-medium text-ink-900 leading-[1.05]"
          style={{ letterSpacing: "-0.02em" }}
        >
          The deals that will fight you Friday night.
        </h1>
        <p className="text-[14px] text-ink-500 mt-3 max-w-2xl leading-relaxed">
          Most settlement friction is knowable days before the show — ambiguous
          recoups, stale structured fields, off-system references, walkout pots
          the engine can&apos;t do. Resolve cold, in writing, while the agent is
          still answering email.
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <SummaryStat
          label="Shows with open flags"
          value={summary.showsWithFlags}
          tone="amber"
          icon={AlertTriangle}
          sub={`out of ${summary.totalShows} settled`}
        />
        <SummaryStat
          label="High-severity"
          value={summary.showsWithHighFlags}
          tone="rose"
          icon={AlertTriangle}
          sub="resolve before show day"
        />
        <SummaryStat
          label="Total open ambiguities"
          value={summary.totalOpenFlags}
          tone="default"
          icon={Eye}
          sub="across all shows"
        />
        <SummaryStat
          label="Status ↔ sign-off mismatch"
          value={summary.signoffMismatches}
          tone="rose"
          icon={AlertTriangle}
          sub="disputed badge with positive sign-off"
        />
      </div>

      {summary.signoffMismatches > 0 && (
        <Card className="mb-6" accent="rose">
          <CardHeader>
            <div>
              <CardTitle>Status ↔ sign-off mismatch</CardTitle>
              <CardDescription>
                Settlements marked &ldquo;disputed&rdquo; whose sign-off text reads positive
                — or vice-versa. The badge is lying or the sign-off is. Reads
                past the surface to the data.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {allRows
                .filter((r) => r.signoffMismatch)
                .map((r) => (
                  <Link
                    key={r.showId}
                    href={`/shows/${r.showId}/deal-sheet`}
                    className="flex items-center justify-between gap-3 rounded-md p-3 ring-1 ring-rose-200/50 bg-rose-50/30 hover:bg-rose-50/60 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[13px] font-medium text-ink-900">
                          {r.artistName}
                        </span>
                        <PlainBadge variant="rose">
                          {r.settlementStatus}
                        </PlainBadge>
                      </div>
                      <div className="text-[11.5px] text-ink-500">
                        {formatShowDateFull(r.date)}
                      </div>
                    </div>
                    <div className="text-[12px] text-ink-700 italic max-w-md truncate">
                      &ldquo;{r.signoffText}&rdquo;
                    </div>
                  </Link>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Shows with open ambiguities</CardTitle>
            <CardDescription>
              Sorted by severity. Click into any show to resolve, acknowledge,
              or dismiss each flag.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {interesting.length === 0 ? (
            <div className="flex items-center gap-2 text-[13px] text-ink-500 py-6 justify-center">
              <ShieldCheck className="h-4 w-4 text-brand-700" />
              All deals settle-ready. Lucky week.
            </div>
          ) : (
            interesting.slice(0, 30).map((r) => (
              <Link
                key={r.showId}
                href={`/shows/${r.showId}/deal-sheet`}
                className="block rounded-md p-3 ring-1 ring-ink-200/50 hover:ring-ink-300 hover:bg-canvas-soft transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-medium text-ink-900">
                        {r.artistName}
                      </span>
                      <DealTypeBadge type={r.dealType} />
                      {r.highOpenCount > 0 && (
                        <PlainBadge variant="rose">
                          {r.highOpenCount} high
                        </PlainBadge>
                      )}
                      {r.openFlags.length - r.highOpenCount > 0 && (
                        <PlainBadge variant="amber">
                          {r.openFlags.length - r.highOpenCount} medium/low
                        </PlainBadge>
                      )}
                      {r.signoffMismatch && (
                        <PlainBadge variant="rose">sign-off mismatch</PlainBadge>
                      )}
                    </div>
                    <div className="text-[11.5px] text-ink-500 mt-1 flex items-center gap-2">
                      <span>{formatShowDateFull(r.date)}</span>
                      <span className="text-ink-300">·</span>
                      <span>{relativeShowDate(r.date)}</span>
                      {r.agentName && (
                        <>
                          <span className="text-ink-300">·</span>
                          <span>{r.agentName}</span>
                        </>
                      )}
                    </div>
                    {r.openFlags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.openFlags.slice(0, 4).map((f) => (
                          <span
                            key={f.id}
                            className="text-[10.5px] text-ink-600 bg-canvas-soft ring-1 ring-ink-200/50 rounded px-1.5 py-0.5"
                          >
                            {FLAG_LABELS[f.kind]}
                          </span>
                        ))}
                        {r.openFlags.length > 4 && (
                          <span className="text-[10.5px] text-ink-400">
                            +{r.openFlags.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))
          )}
          {interesting.length > 30 && (
            <div className="text-[11.5px] text-ink-400 text-center pt-2">
              Showing 30 of {interesting.length}. (In production: paginated +
              filtered to next 14 days.)
            </div>
          )}
        </CardContent>
      </Card>

      {/* Flag-kind breakdown */}
      {Object.keys(summary.byKind).length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <div>
              <CardTitle>Open flags by kind</CardTitle>
              <CardDescription>
                Where The Crescent&apos;s deal-capture process is leaking.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {Object.entries(summary.byKind)
                .sort((a, b) => b[1] - a[1])
                .map(([kind, count]) => (
                  <div
                    key={kind}
                    className="flex items-center justify-between text-[12.5px]"
                  >
                    <span className="text-ink-800">
                      {FLAG_LABELS[kind as keyof typeof FLAG_LABELS] ?? kind}
                    </span>
                    <span className="font-mono tabular text-ink-900">
                      {count}
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  sub: string;
  tone: "rose" | "amber" | "default";
  icon: typeof AlertTriangle;
}) {
  const toneClasses = {
    rose: "text-rose-700",
    amber: "text-amber-700",
    default: "text-ink-500",
  } as const;
  return (
    <div className="rounded-lg ring-1 ring-ink-200/60 bg-white p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={`h-3.5 w-3.5 ${toneClasses[tone]}`} />
        <span className="eyebrow text-[10px] text-ink-500">{label}</span>
      </div>
      <div className="text-[28px] font-display font-medium text-ink-900 tabular leading-none">
        {value}
      </div>
      <div className="text-[11px] text-ink-400 mt-1.5">{sub}</div>
    </div>
  );
}
