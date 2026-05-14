import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getShowById } from "@/lib/queries";
import { DealTypeBadge } from "@/components/ui/badge";
import { buildSettlementEstimate } from "@/lib/settlementEstimate";
import { SettlementEstimatePanel } from "@/components/settlement/settlement-estimate-panel";
import { formatShowDateFull } from "@/lib/format";

/**
 * Booker-facing estimate: same numbers as internal settlement estimate,
 * without internal notes, deal free-text, or settlement commentary.
 */
export default async function SettleSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getShowById(id);
  if (!data) notFound();

  const { show, artist, deal, ticketSales, expenses } = data;
  if (!deal) {
    return (
      <div className="px-12 py-10 max-w-4xl">
        <Link
          href="/shows"
          className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-900 mb-8"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Shows
        </Link>
        <p className="text-[13px] text-ink-500">
          No deal on file — nothing to share yet.
        </p>
      </div>
    );
  }

  const estimate = buildSettlementEstimate({
    deal: { ...deal, dealNotesFreetext: null },
    ticketSales,
    expenses,
    venueCapacity: data.venue?.capacity ?? undefined,
  });

  return (
    <div className="px-12 py-10 max-w-3xl">
      <div className="mb-10">
        <div className="eyebrow text-[10px] text-ink-400 mb-2">
          Shared estimate · no internal notes
        </div>
        <div className="flex items-center gap-2 mb-3">
          <DealTypeBadge type={deal.dealType} />
        </div>
        <h1
          className="font-display text-[36px] font-medium text-ink-900 leading-[1.08]"
          style={{ letterSpacing: "-0.02em", fontOpticalSizing: "auto" }}
        >
          {artist?.name ?? "Artist"}
        </h1>
        <p className="text-[14px] text-ink-500 mt-2">
          {formatShowDateFull(show.date)}
          {data.venue?.name ? ` · ${data.venue.name}` : ""}
        </p>
      </div>

      <SettlementEstimatePanel
        showId={show.id}
        estimate={estimate}
        variant="share"
      />

      <p className="text-[11.5px] text-ink-400 mt-8 leading-relaxed max-w-md">
        This link is for external bookers. It omits show internal notes, deal
        free-text notes, and settlement sign-off / notes. Numbers reflect
        current ticket and expense data in Greenroom.
      </p>
    </div>
  );
}
