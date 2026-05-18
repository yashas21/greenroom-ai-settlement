"use client";

import { useCallback, useEffect, useId, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Mail,
  Scale,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PlainBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  DealAmbiguityClarificationQuestion,
  DealAmbiguityReview,
  DealAmbiguityReviewLevel,
} from "@/lib/dealAmbiguity";
import type { ReadinessAnswersMap } from "@/lib/readinessAnswers";
import { parseReadinessAnswersJson } from "@/lib/readinessAnswers";
import { ReadinessClarificationPicker } from "./readiness-clarification-picker";
import { requestClarificationEmailDraft } from "./actions";

function clarificationAnswered(
  q: DealAmbiguityClarificationQuestion,
  answers: ReadinessAnswersMap
): boolean {
  const v = answers[q.id];
  if (v == null) return false;
  if (q.type === "multi_select") {
    return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.length > 0;
  }
  return typeof v === "string" && v.length > 0;
}

function clarificationsProgress(
  questions: DealAmbiguityClarificationQuestion[] | undefined,
  answers: ReadinessAnswersMap
): { answered: number; total: number; allAnswered: boolean } {
  const list = Array.isArray(questions) ? questions : [];
  const total = list.length;
  if (total === 0) return { answered: 0, total: 0, allAnswered: true };
  const answered = list.filter((q) => clarificationAnswered(q, answers)).length;
  return { answered, total, allAnswered: answered === total };
}

function normalizeReviewLevel(
  review: DealAmbiguityReview | null
): DealAmbiguityReviewLevel {
  if (!review) return "low";
  const l = review.reviewLevel;
  if (l === "low" || l === "medium" || l === "high") return l;
  return "low";
}

function clarificationQuestionsList(
  review: DealAmbiguityReview | null
): DealAmbiguityClarificationQuestion[] {
  if (!review || !Array.isArray(review.clarificationQuestions)) return [];
  return review.clarificationQuestions;
}

function reviewSummaryList(review: DealAmbiguityReview | null): string[] {
  if (!review || !Array.isArray(review.summary)) return [];
  return review.summary.filter((s): s is string => typeof s === "string");
}

function reviewSignalsList(review: DealAmbiguityReview | null) {
  if (!review || !Array.isArray(review.reviewSignals)) return [];
  return review.reviewSignals;
}

const levelLabel: Record<DealAmbiguityReviewLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function reviewLevelBadgeVariant(
  level: DealAmbiguityReviewLevel
): "rose" | "amber" | "default" {
  if (level === "high") return "rose";
  if (level === "medium") return "amber";
  return "default";
}

function triggerLevelClass(
  level: DealAmbiguityReviewLevel,
  opts?: { clarificationsSettled?: boolean }
): string {
  const clarificationsSettled = opts?.clarificationsSettled === true;
  switch (level) {
    case "high":
      if (clarificationsSettled) {
        return cn(
          "w-full sm:w-auto justify-center",
          "bg-gradient-to-b from-rose-50 to-rose-100/90 text-ink-900",
          "ring-2 ring-rose-300/70 ring-offset-2 ring-offset-canvas",
          "shadow-md shadow-rose-900/10"
        );
      }
      return cn(
        "relative overflow-hidden w-full sm:w-auto justify-center",
        "bg-gradient-to-br from-rose-600 via-rose-700 to-rose-900 text-white",
        "shadow-[0_0_0_1px_rgba(251,113,133,0.6),0_10px_40px_-8px_rgba(190,18,60,0.55)]",
        "ring-2 ring-rose-400/90 ring-offset-2 ring-offset-canvas",
        "before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.12),transparent_55%)]",
        "animate-pulse"
      );
    case "medium":
      return cn(
        "w-full sm:w-auto justify-center",
        "bg-gradient-to-b from-amber-50 to-amber-100/90 text-ink-900",
        "ring-2 ring-amber-400/70 ring-offset-2 ring-offset-canvas",
        "shadow-md shadow-amber-900/10"
      );
    default:
      return cn(
        "w-full sm:w-auto justify-center",
        "bg-gradient-to-b from-brand-50 to-brand-50/90 text-ink-900",
        "ring-1 ring-brand-200/90 ring-inset",
        "shadow-sm shadow-brand-900/5"
      );
  }
}

function ReviewLevelBadge({ level }: { level: DealAmbiguityReviewLevel }) {
  return (
    <PlainBadge variant={reviewLevelBadgeVariant(level)} className="capitalize">
      {level} review
    </PlainBadge>
  );
}

function SignalSeverityBadge({ severity }: { severity: DealAmbiguityReviewLevel }) {
  return (
    <PlainBadge variant={reviewLevelBadgeVariant(severity)} className="capitalize shrink-0">
      {severity}
    </PlainBadge>
  );
}

export function SettlementReadinessLauncher({
  showId,
  dealType,
  hasDealNotes,
  review,
  error,
  readinessAnswersJson,
}: {
  showId: string;
  dealType: string | null;
  hasDealNotes: boolean;
  review: DealAmbiguityReview | null;
  error: string | null;
  readinessAnswersJson: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [clarificationEmailBody, setClarificationEmailBody] = useState<
    string | null
  >(null);
  const [clarificationEmailError, setClarificationEmailError] = useState<
    string | null
  >(null);
  const [emailDraftPending, startEmailDraftTransition] = useTransition();
  const titleId = useId();
  const savedAnswers: ReadinessAnswersMap = parseReadinessAnswersJson(
    readinessAnswersJson
  );

  const clarifyProgress = review
    ? clarificationsProgress(clarificationQuestionsList(review), savedAnswers)
    : null;
  const clarificationsSettled =
    clarifyProgress != null &&
    clarifyProgress.total > 0 &&
    clarifyProgress.allAnswered;

  const close = useCallback(() => {
    setOpen(false);
    setClarificationEmailBody(null);
    setClarificationEmailError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  if (!hasDealNotes) {
    if (dealType === "vs") {
      return (
        <div className="rounded-lg border border-dashed border-ink-200/90 bg-ink-50/50 px-3 py-2.5 text-[12px] text-ink-500 leading-snug">
          <span className="font-medium text-ink-700">Vs deal</span>
          {" — "}
          Add free-text deal notes above to run settlement readiness and
          clarifying questions.
        </div>
      );
    }
    return null;
  }

  const canOpen = review != null || error != null;
  const isVs = dealType === "vs";
  const level = normalizeReviewLevel(review);
  const urgent = level === "high" && !clarificationsSettled;

  return (
    <div className="space-y-2">
      {isVs && review ? (
        <div className="space-y-1.5">
          <Button
            type="button"
            variant="secondary"
            className={cn(
              "h-auto min-h-10 py-2.5 px-4 gap-2 font-semibold tracking-tight",
              triggerLevelClass(level, { clarificationsSettled })
            )}
            onClick={() => setOpen(true)}
          >
            {clarificationsSettled ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            ) : urgent ? (
              <AlertTriangle className="h-4 w-4 shrink-0 opacity-95" aria-hidden />
            ) : level === "medium" ? (
              <Scale className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            )}
            {clarificationsSettled && clarifyProgress && clarifyProgress.total > 0
              ? `Clarifications saved (${clarifyProgress.answered}/${clarifyProgress.total}) · ${levelLabel[level]}`
              : `Deal ambiguity — ${levelLabel[level]}`}
          </Button>
          {urgent && (
            <p className="text-[11px] font-medium text-rose-700 flex items-center gap-1.5">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-rose-600 animate-ping"
                aria-hidden
              />
              Click to review clarifying questions and payout signals.
            </p>
          )}
          {clarificationsSettled && level === "high" && (
            <p className="text-[11px] text-ink-500 leading-snug">
              Open anytime to edit answers or re-read payout signals.
            </p>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant={isVs && error ? "outline" : "secondary"}
          size="default"
          className={cn(
            "gap-2",
            isVs &&
              error &&
              "border-rose-300/90 text-rose-900 bg-rose-50/60 hover:bg-rose-50"
          )}
          onClick={() => setOpen(true)}
          disabled={!canOpen}
        >
          {isVs && error ? (
            <>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Deal ambiguity — open for details
            </>
          ) : (
            <>
              {clarificationsSettled ? (
                <CheckCircle2 className="h-4 w-4 text-brand-700" />
              ) : (
                <ClipboardCheck className="h-4 w-4 text-brand-700" />
              )}
              {clarificationsSettled && clarifyProgress && clarifyProgress.total > 0
                ? `Clarifications saved (${clarifyProgress.answered}/${clarifyProgress.total})`
                : "Open settlement readiness"}
            </>
          )}
        </Button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-6"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-ink-900/45 backdrop-blur-[2px]"
            aria-label="Close dialog"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cn(
              "relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-ink-200/90 bg-white shadow-2xl",
              "sm:rounded-2xl sm:max-h-[85vh]"
            )}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink-100/90 bg-canvas-soft/80 px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 rounded-md bg-brand-50 p-2 text-brand-700 ring-1 ring-brand-200/60">
                  <ClipboardCheck className="h-4 w-4" />
                </div>
                <div>
                  <h2
                    id={titleId}
                    className="text-[15px] font-semibold text-ink-900 tracking-tight"
                  >
                    Settlement readiness
                  </h2>
                  <p className="text-[12px] text-ink-500 mt-0.5">
                    AI scan of deal notes — not a final settlement.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {review && <ReviewLevelBadge level={level} />}
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-900 transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {error ? (
                <p className="text-[13px] text-rose-800 leading-relaxed">{error}</p>
              ) : review ? (
                <div className="space-y-6">
                  {clarificationQuestionsList(review).length > 0 && (
                    <section
                      className="rounded-xl border-2 border-brand-400/50 bg-brand-50/40 p-4 ring-1 ring-brand-200/60"
                      aria-labelledby="readiness-clarify-heading"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 gap-y-2 mb-1">
                        <h3
                          id="readiness-clarify-heading"
                          className="text-[11px] font-bold uppercase tracking-wide text-brand-900 shrink-0"
                        >
                          Clarifying questions
                        </h3>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0 gap-1.5 h-9 px-3 text-[12px] border-brand-300/80 bg-white/90 text-brand-900 hover:bg-white disabled:opacity-60"
                          disabled={
                            emailDraftPending ||
                            clarificationQuestionsList(review).length === 0
                          }
                          onClick={() => {
                            setClarificationEmailError(null);
                            setClarificationEmailBody(null);
                            startEmailDraftTransition(async () => {
                              const res = await requestClarificationEmailDraft(
                                clarificationQuestionsList(review)
                              );
                              if (res.ok) {
                                setClarificationEmailBody(res.body);
                              } else {
                                setClarificationEmailError(res.error);
                              }
                            });
                          }}
                        >
                          <Mail className="h-3.5 w-3.5 shrink-0 text-brand-700" aria-hidden />
                          {emailDraftPending
                            ? "Drafting…"
                            : "Draft Clarification Email"}
                        </Button>
                      </div>
                      <p className="text-[12px] text-brand-800/90 mb-4 leading-snug">
                        Be sure about each answer before you move on—if these stay
                        fuzzy, they often turn into settlement problems later. Tap
                        an option to save your choice on this show (the workspace
                        picks these up when you calculate).
                      </p>
                      <ReadinessClarificationPicker
                        showId={showId}
                        questions={clarificationQuestionsList(review)}
                        initialAnswers={savedAnswers}
                        embedded
                      />
                      {clarificationEmailError && (
                        <p className="text-[12px] text-rose-800 mt-3 leading-snug">
                          {clarificationEmailError}
                        </p>
                      )}
                      {clarificationEmailBody && (
                        <div className="mt-4 rounded-lg border border-brand-200/70 bg-white/90 p-3 ring-1 ring-brand-100/80">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-800">
                              Email draft
                            </span>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-8 text-[11px]"
                              onClick={() => {
                                void navigator.clipboard.writeText(
                                  clarificationEmailBody
                                );
                              }}
                            >
                              Copy
                            </Button>
                          </div>
                          <textarea
                            readOnly
                            rows={12}
                            className="w-full resize-y min-h-[8rem] rounded-md border border-ink-200/90 bg-canvas-soft/50 px-3 py-2.5 text-[13px] text-ink-900 leading-relaxed font-sans shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/25"
                            value={clarificationEmailBody}
                            aria-label="Generated clarification email body"
                          />
                        </div>
                      )}
                    </section>
                  )}

                  {reviewSummaryList(review).length > 0 && (
                    <section>
                      <div className="eyebrow text-[10px] text-ink-500 mb-2">
                        Summary
                      </div>
                      <ul className="list-disc space-y-1.5 pl-4 text-[13px] text-ink-800 leading-relaxed">
                        {reviewSummaryList(review).map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {reviewSignalsList(review).length > 0 && (
                    <section>
                      <div className="eyebrow text-[10px] text-ink-500 mb-2">
                        Review signals
                      </div>
                      <ul className="space-y-3">
                        {reviewSignalsList(review).map((sig, i) => (
                          <li
                            key={`${sig.title}-${i}`}
                            className="flex gap-3 items-start rounded-lg bg-canvas-soft ring-1 ring-ink-200/40 p-3"
                          >
                            <SignalSeverityBadge severity={sig.severity} />
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium text-ink-900">
                                {sig.title}
                              </div>
                              <div className="text-[12px] text-ink-600 mt-1 leading-relaxed">
                                {sig.reason}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {reviewSummaryList(review).length === 0 &&
                    reviewSignalsList(review).length === 0 &&
                    clarificationQuestionsList(review).length === 0 && (
                      <p className="text-[13px] text-ink-500">
                        Review returned no structured fields.
                      </p>
                    )}
                </div>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-ink-100/90 bg-canvas-soft/50 px-5 py-3 flex justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={close}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
