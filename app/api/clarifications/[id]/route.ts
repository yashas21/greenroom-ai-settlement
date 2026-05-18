/**
 * PATCH /api/clarifications/[id]
 *
 * Updates a clarification's status. The booker calls this when they dismiss
 * or resolve a flag raised by the AI analysis.
 *
 * Body: { status: "dismissed" | "resolved", dismissal_reason?: string }
 * Returns: the updated clarification row.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { dealClarifications } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { status?: string; dismissal_reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, dismissal_reason } = body;

  if (status !== "dismissed" && status !== "resolved") {
    return NextResponse.json(
      { error: 'status must be "dismissed" or "resolved"' },
      { status: 400 },
    );
  }

  // Verify the clarification exists
  const [existing] = await db
    .select()
    .from(dealClarifications)
    .where(eq(dealClarifications.id, id));

  if (!existing) {
    return NextResponse.json(
      { error: "Clarification not found" },
      { status: 404 },
    );
  }

  const now = Date.now();

  const [updated] = await db
    .update(dealClarifications)
    .set({
      status,
      dismissalReason: dismissal_reason ?? null,
      resolvedAt: now,
    })
    .where(eq(dealClarifications.id, id))
    .returning();

  return NextResponse.json(updated);
}
