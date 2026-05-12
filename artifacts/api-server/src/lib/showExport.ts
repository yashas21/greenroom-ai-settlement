import Anthropic from "@anthropic-ai/sdk";
import { getShowById, parseRecoups } from "./queries";
import { db } from "../db";
import { agents, agencies, venues } from "../db/schema";
import { eq } from "drizzle-orm";

type SummaryShape = {
  reason: string;
  numbersDiscussedInNotes: { value: string; context: string }[];
  warnings: { kind: "missing_in_spreadsheet" | "ambiguous" | "other"; message: string }[];
  netToVenue: number | null;
  netToArtist: number | null;
};

const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

const client: Anthropic | null =
  baseUrl && apiKey
    ? new Anthropic({ baseURL: baseUrl, apiKey })
    : null;

function buildSpreadsheetSection(detail: Awaited<ReturnType<typeof getShowById>>) {
  if (!detail) return null;
  const { show, artist, deal, settlement, ticketSales, expenses, comps, recoups } = detail;

  const totalGross = ticketSales.reduce((s, t) => s + t.gross, 0);
  const totalFees = ticketSales.reduce((s, t) => s + t.fees, 0);
  const totalTickets = ticketSales.reduce((s, t) => s + (t.qty ?? 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const absorbedExpenses = expenses
    .filter((e) => e.absorbedByVenue)
    .reduce((s, e) => s + e.amount, 0);
  const expensesByCategory: Record<string, number> = {};
  for (const e of expenses) {
    expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + e.amount;
  }
  const recoupsTotal = recoups.reduce((s, r) => s + r.amount, 0);

  const closed = settlement?.status === "signed"
    || settlement?.status === "finalized"
    || settlement?.status === "paid";

  const netToArtist = settlement?.totalToArtist ?? null;
  const netToVenue = settlement?.grossBoxOffice != null && settlement?.totalToArtist != null
    ? settlement.grossBoxOffice - settlement.totalToArtist - totalExpenses
    : null;

  return {
    show: {
      id: show.id,
      date: show.date,
      status: show.status,
      doorsTime: show.doorsTime,
      setTime: show.setTime,
      roomConfig: show.roomConfig,
      internalNotes: show.internalNotes,
    },
    artist: artist ? { id: artist.id, name: artist.name, genre: artist.genre } : null,
    deal: deal
      ? {
          dealType: deal.dealType,
          guaranteeAmount: deal.guaranteeAmount,
          percentage: deal.percentage,
          percentageBasis: deal.percentageBasis,
          expenseCap: deal.expenseCap,
          hospitalityCap: deal.hospitalityCap,
          bonuses: deal.bonusesJson ? safeParse(deal.bonusesJson) : [],
          dealNotesFreetext: deal.dealNotesFreetext,
        }
      : null,
    ticketSales: {
      totalGross,
      totalFees,
      totalTickets,
      lines: ticketSales.map((t) => ({
        qty: t.qty,
        gross: t.gross,
        fees: t.fees,
        capturedAt: t.capturedAt,
      })),
    },
    comps: {
      totalCount: comps.reduce((s, c) => s + c.count, 0),
      lines: comps.map((c) => ({
        category: c.category,
        count: c.count,
        faceValue: c.faceValue,
        countsTowardGross: c.countsTowardGross,
        notes: c.notes,
      })),
    },
    expenses: {
      totalExpenses,
      absorbedByVenue: absorbedExpenses,
      byCategory: expensesByCategory,
      lines: expenses.map((e) => ({
        category: e.category,
        amount: e.amount,
        description: e.description,
        approved: e.approved,
        absorbedByVenue: e.absorbedByVenue,
      })),
    },
    recoups: {
      total: recoupsTotal,
      disputedTotal: recoups.filter((r) => r.status === "disputed").reduce((s, r) => s + r.amount, 0),
      lines: recoups,
    },
    settlement: settlement
      ? {
          status: settlement.status,
          closed,
          grossBoxOffice: settlement.grossBoxOffice,
          netBoxOffice: settlement.netBoxOffice,
          totalExpenses: settlement.totalExpenses,
          totalToArtist: settlement.totalToArtist,
          notes: settlement.notes,
          signoffText: settlement.signoffText,
          netToVenue,
          netToArtist,
        }
      : null,
    flags: {
      isUnsupportedDeal: detail.isUnsupportedDeal,
      isDisputed: detail.isDisputed,
      isClosed: !!closed,
    },
  };
}

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

function collectFreetext(detail: NonNullable<Awaited<ReturnType<typeof getShowById>>>) {
  const notes: { source: string; text: string }[] = [];
  if (detail.show.internalNotes) notes.push({ source: "show.internalNotes", text: detail.show.internalNotes });
  if (detail.deal?.dealNotesFreetext) notes.push({ source: "deal.dealNotesFreetext", text: detail.deal.dealNotesFreetext });
  if (detail.settlement?.notes) notes.push({ source: "settlement.notes", text: detail.settlement.notes });
  if (detail.settlement?.signoffText) notes.push({ source: "settlement.signoffText", text: detail.settlement.signoffText });
  for (const e of detail.expenses) {
    if (e.description) notes.push({ source: `expense[${e.category}]`, text: e.description });
  }
  for (const c of detail.comps) {
    if (c.notes) notes.push({ source: `comp[${c.category}]`, text: c.notes });
  }
  return notes;
}

async function callLLM(
  spreadsheet: ReturnType<typeof buildSpreadsheetSection>,
  notes: { source: string; text: string }[],
): Promise<{ summary: SummaryShape | null; error?: string }> {
  if (!client) {
    return { summary: null, error: "anthropic_not_configured" };
  }

  const prompt = `You are an analyst for a small live-music venue. Analyse one show's settlement.

Return STRICT JSON matching this TypeScript shape (no prose, no markdown fences):

{
  "reason": string,                                    // 2-4 sentence plain-English recap of how this show went and why the settlement landed where it did
  "numbersDiscussedInNotes": [                          // every dollar/percentage/count mentioned in any freetext note
    { "value": string, "context": string }
  ],
  "warnings": [                                         // each number/term mentioned in notes that is NOT also captured as a structured field
    { "kind": "missing_in_spreadsheet" | "ambiguous" | "other", "message": string }
  ],
  "netToVenue": number | null,                          // your best estimate of net to the venue if the show is closed; otherwise null
  "netToArtist": number | null                          // your best estimate of net to the artist if the show is closed; otherwise null
}

Use the structured spreadsheet section below as the source of truth for what IS captured. Compare every number that appears in the FREETEXT NOTES against the spreadsheet — if a note mentions a dollar amount, percentage, cap, side-deal, bonus, or recoup that is not represented as a structured field, raise a "missing_in_spreadsheet" warning.

If the settlement is closed (flags.isClosed === true), populate netToVenue and netToArtist using the structured numbers; otherwise return null for both.

SPREADSHEET (structured):
${JSON.stringify(spreadsheet, null, 2)}

FREETEXT NOTES:
${notes.length === 0 ? "(none)" : notes.map((n) => `[${n.source}] ${n.text}`).join("\n\n")}
`;

  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const block = resp.content[0];
    const text = block && block.type === "text" ? block.text : "";
    const cleaned = text.trim().replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(cleaned) as SummaryShape;
    return { summary: parsed };
  } catch (err) {
    return { summary: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function buildShowExport(showId: string) {
  const detail = await getShowById(showId);
  if (!detail) return null;

  const spreadsheet = buildSpreadsheetSection(detail);
  if (!spreadsheet) return null;

  const [agentRow, agencyRow, venueRow] = await Promise.all([
    detail.artist?.agentId
      ? db.select().from(agents).where(eq(agents.id, detail.artist.agentId)).limit(1)
      : Promise.resolve([]),
    detail.agent?.agencyId
      ? db.select().from(agencies).where(eq(agencies.id, detail.agent.agencyId)).limit(1)
      : Promise.resolve([]),
    db.select().from(venues).where(eq(venues.id, detail.show.venueId)).limit(1),
  ]);

  const fullSpreadsheet = {
    ...spreadsheet,
    agent: agentRow[0]
      ? {
          name: agentRow[0].name,
          email: agentRow[0].email,
          phone: agentRow[0].phone,
          preferencesNotes: agentRow[0].preferencesNotes,
        }
      : null,
    agency: agencyRow[0] ? { name: agencyRow[0].name } : null,
    venue: venueRow[0]
      ? {
          name: venueRow[0].name,
          city: venueRow[0].city,
          state: venueRow[0].state,
          capacity: venueRow[0].capacity,
        }
      : null,
  };

  const notes = collectFreetext(detail);
  if (agentRow[0]?.preferencesNotes) {
    notes.push({ source: "agent.preferencesNotes", text: agentRow[0].preferencesNotes });
  }

  const llm = await callLLM(fullSpreadsheet, notes);

  return {
    schemaVersion: "greenroom.show-export.v1",
    generatedAt: new Date().toISOString(),
    showId: detail.show.id,
    spreadsheet: fullSpreadsheet,
    freetextNotes: notes,
    summary: llm.summary,
    summaryError: llm.error ?? null,
    recoupsParsed: parseRecoups(detail.settlement?.recoupsJson ?? null),
  };
}
