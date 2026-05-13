import { describe, expect, it, beforeEach } from "vitest";

process.env.DATABASE_URL = "file::memory:";

const { client, db } = await import("../db");
const schema = await import("../db/schema");
const { generateSuggestion, clearSmartSwitchCache } = await import("./smartSwitch");

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
    const tableName = stmt.match(/CREATE TABLE (\w+)/)![1];
    try { await client.execute(`DROP TABLE IF EXISTS ${tableName}`); } catch { /* */ }
    await client.execute(stmt);
  }
  clearSmartSwitchCache();
});

async function seedPastVsDeals(count: number, payout: number, gross: number, expense: number) {
  for (let i = 0; i < count; i++) {
    const showId = `past-${i}`;
    await db.insert(schema.shows).values({
      id: showId, venueId: "v1", artistId: `art-${i}`,
      date: "2025-01-15", status: "settled", roomConfig: "standing",
      createdAt: new Date(),
    });
    await db.insert(schema.deals).values({
      id: `d-${showId}`, showId, dealType: "vs",
      guaranteeAmount: 1500, percentage: 80, createdAt: new Date(),
    });
    await db.insert(schema.settlements).values({
      id: `set-${showId}`, showId, status: "signed",
      grossBoxOffice: gross, totalToArtist: payout,
    });
    if (expense > 0) {
      await db.insert(schema.expenses).values({
        id: `e-${showId}`, showId, category: "production",
        amount: expense, approved: true, absorbedByVenue: false,
        enteredAt: new Date(),
      });
    }
  }
}

describe("smartSwitch — audit fixes", () => {
  it("vs/$1–5K returns source=guarantee_amount and matches deal.guaranteeAmount", async () => {
    // Seed enough comparable history that the cell exists, but the suggestion
    // should still come from the contract guarantee (audit's key finding).
    await seedPastVsDeals(5, 1466, 4000, 1500);
    clearSmartSwitchCache();

    const dealGuarantee = 2200;
    const sug = await generateSuggestion(
      {
        id: "d-target", showId: "s-target", dealType: "vs",
        guaranteeAmount: dealGuarantee, percentage: 80, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
      // no showId → skip SGP path, force guarantee/cell-mean fallback
    );
    expect(sug).not.toBeNull();
    expect(sug!.shape).toBe("flat");
    expect(sug!.source).toBe("guarantee_amount");
    expect(sug!.suggestedFlat).toBe(dealGuarantee);
  });

  it("guarantee_amount source preserves non-$50-aligned values exactly", async () => {
    // Audit acceptance: anchored to the contract number, no rounding.
    await seedPastVsDeals(3, 2000, 5000, 1500);
    clearSmartSwitchCache();

    const oddGuarantee = 2237; // not a multiple of 50
    const sug = await generateSuggestion(
      {
        id: "d-odd", showId: "s-odd", dealType: "vs",
        guaranteeAmount: oddGuarantee, percentage: 80, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
    );
    expect(sug!.source).toBe("guarantee_amount");
    expect(sug!.suggestedFlat).toBe(2237);
  });

  it("door at $15K+ returns source=suppressed (not enough history)", async () => {
    const sug = await generateSuggestion(
      {
        id: "d-big", showId: "s-big", dealType: "door",
        guaranteeAmount: 18000, percentage: null, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
    );
    expect(sug).not.toBeNull();
    expect(sug!.shape).toBe("door_hybrid");
    expect(sug!.source).toBe("suppressed");
    expect(sug!.confidenceTier).toBe("D");
    expect(sug!.doorSplitPct).toBeNull();
    expect(sug!.basis).toMatch(/discuss the structure directly|not enough history/i);
  });

  it("door dead-pool branch fires when projected avail ≤ floor", async () => {
    // Seed door history where avgGross is so low that 0.9*gross - cap < $500 floor.
    // gross=1000 → 0.9*1000 - 1500 = -600 → dead pool.
    for (let i = 0; i < 4; i++) {
      const showId = `door-${i}`;
      await db.insert(schema.shows).values({
        id: showId, venueId: "v1", artistId: `art-${i}`,
        date: "2025-02-15", status: "settled", roomConfig: "standing",
        createdAt: new Date(),
      });
      await db.insert(schema.deals).values({
        id: `d-${showId}`, showId, dealType: "door",
        guaranteeAmount: 0, percentage: 80, createdAt: new Date(),
      });
      await db.insert(schema.settlements).values({
        id: `set-${showId}`, showId, status: "signed",
        grossBoxOffice: 1000, totalToArtist: 500,
      });
      await db.insert(schema.expenses).values({
        id: `e-${showId}`, showId, category: "production",
        amount: 1500, approved: true, absorbedByVenue: false,
        enteredAt: new Date(),
      });
    }
    clearSmartSwitchCache();

    const sug = await generateSuggestion(
      {
        id: "d-deadpool", showId: "s-deadpool", dealType: "door",
        guaranteeAmount: 0, percentage: 80, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
    );
    expect(sug).not.toBeNull();
    expect(sug!.source).toBe("door_dead_pool");
    expect(sug!.bandLow).toBe(500);
    expect(sug!.bandHigh).toBe(500);
  });

  it("door hybrid normal projection still fires when pool > floor", async () => {
    // gross=8000 → 0.9*8000 - 1500 = 5700 ≥ 500 floor → normal hybrid path.
    for (let i = 0; i < 4; i++) {
      const showId = `door-${i}`;
      await db.insert(schema.shows).values({
        id: showId, venueId: "v1", artistId: `art-${i}`,
        date: "2025-02-15", status: "settled", roomConfig: "standing",
        createdAt: new Date(),
      });
      await db.insert(schema.deals).values({
        id: `d-${showId}`, showId, dealType: "door",
        guaranteeAmount: 0, percentage: 80, createdAt: new Date(),
      });
      await db.insert(schema.settlements).values({
        id: `set-${showId}`, showId, status: "signed",
        grossBoxOffice: 8000, totalToArtist: 4000,
      });
      await db.insert(schema.expenses).values({
        id: `e-${showId}`, showId, category: "production",
        amount: 1500, approved: true, absorbedByVenue: false,
        enteredAt: new Date(),
      });
    }
    clearSmartSwitchCache();

    const sug = await generateSuggestion(
      {
        id: "d-normal", showId: "s-normal", dealType: "door",
        guaranteeAmount: 0, percentage: 80, percentageBasis: null,
        expenseCap: null, hospitalityCap: null, bonusesJson: null,
        dealNotesFreetext: null, createdAt: new Date(),
      },
      0,
    );
    expect(sug).not.toBeNull();
    expect(sug!.source).toBe("door_hybrid_calc");
    expect(sug!.doorFloor).toBe(500);
    expect(sug!.doorSplitPct).toBeCloseTo(0.6);
  });
});
