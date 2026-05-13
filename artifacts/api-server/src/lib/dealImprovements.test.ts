import { describe, expect, it, beforeEach } from "vitest";

process.env.DATABASE_URL = "file::memory:";

const { client, db } = await import("../db");
const schema = await import("../db/schema");
const dealImprovementsMod = await import("./dealImprovements");
const { getDealImprovements, __TEST_CONSTANTS__ } = dealImprovementsMod;

const CREATE = `
CREATE TABLE shows (
  id TEXT PRIMARY KEY NOT NULL, venue_id TEXT NOT NULL, artist_id TEXT NOT NULL,
  date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'booked',
  doors_time TEXT, set_time TEXT, opener_artist_id TEXT,
  room_config TEXT NOT NULL DEFAULT 'standing', internal_notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE deals (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL UNIQUE,
  deal_type TEXT NOT NULL, guarantee_amount REAL, percentage REAL,
  percentage_basis TEXT, expense_cap REAL, hospitality_cap REAL,
  bonuses_json TEXT, deal_notes_freetext TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE settlements (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  drafted_at INTEGER, submitted_at INTEGER, review_started_at INTEGER,
  signed_at INTEGER, disputed_at INTEGER, revised_at INTEGER,
  finalized_at INTEGER, paid_at INTEGER, completed_at INTEGER,
  completed_by_user_id TEXT,
  gross_box_office REAL, net_box_office REAL, total_expenses REAL,
  total_to_artist REAL, calculation_json TEXT, recoups_json TEXT,
  signoff_text TEXT, notes TEXT,
  positive_summary TEXT, negative_summary TEXT
);
CREATE TABLE expenses (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL, category TEXT NOT NULL,
  amount REAL NOT NULL, description TEXT,
  approved INTEGER NOT NULL DEFAULT 1, absorbed_by_venue INTEGER NOT NULL DEFAULT 0,
  entered_by_user_id TEXT, entered_at INTEGER NOT NULL
);
`;

beforeEach(async () => {
  for (const stmt of CREATE.split(";").map((s) => s.trim()).filter(Boolean)) {
    try { await client.execute(`DROP TABLE IF EXISTS ${stmt.match(/CREATE TABLE (\w+)/)![1]}`); } catch { /* */ }
    await client.execute(stmt);
  }
});

async function seedShow(opts: {
  showId: string;
  dealType: "vs" | "percentage_of_net" | "percentage_of_gross" | "door" | "flat";
  guaranteeAmount: number | null;
  expenseCap?: number | null;
  hospitalityCap?: number | null;
  percentage?: number | null;
}) {
  await db.insert(schema.shows).values({
    id: opts.showId, venueId: "v1", artistId: "a1",
    date: "2026-01-15", status: "settled", roomConfig: "standing",
    createdAt: new Date(),
  });
  await db.insert(schema.deals).values({
    id: `d-${opts.showId}`, showId: opts.showId,
    dealType: opts.dealType,
    guaranteeAmount: opts.guaranteeAmount,
    percentage: opts.percentage ?? null,
    expenseCap: opts.expenseCap ?? null,
    hospitalityCap: opts.hospitalityCap ?? null,
    createdAt: new Date(),
  });
}

describe("dealImprovements — audit fixes", () => {
  it("never returns convert_to_flat (Smart Switch owns flat conversion)", async () => {
    await seedShow({
      showId: "s1", dealType: "vs", guaranteeAmount: 2500,
      expenseCap: null, hospitalityCap: null,
    });
    const out = await getDealImprovements("s1");
    expect(out.improvements.find((i) => (i.kind as string) === "convert_to_flat")).toBeUndefined();
  });

  it("uses P75-flat expense-cap defaults (audit-derived, not bucket-scaled)", async () => {
    expect(__TEST_CONSTANTS__.DEFAULT_EXPENSE_CAP_BY_BUCKET).toEqual({
      "$0–1K": 1700,
      "$1–5K": 1850,
      "$5–15K": 1750,
      "$15K+": 1650,
      "Uncapped %": 1750,
    });

    await seedShow({ showId: "s2", dealType: "vs", guaranteeAmount: 2500 });
    const out = await getDealImprovements("s2");
    const cap = out.improvements.find((i) => i.kind === "add_expense_cap");
    expect(cap).toBeDefined();
    expect(cap!.proposedNumber).toBe(1850); // $1–5K bucket

    await seedShow({ showId: "s3", dealType: "vs", guaranteeAmount: 8000 });
    const out2 = await getDealImprovements("s3");
    const cap2 = out2.improvements.find((i) => i.kind === "add_expense_cap");
    expect(cap2!.proposedNumber).toBe(1750); // $5–15K bucket
  });

  it("uses single $400 hospitality default for every bucket", async () => {
    expect(__TEST_CONSTANTS__.HOSPITALITY_CAP_DEFAULT).toBe(400);
    for (const [showId, g] of [["s4", 500], ["s5", 2500], ["s6", 8000], ["s7", 25000]] as const) {
      await seedShow({ showId, dealType: "vs", guaranteeAmount: g });
      const out = await getDealImprovements(showId);
      const hosp = out.improvements.find((i) => i.kind === "add_hospitality_cap");
      expect(hosp).toBeDefined();
      expect(hosp!.proposedNumber).toBe(400);
    }
  });

  it("skips expense-cap suggestion when deal already has one", async () => {
    await seedShow({
      showId: "s8", dealType: "vs", guaranteeAmount: 2500,
      expenseCap: 1500, hospitalityCap: 400,
    });
    const out = await getDealImprovements("s8");
    expect(out.improvements).toHaveLength(0);
  });

  it("skips both caps for flat deals (no expense/hospitality risk)", async () => {
    await seedShow({ showId: "s9", dealType: "flat", guaranteeAmount: 3000 });
    const out = await getDealImprovements("s9");
    expect(out.improvements).toHaveLength(0);
  });
});
