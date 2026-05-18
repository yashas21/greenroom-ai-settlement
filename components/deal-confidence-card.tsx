"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Check,
  X,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RotateCw,
  Copy,
  CheckCheck,
} from "lucide-react";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Deal, DealClarification } from "@/db/schema";

type Props = {
  dealId: string;
  initialDeal: Deal;
  initialClarifications: DealClarification[];
  artistName?: string;
  agentName?: string;
  agentEmail?: string;
};

const severityConfig = {
  high: {
    Icon: AlertTriangle,
    iconClass: "text-rose-500",
    pill: "bg-rose-50 text-rose-800 ring-rose-200/80",
    border: "border-l-rose-400",
    bg: "bg-rose-50/30",
  },
  medium: {
    Icon: AlertCircle,
    iconClass: "text-amber-500",
    pill: "bg-amber-50 text-amber-800 ring-amber-200/80",
    border: "border-l-amber-400",
    bg: "bg-amber-50/20",
  },
  low: {
    Icon: Info,
    iconClass: "text-stone-400",
    pill: "bg-stone-50 text-stone-700 ring-stone-200/80",
    border: "border-l-stone-300",
    bg: "bg-stone-50/20",
  },
} as const;

const flagTypeLabel: Record<DealClarification["flagType"], string> = {
  conflict: "Conflict",
  ambiguity: "Ambiguity",
  missing_reference: "Missing ref",
};

function confidenceStyle(c: number) {
  if (c >= 0.8) return "bg-brand-50 text-brand-800 ring-brand-200/80";
  if (c >= 0.6) return "bg-amber-50 text-amber-800 ring-amber-200/80";
  return "bg-rose-50 text-rose-800 ring-rose-200/80";
}

export function DealConfidenceCard({
  dealId,
  initialDeal,
  initialClarifications,
  artistName,
  agentName,
  agentEmail,
}: Props) {
  const [deal, setDeal] = useState(initialDeal);
  const [clarifications, setClarifications] = useState(initialClarifications);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionState, setActionState] = useState<{
    id: string;
    type: "dismiss" | "resolve";
  } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const openFlags = clarifications.filter((c) => c.status === "open");
  const closedFlags = clarifications.filter((c) => c.status !== "open");
  const highCount = openFlags.filter((c) => c.severity === "high").length;
  const mediumCount = openFlags.filter((c) => c.severity === "medium").length;
  const lowCount = openFlags.filter((c) => c.severity === "low").length;

  const isNeverAnalyzed = !deal.lastAnalyzedAt;
  const cardAccent = !isNeverAnalyzed && highCount > 0 ? "rose" : undefined;

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function runAnalysis() {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/analyze`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json();
      setDeal(data.deal);
      setClarifications(data.clarifications);
    } catch (err) {
      console.error("[DealConfidenceCard] analyze failed:", err);
    } finally {
      setLoading(false);
    }
  }

  function toggleAction(id: string, type: "dismiss" | "resolve") {
    if (actionState?.id === id && actionState.type === type) {
      setActionState(null);
      setReasonText("");
    } else {
      setActionState({ id, type });
      setReasonText("");
    }
  }

  async function confirmAction(flagId: string) {
    if (!actionState) return;
    const status =
      actionState.type === "dismiss" ? "dismissed" : "resolved";

    const before = clarifications;
    setClarifications((prev) =>
      prev.map((c) =>
        c.id === flagId
          ? {
              ...c,
              status,
              dismissalReason: reasonText || null,
              resolvedAt: Date.now(),
            }
          : c,
      ),
    );
    setActionState(null);
    setReasonText("");

    try {
      const res = await fetch(`/api/clarifications/${flagId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          dismissal_reason: reasonText || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      setClarifications(before);
    }
  }

  async function copyEmailDraft(flag: DealClarification) {
    const subjectField = flag.field
      ? `${flag.field} clarification`
      : "deal terms clarification";
    const lines = [
      `Subject: Quick question before settlement — ${artistName ?? "show"} · ${subjectField}`,
      "",
      `Hi ${agentName ?? "[Agent name]"},`,
      "",
      "I wanted to flag a quick question before we run settlement:",
      "",
      flag.issue,
      "",
      flag.recommendedClarification ??
        "Could you confirm the correct terms so we can settle accurately?",
      "",
      agentEmail ? `(Sending to: ${agentEmail})` : "",
      "",
      "Thanks,",
      "Mariana",
      "The Crescent",
    ]
      .filter((l) => l !== undefined)
      .join("\n");

    try {
      await navigator.clipboard.writeText(lines.trim());
      setCopiedId(flag.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard unavailable — silently skip
    }
  }

  // ── Flag card ──────────────────────────────────────────────────────────────

  function renderFlagCard(flag: DealClarification, isClosed = false) {
    const sev = severityConfig[flag.severity];
    const { Icon } = sev;
    const isExpanded = expandedId === flag.id;
    const isActioning = actionState?.id === flag.id;
    const isCopied = copiedId === flag.id;
    const isConflict = flag.flagType === "conflict";

    return (
      <div
        key={flag.id}
        className={cn(
          "rounded-lg border border-ink-200/60 border-l-[3px] overflow-hidden",
          isClosed ? "border-l-ink-200 opacity-60" : sev.border,
        )}
      >
        {/* Body */}
        <div className={cn("px-4 py-3", !isClosed && sev.bg)}>
          {/* Header row: severity pill · flag type · field */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {!isClosed && (
              <Icon className={cn("h-3.5 w-3.5 shrink-0", sev.iconClass)} />
            )}
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-px rounded text-[9.5px] font-medium ring-1 ring-inset",
                isClosed
                  ? "bg-ink-50 text-ink-500 ring-ink-200/60"
                  : sev.pill,
              )}
            >
              {flag.severity.toUpperCase()}
            </span>
            <span className="text-[9.5px] font-medium uppercase tracking-wide text-ink-400">
              {flagTypeLabel[flag.flagType]}
            </span>
            {flag.field && (
              <>
                <span className="text-ink-200 text-[10px]">·</span>
                <code className="text-[10.5px] font-mono text-ink-600 bg-white/70 px-1 py-px rounded ring-1 ring-ink-200/40">
                  {flag.field}
                </code>
              </>
            )}
            {isClosed && (
              <span className="ml-auto text-[10px] text-ink-400 capitalize">
                {flag.status}
                {flag.dismissalReason ? ` · ${flag.dismissalReason}` : ""}
              </span>
            )}
          </div>

          {/* Issue */}
          <p
            className={cn(
              "text-[13px] leading-relaxed",
              isClosed ? "text-ink-500" : "text-ink-800",
            )}
          >
            {flag.issue}
          </p>

          {/* Conflict comparison strip */}
          {isConflict && !isClosed && (flag.structuredValue || flag.extractedValue) && (
            <div className="mt-3 rounded-md overflow-hidden ring-1 ring-rose-200/60 text-[12px] flex">
              <div className="flex-1 bg-rose-50 px-3 py-2.5 border-r border-rose-200/40">
                <div className="eyebrow text-[8.5px] text-rose-500 mb-1">
                  Structured field
                </div>
                <div className="font-mono tabular font-semibold text-rose-900 leading-snug">
                  {flag.structuredValue ?? "—"}
                </div>
              </div>
              <div className="flex-1 bg-white px-3 py-2.5">
                <div className="eyebrow text-[8.5px] text-ink-400 mb-1">
                  Prose says
                </div>
                <div className="font-mono tabular font-semibold text-ink-900 leading-snug">
                  {flag.extractedValue ?? "—"}
                </div>
              </div>
            </div>
          )}

          {/* Expanded details */}
          {isExpanded && !isClosed && (
            <div className="mt-4 pt-4 border-t border-ink-100/80 space-y-3.5">
              {(flag.interpretationA || flag.interpretationB) && (
                <div>
                  <div className="eyebrow text-[9px] text-ink-400 mb-2">
                    Two readings
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {flag.interpretationA && (
                      <div className="rounded-md bg-white ring-1 ring-ink-200/60 px-3 py-2.5">
                        <div className="eyebrow text-[9px] text-ink-400 mb-1">
                          Reading A
                        </div>
                        <p className="text-[12.5px] text-ink-700 leading-relaxed">
                          {flag.interpretationA}
                        </p>
                      </div>
                    )}
                    {flag.interpretationB && (
                      <div className="rounded-md bg-white ring-1 ring-ink-200/60 px-3 py-2.5">
                        <div className="eyebrow text-[9px] text-ink-400 mb-1">
                          Reading B
                        </div>
                        <p className="text-[12.5px] text-ink-700 leading-relaxed">
                          {flag.interpretationB}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {flag.financialImpact && (
                <div>
                  <div className="eyebrow text-[9px] text-ink-400 mb-1.5">
                    Financial impact
                  </div>
                  <div className="rounded-md bg-white ring-1 ring-ink-200/60 px-3 py-2.5 text-[12.5px] text-ink-800 leading-relaxed font-medium">
                    {flag.financialImpact}
                  </div>
                </div>
              )}

              {flag.recommendedClarification && (
                <div>
                  <div className="eyebrow text-[9px] text-ink-400 mb-1.5">
                    Recommended action
                  </div>
                  <div className="rounded-md bg-white ring-1 ring-ink-200/60 px-3 py-2.5 text-[12.5px] text-ink-700 leading-relaxed">
                    {flag.recommendedClarification}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyEmailDraft(flag)}
                >
                  {isCopied ? (
                    <CheckCheck className="h-3.5 w-3.5 text-brand-700" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {isCopied ? "Copied!" : "Copy email draft to agent"}
                </Button>
              </div>
            </div>
          )}

          {/* Inline action form */}
          {isActioning && !isClosed && (
            <div className="mt-3 pt-3 border-t border-ink-100/80">
              <div className="eyebrow text-[9px] text-ink-400 mb-1.5">
                {actionState!.type === "dismiss"
                  ? "Why dismiss? (optional — helps the system learn your conventions)"
                  : "How was this resolved? e.g. 'Confirmed with agent via email'"}
              </div>
              <textarea
                className={cn(
                  "w-full text-[12.5px] text-ink-800 bg-white leading-relaxed resize-none",
                  "rounded-md px-3 py-2 ring-1 ring-ink-200/60",
                  "placeholder:text-ink-300",
                  "focus:outline-none focus:ring-2 focus:ring-brand-700/30",
                )}
                rows={2}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder={
                  actionState!.type === "dismiss"
                    ? "Convention, context, or reason…"
                    : "Resolution notes…"
                }
                autoFocus
              />
              <div className="flex items-center gap-2 mt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setActionState(null);
                    setReasonText("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant={
                    actionState!.type === "dismiss" ? "outline" : "brand"
                  }
                  size="sm"
                  onClick={() => confirmAction(flag.id)}
                >
                  <Check className="h-3.5 w-3.5" />
                  Confirm {actionState!.type}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Action row — open flags only */}
        {!isClosed && (
          <div className="flex items-center justify-end gap-1 px-4 py-2 bg-white border-t border-ink-100/60">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleAction(flag.id, "dismiss")}
              className={cn(
                isActioning &&
                  actionState!.type === "dismiss" &&
                  "bg-ink-100 text-ink-900",
              )}
            >
              <X className="h-3.5 w-3.5" />
              Dismiss
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleAction(flag.id, "resolve")}
              className={cn(
                isActioning &&
                  actionState!.type === "resolve" &&
                  "bg-ink-100 text-ink-900",
              )}
            >
              <Check className="h-3.5 w-3.5" />
              Resolve
            </Button>
            <div className="w-px h-4 bg-ink-200/40 mx-0.5" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setExpandedId(isExpanded ? null : flag.id)
              }
            >
              {isExpanded ? "Hide details" : "Show details"}
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── State A: never analyzed ────────────────────────────────────────────────

  if (isNeverAnalyzed && !loading) {
    return (
      <Card className="md:col-span-3">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-ink-300" />
            <CardTitle>Deal Confidence</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-10 gap-4 text-center max-w-md mx-auto">
            <p className="text-[13px] text-ink-500 leading-relaxed">
              Run an AI pass over this deal&apos;s notes to catch ambiguities,
              missing references, and conflicts with the structured terms —
              before they become 2am settlement fights.
            </p>
            <Button variant="brand" onClick={runAnalysis}>
              <Sparkles className="h-4 w-4" />
              Analyze with AI
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── State B: loading ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <Card className="md:col-span-3">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-ink-300" />
            <CardTitle>Deal Confidence</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <RotateCw className="h-5 w-5 text-brand-700 animate-spin" />
            <p className="text-[13px] text-ink-500">
              Reading deal notes… checking for conflicts and ambiguities…
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── State C: analyzed ─────────────────────────────────────────────────────

  const confidence = deal.extractionConfidence ?? 0;
  const timeAgo = deal.lastAnalyzedAt
    ? formatDistanceToNow(new Date(deal.lastAnalyzedAt), { addSuffix: true })
    : null;

  return (
    <Card accent={cardAccent} className="md:col-span-3">
      {/* Header */}
      <CardHeader>
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-ink-400" />
            <CardTitle>Deal Confidence</CardTitle>
          </div>
          {timeAgo && (
            <p className="text-[11px] text-ink-400 mt-0.5">
              Analyzed {timeAgo}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Tooltip
            label="How well the AI could parse this deal's prose. Lower scores mean more ambiguity or conflicts between prose and structured fields."
            side="bottom"
          >
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-md cursor-default",
                "text-[10.5px] font-medium ring-1 ring-inset",
                confidenceStyle(confidence),
              )}
            >
              {Math.round(confidence * 100)}% confidence
            </span>
          </Tooltip>
          <Button
            variant="outline"
            size="sm"
            onClick={runAnalysis}
            disabled={loading}
          >
            <RotateCw
              className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            />
            Re-analyze
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary row */}
        <div className="flex items-center gap-2 pb-3 border-b border-ink-100/80 flex-wrap">
          {openFlags.length === 0 ? (
            <div className="flex items-center gap-1.5 text-[12px] text-emerald-700 font-medium">
              <Check className="h-3.5 w-3.5" />
              Deal looks clean.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px]">
              {highCount > 0 && (
                <span className="font-semibold text-rose-700">
                  {highCount} high
                </span>
              )}
              {highCount > 0 && mediumCount > 0 && (
                <span className="text-ink-300">·</span>
              )}
              {mediumCount > 0 && (
                <span className="font-medium text-amber-700">
                  {mediumCount} medium
                </span>
              )}
              {(highCount > 0 || mediumCount > 0) && lowCount > 0 && (
                <span className="text-ink-300">·</span>
              )}
              {lowCount > 0 && (
                <span className="text-ink-500">{lowCount} low</span>
              )}
              <span className="text-ink-300">·</span>
              <span className="text-ink-500">{openFlags.length} open</span>
            </div>
          )}
          {closedFlags.length > 0 && (
            <span className="text-[11px] text-ink-400 ml-auto">
              {closedFlags.length} dismissed/resolved
            </span>
          )}
        </div>

        {/* Open flag list */}
        {openFlags.length > 0 && (
          <div className="space-y-3">
            {openFlags.map((flag) => renderFlagCard(flag))}
          </div>
        )}

        {/* Closed flags disclosure */}
        {closedFlags.length > 0 && (
          <div>
            <button
              className="flex items-center gap-1.5 text-[12px] text-ink-400 hover:text-ink-700 transition-colors py-1 cursor-pointer"
              onClick={() => setShowClosed(!showClosed)}
            >
              {showClosed ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showClosed ? "Hide" : "Show"} {closedFlags.length}{" "}
              {closedFlags.length === 1
                ? "dismissed/resolved flag"
                : "dismissed/resolved flags"}
            </button>
            {showClosed && (
              <div className="space-y-2 mt-2">
                {closedFlags.map((flag) => renderFlagCard(flag, true))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
