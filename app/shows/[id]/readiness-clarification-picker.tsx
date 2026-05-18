"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { DealAmbiguityClarificationQuestion } from "@/lib/dealAmbiguity";
import type { ReadinessAnswersMap } from "@/lib/readinessAnswers";
import { answerAsString } from "@/lib/readinessAnswers";
import { saveReadinessClarificationAnswer } from "./actions";

export function ReadinessClarificationPicker({
  showId,
  questions,
  initialAnswers,
  embedded = false,
}: {
  showId: string;
  questions: DealAmbiguityClarificationQuestion[];
  initialAnswers: ReadinessAnswersMap;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [answers, setAnswers] = useState<ReadinessAnswersMap>(initialAnswers);

  useEffect(() => {
    setAnswers(initialAnswers);
  }, [initialAnswers]);

  function isSelected(q: DealAmbiguityClarificationQuestion, opt: string): boolean {
    const v = answers[q.id];
    if (q.type === "multi_select") {
      const arr = Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
      return arr.includes(opt);
    }
    return typeof v === "string" && v === opt;
  }

  function onPick(q: DealAmbiguityClarificationQuestion, opt: string) {
    const prev = { ...answers };
    const next: ReadinessAnswersMap = { ...answers };
    if (q.type === "multi_select") {
      const cur = next[q.id];
      const arr = Array.isArray(cur)
        ? [...cur]
        : typeof cur === "string" && cur
          ? [cur]
          : [];
      const idx = arr.indexOf(opt);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(opt);
      if (arr.length === 0) delete next[q.id];
      else next[q.id] = arr;
    } else {
      next[q.id] = opt;
    }
    setAnswers(next);
    startTransition(async () => {
      const res = await saveReadinessClarificationAnswer(
        showId,
        q.id,
        opt,
        q.type
      );
      if (!res.ok) {
        setAnswers(prev);
        return;
      }
      router.refresh();
    });
  }

  if (questions.length === 0) return null;

  return (
    <div>
      {!embedded && (
        <>
          <div className="eyebrow text-[10px] text-ink-500 mb-2">
            Clarification questions
          </div>
          <p className="text-[11px] text-ink-400 mb-3 leading-snug">
            Be sure about each answer first—unclear choices here often cause
            trouble at settlement later. Tap an option to save it for this show;
            the workspace uses these when you calculate.
          </p>
        </>
      )}
      <ul className="space-y-4">
        {questions.map((q) => (
          <li
            key={q.id}
            className="rounded-lg ring-1 ring-brand-200/40 bg-brand-50/15 p-4"
          >
            <div className="text-[12px] text-ink-500 mb-1.5 capitalize">
              {q.type.replace(/_/g, " ")}
            </div>
            <div className="text-[13px] text-ink-900 font-medium leading-snug">
              {q.question}
            </div>
            {q.options.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const selected = isSelected(q, opt);
                  return (
                    <li key={opt}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onPick(q, opt)}
                        className={cn(
                          "text-left text-[11.5px] px-2.5 py-1.5 rounded-md transition-colors",
                          "ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40",
                          selected
                            ? "bg-brand-700 text-white ring-brand-800/30 shadow-sm"
                            : "bg-white/90 text-ink-800 ring-ink-200/70 hover:bg-white hover:ring-ink-300/80",
                          pending && "opacity-60"
                        )}
                      >
                        {opt}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {answerAsString(answers[q.id]) && (
              <p className="text-[10px] text-ink-500 mt-2.5 font-mono tabular">
                Saved: {answerAsString(answers[q.id])}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
