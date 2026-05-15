"use client";

import {
  AlertTriangle,
  Check,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { Settlement, Recoup, Deal } from "@/db/schema";
import { calculateSettlement } from "@/lib/dealMath";
import { generateSettlementNarrative } from "@/lib/settlementNarrative";

export function SettlementExplanation({
  calc,
  deal,
  recoups,
  settlement,
}: {
  calc: Extract<ReturnType<typeof calculateSettlement>, { supported: true }>;
  deal: Deal;
  recoups?: Recoup[];
  settlement?: Settlement | null;
}) {
  const narrative = generateSettlementNarrative(calc, deal);

  const missingBasis = deal.dealType === "vs" && deal.percentageBasis == null;
  const hasNotes = !!deal.dealNotesFreetext;
  const hasDisputedRecoups = recoups?.some((r: Recoup) => r.status === "disputed");
  const exceededCap = deal.expenseCap != null && calc.totalExpenses > deal.expenseCap;
  
  // 1. Mismatch Keyword Detection
  const MISMATCH_KEYWORDS: Record<string, string> = {
    walkout: "Walkout bonuses often override structured deal logic.",
    door: "Door deals require manual ticket count verification.",
    tier: "Tiered payout structures are not modeled in current settlement logic.",
    ratchet: "Ratchet clauses often trigger based on undocumented thresholds.",
    bonus: "Notes mention a bonus that may not be in the structured fields.",
    "after merch": "Merchandise cuts can impact the final net basis.",
    "excluding marketing": "Marketing deductions may have custom exclusion rules.",
    buyout: "Buyouts often replace standard expense recoupment.",
  };

  const detectedKeywords = Object.entries(MISMATCH_KEYWORDS).filter(([word]) => 
    deal.dealNotesFreetext?.toLowerCase().includes(word)
  );

  // 2. Scoring Logic
  let confidence: "high" | "medium" | "low" = "high";
  const notices: string[] = [];

  if (detectedKeywords.length > 0 || hasDisputedRecoups || settlement?.status === "disputed" || missingBasis) {
    confidence = "low";
  } else if (hasNotes || exceededCap) {
    confidence = "medium";
  }

  if (hasNotes) notices.push("Free-text notes include custom settlement language.");
  if (exceededCap) notices.push("Expense submissions exceeded negotiated cap.");
  if (missingBasis) notices.push("Structured fields may not fully capture negotiated terms (missing basis).");
  if (hasDisputedRecoups) notices.push("Disputed recoups require manual mediation.");

  const confidenceColors = {
    high: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    medium: "bg-amber-50 text-amber-700 ring-amber-600/20",
    low: "bg-rose-50 text-rose-700 ring-rose-600/20",
  };

  return (
    <Card accent="brand">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <span className="bg-brand-100 text-brand-700 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">AI-Assisted</span>
            Settlement Audit Trail
          </CardTitle>
          <CardDescription>
            Intelligent trace comparing structured math to real-world deal reality.
          </CardDescription>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${confidenceColors[confidence]}`}>
            {confidence.toUpperCase()} CONFIDENCE
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* What the system noticed */}
        {notices.length > 0 && (
          <div className="bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60">
            <div className="eyebrow text-[10px] text-ink-500 mb-2">What the system noticed</div>
            <ul className="space-y-1">
              {notices.map((notice, i) => (
                <li key={i} className="text-[12.5px] text-ink-700 flex items-center gap-2">
                  <div className="h-1 w-1 rounded-full bg-ink-400" />
                  {notice}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Keyword Mismatch Check */}
        {detectedKeywords.length > 0 && (
          <div className="border-l-4 border-l-rose-400 bg-rose-50/30 p-4 rounded-r-lg ring-1 ring-rose-200/60">
            <div className="flex items-center gap-2 text-rose-800 font-semibold text-[13px] mb-2">
              <AlertTriangle className="h-4 w-4" />
              Potential mismatch detected
            </div>
            <div className="space-y-3">
              {detectedKeywords.map(([word, reason], i) => (
                <div key={i}>
                  <div className="text-[12px] font-mono font-bold text-rose-900 uppercase tracking-tight">Keyword: &ldquo;{word}&rdquo;</div>
                  <div className="text-[12.5px] text-rose-800/80 leading-snug">{reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deal Source Check */}
        {hasNotes && (
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-2">Deal Source Reality Check</div>
            <div className="text-[12.5px] text-ink-800 bg-amber-50/50 rounded-lg p-4 ring-1 ring-amber-200/60 leading-relaxed border-l-4 border-l-amber-400">
              <span className="font-semibold text-amber-900 block mb-1">Deal notes are source of truth for custom terms.</span>
              &ldquo;{deal.dealNotesFreetext}&rdquo;
            </div>
          </div>
        )}

        {/* Calculation Trace */}
        <div>
           <div className="eyebrow text-[10px] text-ink-500 mb-2">Calculation Trace</div>
           <ul className="space-y-1.5 list-disc list-outside ml-4">
             {narrative.bullets.map((b: string, i: number) => (
               <li
                 key={i}
                 className="text-[13px] text-ink-600 pl-1 leading-relaxed"
               >
                 {b}
               </li>
             ))}
           </ul>
        </div>

        {/* Copyable Explanation */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="eyebrow text-[10px] text-ink-500">
              Tour manager summary
            </div>
            <div className="text-[10px] text-brand-700 font-medium bg-brand-50 px-2 py-0.5 rounded border border-brand-200 uppercase tracking-wide">
              Ready to paste into email/text
            </div>
          </div>
          <div className="relative group">
            <div className="text-[12.5px] font-mono text-ink-800 bg-ink-50/50 rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed select-all whitespace-pre-wrap">
              {narrative.copyableText}
            </div>
            <button 
              className="absolute top-2 right-2 p-1.5 rounded-md bg-white border border-ink-200 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-canvas-soft"
              title="Copy to clipboard"
              onClick={() => {
                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  navigator.clipboard.writeText(narrative.copyableText);
                }
              }}
            >
              <Check className="h-3.5 w-3.5 text-ink-600" />
            </button>
          </div>
        </div>

        {/* Helper Footer */}
        <div className="pt-2 border-t border-ink-100">
          <p className="text-[11px] text-ink-400 italic text-center">
            This audit trail assists settlement review but does not replace manual verification of negotiated deal terms.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
