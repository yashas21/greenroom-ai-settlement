import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getShowById } from "@/lib/queries";
import { buildSettlementWorkspaceSeed } from "@/lib/settlementWorkspaceSeed";
import { SettlementWorkspace } from "../settlement-workspace";
import { formatShowDateFull } from "@/lib/format";

export default async function SettlementWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getShowById(id);
  if (!data) notFound();

  const { show, artist } = data;
  const seed = buildSettlementWorkspaceSeed(data);

  return (
    <div className="max-w-7xl px-12 pb-12 pt-10">
      <Link
        href={`/shows/${show.id}`}
        className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-900 mb-8 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to show
      </Link>

      <div className="mb-6">
        <h1
          className="font-display text-[32px] font-medium text-ink-900 leading-tight tracking-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          Settlement workspace
        </h1>
        <p className="text-[13px] text-ink-500 mt-2">
          <span className="text-ink-700 font-medium">
            {artist?.name ?? "—"}
          </span>
          <span className="text-ink-300 mx-2">·</span>
          {formatShowDateFull(show.date)}
        </p>
      </div>

      <SettlementWorkspace showId={show.id} {...seed} />
    </div>
  );
}
