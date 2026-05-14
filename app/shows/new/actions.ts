"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { artists, deals, shows, ticketSales } from "@/db/schema";

export type CreateShowFormState = { error?: string } | undefined;

export async function createShow(
  _prev: CreateShowFormState,
  formData: FormData,
): Promise<CreateShowFormState> {
  const venueId = String(formData.get("venueId") ?? "").trim();
  const artistIdExisting = String(formData.get("artistId") ?? "").trim();
  const newArtistName = String(formData.get("newArtistName") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const doorsTime = String(formData.get("doorsTime") ?? "").trim() || null;
  const setTime = String(formData.get("setTime") ?? "").trim() || null;
  const dealType = String(formData.get("dealType") ?? "").trim() as
    | "flat"
    | "percentage_of_gross"
    | "percentage_of_net"
    | "vs"
    | "door";
  const dealNotesFreetext =
    String(formData.get("dealNotesFreetext") ?? "").trim() || null;

  const guaranteeRaw = String(formData.get("guaranteeAmount") ?? "").trim();
  const percentageRaw = String(formData.get("percentage") ?? "").trim();
  const expenseCapRaw = String(formData.get("expenseCap") ?? "").trim();

  const percentageBasisRaw = String(
    formData.get("percentageBasis") ?? "",
  ).trim() as "" | "gross" | "net";

  let percentageBasis: "gross" | "net" | null = null;
  if (
    dealType === "percentage_of_gross" ||
    dealType === "percentage_of_net" ||
    dealType === "vs"
  ) {
    if (percentageBasisRaw !== "gross" && percentageBasisRaw !== "net") {
      return {
        error:
          "Choose whether the percentage applies to gross or net box office.",
      };
    }
    percentageBasis = percentageBasisRaw;
  }

  if (!venueId) return { error: "Choose a venue." };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Enter a valid show date (YYYY-MM-DD)." };
  }
  if (!artistIdExisting && !newArtistName) {
    return { error: "Pick an existing artist or enter a new artist name." };
  }

  const validTypes = [
    "flat",
    "percentage_of_gross",
    "percentage_of_net",
    "vs",
    "door",
  ] as const;
  if (!validTypes.includes(dealType as (typeof validTypes)[number])) {
    return { error: "Invalid deal type." };
  }

  const guaranteeAmount = guaranteeRaw ? Number(guaranteeRaw) : null;
  const percentageHuman = percentageRaw ? Number(percentageRaw) : null;
  const expenseCap = expenseCapRaw ? Number(expenseCapRaw) : null;

  if (guaranteeRaw && (Number.isNaN(guaranteeAmount) || guaranteeAmount! < 0)) {
    return { error: "Guarantee must be a non-negative number." };
  }
  if (
    percentageRaw &&
    (Number.isNaN(percentageHuman) ||
      percentageHuman! < 0 ||
      percentageHuman! > 100)
  ) {
    return { error: "Percentage must be between 0 and 100." };
  }
  if (expenseCapRaw && (Number.isNaN(expenseCap) || expenseCap! < 0)) {
    return { error: "Expense cap must be a non-negative number." };
  }

  const percentage =
    percentageHuman != null && !Number.isNaN(percentageHuman)
      ? percentageHuman / 100
      : null;

  if (dealType === "flat") {
    if (guaranteeAmount == null || guaranteeAmount <= 0) {
      return { error: "Flat deals need a guarantee greater than zero." };
    }
  }
  if (dealType === "percentage_of_gross") {
    if (percentage == null || percentage <= 0) {
      return { error: "Percentage-of-gross deals need a percentage (1–100)." };
    }
  }
  if (dealType === "percentage_of_net") {
    if (percentage == null || percentage <= 0) {
      return { error: "Percentage-of-net deals need a percentage (1–100)." };
    }
  }
  if (dealType === "vs") {
    if (guaranteeAmount == null || guaranteeAmount < 0) {
      return { error: "Vs deals need a guarantee (0 or more)." };
    }
    if (percentage == null || percentage <= 0) {
      return { error: "Vs deals need a percentage of net (1–100)." };
    }
  }

  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const showId = `show_manual_${suffix}`;
  const dealId = `deal_manual_${suffix}`;
  const ticketId = `tix_manual_${suffix}`;
  const now = new Date();

  const newArtistId = newArtistName ? `artist_manual_${suffix}` : null;
  const resolvedArtistId = newArtistName ? newArtistId! : artistIdExisting;

  if (!resolvedArtistId) {
    return { error: "Pick an existing artist or enter a new artist name." };
  }

  await db.transaction(async (tx) => {
    if (newArtistName && newArtistId) {
      await tx.insert(artists).values({
        id: newArtistId,
        name: newArtistName,
        agentId: null,
        priorShowCount: 0,
      });
    }

    await tx.insert(shows).values({
      id: showId,
      venueId,
      artistId: resolvedArtistId,
      date,
      status: "booked",
      doorsTime,
      setTime,
      roomConfig: "standing",
      createdAt: now,
    });

    await tx.insert(deals).values({
      id: dealId,
      showId,
      dealType,
      guaranteeAmount:
        dealType === "flat" || dealType === "vs" ? guaranteeAmount : null,
      percentage:
        dealType === "percentage_of_gross" ||
        dealType === "percentage_of_net" ||
        dealType === "vs"
          ? percentage
          : null,
      percentageBasis,
      expenseCap:
        dealType === "percentage_of_net" ||
        dealType === "vs" ||
        dealType === "door"
          ? expenseCap
          : null,
      hospitalityCap: null,
      bonusesJson: null,
      dealNotesFreetext,
      createdAt: now,
    });

    await tx.insert(ticketSales).values({
      id: ticketId,
      showId,
      qty: 0,
      gross: 0,
      fees: 0,
      capturedAt: now,
    });
  });

  revalidatePath("/shows");
  revalidatePath("/artists");
  revalidatePath(`/shows/${showId}`);
  redirect(`/shows/${showId}/settle`);
}
