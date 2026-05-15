"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Check,
  X,
  Mail,
  ChevronDown,
  ChevronRight,
  Eye,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlainBadge } from "@/components/ui/badge";
import type { Flag } from "@/lib/dealParser";
import type { ClarificationRecord } from "@/lib/clarifications";
import { resolveFlag } from "@/app/shows/[id]/deal-sheet/actions";

const sevIcon = {
  high: AlertTriangle,
  medium: AlertCircle,
  low: Info,
} as const;

const sevTone = {
  high: {
    border: "border-rose-200/80",
    bg: "bg-rose-50/40",
    iconColor: "text-rose-700",
    badge: "rose" as const,
    label: "High",
  },
  medium: {
    border: "border-amber-200/80",
    bg: "bg-amber-50/40",
    iconColor: "text-amber-700",
    badge: "amber" as const,
    label: "Medium",
  },
  low: {
    border: "border-ink-200/80",
    bg: "bg-ink-50/40",
    iconColor: "text-ink-500",
    badge: "default" as const,
    label: "Low",
  },
};

const statusTone: Record<
  string,
  { label: string; variant: "brand" | "amber" | "default"; icon: typeof Check }
> = {
  resolved: { label: "Resolved", variant: "brand", icon: Check },
  acknowledged: { label: "Acknowledged", variant: "amber", icon: Eye },
  dismissed: { label: "Dismissed", variant: "default", icon: X },
};

export function FlagCard({
  flag,
  showId,
  resolution,
}: {
  flag: Flag;
  showId: string;
  resolution: ClarificationRecord | null;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(flag.severity === "high" && !resolution);
  const [showEmail, setShowEmail] = useState(false);

  const tone = sevTone[flag.severity];
  const Icon = sevIcon[flag.severity];
  const isResolved = resolution != null;

  function act(status: "resolved" | "acknowledged" | "dismissed" | "open") {
    startTransition(async () => {
      await resolveFlag(flag.id, status, showId);
      if (status !== "open") setShowEmail(false);
    });
  }

  const hasEmail = flag.suggestedEmail.subject.length > 0;

  return (
    <div
      className={`rounded-lg border ${tone.border} ${
        isResolved ? "bg-white/60" : tone.bg
      } overflow-hidden transition-all`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-white/40 transition-colors"
      >
        <Icon
          className={`h-4 w-4 mt-0.5 shrink-0 ${
            isResolved ? "text-ink-400" : tone.iconColor
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[13px] font-medium ${
                isResolved ? "text-ink-500 line-through" : "text-ink-900"
              }`}
            >
              {flag.title}
            </span>
            {!isResolved && (
              <PlainBadge variant={tone.badge}>{tone.label}</PlainBadge>
            )}
            {isResolved && (
              <PlainBadge variant={statusTone[resolution!.status].variant}>
                {statusTone[resolution!.status].label}
              </PlainBadge>
            )}
          </div>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-ink-400 mt-1 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-ink-400 mt-1 shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-ink-100/60">
          <p className="text-[12.5px] text-ink-700 leading-relaxed">
            {flag.message}
          </p>

          {flag.evidence && (
            <div className="rounded-md bg-white/80 ring-1 ring-ink-200/50 p-3">
              <div className="eyebrow text-[10px] text-ink-500 mb-1">
                Evidence from deal notes
              </div>
              <div
                className="text-[12px] text-ink-800 leading-relaxed font-[450]"
                style={{ fontStyle: "italic" }}
              >
                &ldquo;…{flag.evidence}…&rdquo;
              </div>
            </div>
          )}

          <div className="rounded-md bg-white/80 ring-1 ring-ink-200/50 p-3">
            <div className="eyebrow text-[10px] text-ink-500 mb-1">
              Suggested action
            </div>
            <div className="text-[12px] text-ink-800 leading-relaxed">
              {flag.suggestedAction}
            </div>
          </div>

          {isResolved ? (
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="text-[11px] text-ink-500">
                {statusTone[resolution!.status].label}
                {" · "}
                {new Date(resolution!.resolvedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => act("open")}
              >
                <RotateCcw className="h-3 w-3" />
                Reopen
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                {hasEmail && (
                  <Button
                    variant="brand"
                    size="sm"
                    onClick={() => setShowEmail(!showEmail)}
                  >
                    <Mail className="h-3 w-3" />
                    {showEmail ? "Hide draft" : "Draft clarification email"}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => act("resolved")}
                >
                  <Check className="h-3 w-3" />
                  Mark resolved
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => act("acknowledged")}
                >
                  <Eye className="h-3 w-3" />
                  Acknowledge
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => act("dismissed")}
              >
                <X className="h-3 w-3" />
                Dismiss
              </Button>
            </div>
          )}

          {showEmail && hasEmail && (
            <div className="rounded-md bg-canvas-soft ring-1 ring-ink-200/60 p-3 mt-2">
              <div className="eyebrow text-[10px] text-ink-500 mb-2">
                Draft email — copy & paste into your inbox
              </div>
              <div className="text-[11.5px] text-ink-700 mb-2">
                <span className="font-medium">Subject:</span>{" "}
                {flag.suggestedEmail.subject}
              </div>
              <pre className="text-[12px] text-ink-800 whitespace-pre-wrap font-sans leading-relaxed bg-white rounded p-3 ring-1 ring-ink-200/50">
                {flag.suggestedEmail.body}
              </pre>
              <div className="text-[10.5px] text-ink-400 mt-2 italic">
                In production this would compose into Mariana&apos;s mail
                client (mailto: + agent address from the system).
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
