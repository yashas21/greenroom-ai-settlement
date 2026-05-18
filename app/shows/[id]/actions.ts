"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settlements } from "@/db/schema";
import type { DealAmbiguityClarificationQuestion } from "@/lib/dealAmbiguity";
import { generateClarificationEmailBody } from "@/lib/clarificationEmailDraft";
import { mergeShowReadinessAnswer } from "@/lib/queries";

const BLOCKED_WORKSPACE_SAVE_STATUSES = new Set([
  "paid",
  "voided",
]);

export type WorkspaceSettlementSavePayload = {
  totalToArtist: number;
  grossBoxOffice: number;
  netBoxOffice: number;
  totalExpenses: number;
  snapshot: Record<string, unknown>;
};

export async function saveWorkspaceSettlement(
  showId: string,
  payload: WorkspaceSettlementSavePayload
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    totalToArtist,
    grossBoxOffice,
    netBoxOffice,
    totalExpenses,
    snapshot,
  } = payload;
  for (const [key, n] of [
    ["totalToArtist", totalToArtist],
    ["grossBoxOffice", grossBoxOffice],
    ["netBoxOffice", netBoxOffice],
    ["totalExpenses", totalExpenses],
  ] as const) {
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return { ok: false, error: `Invalid number for ${key}` };
    }
  }

  const now = new Date();
  const calculationJson = JSON.stringify({
    ...snapshot,
    source: "settlement_workspace",
    savedAt: now.toISOString(),
  });

  try {
    const existing = await db
      .select()
      .from(settlements)
      .where(eq(settlements.showId, showId))
      .limit(1);

    const row = existing[0];
    if (row && BLOCKED_WORKSPACE_SAVE_STATUSES.has(row.status)) {
      return {
        ok: false,
        error: `Cannot save from workspace while settlement is ${row.status}.`,
      };
    }

    if (row) {
      await db
        .update(settlements)
        .set({
          grossBoxOffice,
          netBoxOffice,
          totalExpenses,
          totalToArtist,
          calculationJson,
        })
        .where(eq(settlements.id, row.id));
    } else {
      await db.insert(settlements).values({
        id: `stl_${showId}`,
        showId,
        status: "draft",
        draftedAt: now,
        grossBoxOffice,
        netBoxOffice,
        totalExpenses,
        totalToArtist,
        calculationJson,
      });
    }

    revalidatePath(`/shows/${showId}`);
    revalidatePath(`/shows/${showId}/workspace`);
    revalidatePath(`/shows/${showId}/settle`);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Save failed";
    return { ok: false, error: message };
  }
}

export async function requestClarificationEmailDraft(
  questions: DealAmbiguityClarificationQuestion[]
): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  try {
    if (!Array.isArray(questions) || questions.length === 0) {
      return { ok: false, error: "No clarification questions to draft from." };
    }
    const body = await generateClarificationEmailBody(questions);
    return { ok: true, body };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Draft failed";
    return { ok: false, error: message };
  }
}

export async function saveReadinessClarificationAnswer(
  showId: string,
  questionId: string,
  option: string,
  questionType: "single_select" | "multi_select"
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mergeShowReadinessAnswer(showId, questionId, option, questionType);
    revalidatePath(`/shows/${showId}`);
    revalidatePath(`/shows/${showId}/workspace`);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Save failed";
    return { ok: false, error: message };
  }
}
