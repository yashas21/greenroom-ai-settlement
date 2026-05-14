import Link from "next/link";
import { Sparkles, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import type { SettlementEstimateResult } from "@/lib/settlementEstimate";
import { CopyShareEstimateUrl } from "./copy-share-estimate-url";

function Row({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between py-2 gap-4">
      <div className="min-w-0">
        <div className="text-[13px] text-ink-600">{label}</div>
        {note && (
          <div className="text-[11.5px] text-ink-400 mt-0.5 leading-snug">
            {note}
          </div>
        )}
      </div>
      <div className="text-[13.5px] font-mono tabular text-ink-900 shrink-0">
        {value}
      </div>
    </div>
  );
}

export function SettlementEstimatePanel({
  showId,
  estimate,
  variant,
}: {
  showId: string;
  estimate: SettlementEstimateResult;
  variant: "internal" | "share";
}) {
  const isShare = variant === "share";

  return (
    <Card accent="sky">
      <CardHeader>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Sparkles className="h-3.5 w-3.5 text-sky-700 shrink-0" />
            <CardTitle>Settlement estimate</CardTitle>
          </div>
          <CardDescription>
            {isShare
              ? "Shared view — non-binding payout preview from current show numbers. Internal notes are hidden."
              : "Payout preview from this show’s tickets, deal, and pass-through expenses — non-binding."}
          </CardDescription>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <PlainBadge variant={estimate.confidence.variant}>
            {estimate.confidence.label}
          </PlainBadge>
          {!isShare && (
            <div className="flex flex-col items-end gap-1.5">
              <Link
                href={`/shows/${showId}/settle/share`}
                className="text-[11.5px] font-medium text-brand-700 hover:text-brand-800 hover:underline"
              >
                Booker share view →
              </Link>
              <CopyShareEstimateUrl showId={showId} />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="eyebrow text-[10px] text-ink-400 mb-2">
            Estimated payout to artist
          </div>
          <div
            className="text-[40px] font-mono tabular font-semibold text-ink-900 leading-none"
            style={{ letterSpacing: "-0.03em" }}
          >
            {formatMoney(estimate.totalToArtist)}
          </div>
          {estimate.matchesLegacyWorksheet && (
            <p className="text-[11px] text-ink-400 mt-2 leading-snug">
              Matches the in-app worksheet math for this deal type.
            </p>
          )}
        </div>

        {estimate.steps.length > 0 && (
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              Math walkthrough
            </div>
            <div className="rounded-lg border border-ink-100/90 bg-canvas-soft/50 divide-y divide-ink-100/80 px-4">
              {estimate.steps.map((step, i) => (
                <Row
                  key={i}
                  label={step.label}
                  value={formatMoney(step.value)}
                  note={step.note}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="eyebrow text-[10px] text-ink-500 mb-2">
            Pass-through expenses
          </div>
          {estimate.expenseLines.length === 0 ? (
            <p className="text-[12.5px] text-ink-500 leading-relaxed">
              No pass-through expense lines (venue-absorbed items excluded).
            </p>
          ) : (
            <div className="rounded-lg border border-ink-100/90 bg-white divide-y divide-ink-100/80 px-4">
              {estimate.expenseLines.map((line) => (
                <Row
                  key={line.id}
                  label={
                    line.description
                      ? `${line.category} — ${line.description}`
                      : line.category
                  }
                  value={formatMoney(line.amount)}
                />
              ))}
              <div className="flex items-baseline justify-between py-2.5 font-medium">
                <span className="text-[12px] text-ink-700">Subtotal</span>
                <span className="text-[13px] font-mono tabular text-ink-900">
                  {formatMoney(estimate.passThroughSubtotal)}
                </span>
              </div>
              {estimate.cappedPassThrough !== estimate.passThroughSubtotal && (
                <div className="flex items-baseline justify-between py-2.5 text-[12px] text-ink-600 pb-3">
                  <span>Applied in model (after cap)</span>
                  <span className="font-mono tabular">
                    {formatMoney(estimate.cappedPassThrough)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {estimate.flags.length > 0 && (
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-2.5">
              Things to clarify
            </div>
            <ul className="space-y-2.5">
              {estimate.flags.map((f) => (
                <li
                  key={f.title}
                  className="rounded-lg border border-amber-200/70 bg-amber-50/35 px-3.5 py-3 flex gap-2.5"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-700 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-ink-900 leading-snug">
                      {f.title}
                    </div>
                    <p className="text-[11.5px] text-ink-600 mt-1 leading-relaxed">
                      {f.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
