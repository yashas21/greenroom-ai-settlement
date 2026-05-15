"use server";

import { revalidatePath } from "next/cache";
import {
  setClarification,
  type ClarificationStatus,
} from "@/lib/clarifications";

export async function resolveFlag(
  flagId: string,
  status: ClarificationStatus,
  showId: string,
  note?: string,
) {
  await setClarification(flagId, status, note);
  revalidatePath(`/shows/${showId}/deal-sheet`);
  revalidatePath(`/wednesday`);
  revalidatePath(`/shows/${showId}`);
}
