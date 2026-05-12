import { beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "file::memory:";

const { client, db } = await import("../db");
const schema = await import("../db/schema");
const { getAllShows, getDealAnalysis, classifySizeBucket } = await import("./queries");

const CREATE_TABLES_SQL = `
CREATE TABLE agencies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
CREATE TABLE agents (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, agency_id TEXT,
  email TEXT NOT NULL, phone TEXT, preferences_notes TEXT
);
CREATE TABLE artists (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, agent_id TEXT,
  manager_email TEXT, genre TEXT, prior_show_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE venues (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, capacity INTEGER NOT NULL,
  city TEXT NOT NULL, state TEXT NOT NULL
);
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
  signoff_text TEXT, notes TEXT
);
CREATE TABLE ticket_sales (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL,
  qty INTEGER NOT NULL, gross REAL NOT NULL, fees REAL NOT NULL,
  captured_at INTEGER NOT NULL
);
CREATE TABLE comps (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL, category TEXT NOT NULL,
  count INTEGER NOT NULL, face_value REAL NOT NULL,
  counts_toward_gross INTEGER NOT NULL DEFAULT 0, notes TEXT
);
CREATE TABLE expenses (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL, category TEXT NOT NULL,
  amount REAL NOT NULL, description TEXT,
  approved INTEGER NOT NULL DEFAULT 1, absorbed_by_venue INTEGER NOT NULL DEFAULT 0,
  entered_by_user_id TEXT, entered_at INTEGER NOT NULL
);
`;

const TABLES = [
  "ticket_sales", "comps", "expenses", "settlements", "deals",
  "shows", "artists", "agents", "agencies", "venues",
];

async function createTables() {
  for (const stmt of CREATE_TABLES_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await client.execute(stmt);
  }
}

async function dropTables() {
  for (const t of TABLES) await client.execute(`DROP TABLE IF EXISTS ${t}`);
}

const VENUE_ID = "v1";
const ARTIST_ID = "a1";

async function seedBaseline() {
  await db.insert(schema.venues).values({
    id: VENUE_ID, name: "Crescent", capacity: 650, city: "Nashville", state: "TN",
  });
  await db.insert(schema.artists).values({
    id: ARTIST_ID, name: "Test Artist", agentId: null, priorShowCount: 0,
  });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthsAgo(n: number, day = 15): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - n, day);
}

type DealOverrides = Partial<typeof schema.deals.$inferInsert>;
type SettlementOverrides = Partial<typeof schema.settlements.$inferInsert>;

let showCounter = 0;

async function addPastShow(opts: {
  monthsBack: number;
  deal: DealOverrides;
  settlement?: SettlementOverrides | null;
}): Promise<string> {
  showCounter += 1;
  const id = `s${showCounter}`;
  const date = monthsAgo(opts.monthsBack);
  await db.insert(schema.shows).values({
    id, venueId: VENUE_ID, artistId: ARTIST_ID, date: isoDate(date),
    status: "settled", roomConfig: "standing", createdAt: date,
  });
  await db.insert(schema.deals).values({
    id: `d-${id}`, showId: id, dealType: "flat", createdAt: date,
    ...opts.deal,
  });
  if (opts.settlement !== null) {
    await db.insert(schema.settlements).values({
      id: `st-${id}`, showId: id, status: "signed",
      ...(opts.settlement ?? {}),
    });
  }
  return id;
}

beforeAll(async () => {
  await dropTables();
  await createTables();
});

beforeEach(async () => {
  for (const t of TABLES) await client.execute(`DELETE FROM ${t}`);
  showCounter = 0;
  await seedBaseline();
});

describe("getDealAnalysis – classification", () => {
  it("buckets deals into simple / medium / complex", async () => {
    await addPastShow({
      monthsBack: 1,
      deal: { dealType: "flat", guaranteeAmount: 500 },
    });
    await addPastShow({
      monthsBack: 2,
      deal: {
        dealType: "percentage_of_gross", guaranteeAmount: 2000,
        percentage: 0.85, percentageBasis: "gross",
      },
    });
    await addPastShow({
      monthsBack: 3,
      deal: { dealType: "flat", guaranteeAmount: 3000, expenseCap: 1500 },
    });
    await addPastShow({
      monthsBack: 4,
      deal: { dealType: "vs", guaranteeAmount: 8000, percentage: 0.85 },
    });
    await addPastShow({
      monthsBack: 5,
      deal: {
        dealType: "flat", guaranteeAmount: 6000,
        bonusesJson: JSON.stringify([{ trigger: "sellout", amount: 500 }]),
      },
    });
    await addPastShow({
      monthsBack: 6,
      deal: { dealType: "flat", guaranteeAmount: 6000, dealNotesFreetext: "weird side deal" },
    });

    const result = await getDealAnalysis();
    const byKey = Object.fromEntries(result.byComplexity.map((b) => [b.bucket, b]));
    expect(byKey.simple.count).toBe(1);
    expect(byKey.medium.count).toBe(2);
    expect(byKey.complex.count).toBe(3);
    expect(result.totalDeals).toBe(6);

    // empty bonuses/whitespace notes should NOT be flagged complex.
    await addPastShow({
      monthsBack: 7,
      deal: {
        dealType: "flat", guaranteeAmount: 400,
        bonusesJson: "[]", dealNotesFreetext: "   ",
      },
    });
    const result2 = await getDealAnalysis();
    const byKey2 = Object.fromEntries(result2.byComplexity.map((b) => [b.bucket, b]));
    expect(byKey2.simple.count).toBe(2);
    expect(byKey2.complex.count).toBe(3);
  });

  it("buckets deals into all five size buckets including Uncapped %", async () => {
    await addPastShow({ monthsBack: 1, deal: { dealType: "flat", guaranteeAmount: 500 } });
    await addPastShow({ monthsBack: 1, deal: { dealType: "flat", guaranteeAmount: 2500 } });
    await addPastShow({ monthsBack: 1, deal: { dealType: "flat", guaranteeAmount: 8000 } });
    await addPastShow({ monthsBack: 1, deal: { dealType: "flat", guaranteeAmount: 25000 } });
    await addPastShow({
      monthsBack: 1,
      deal: {
        dealType: "percentage_of_gross", guaranteeAmount: 0,
        percentage: 0.9, percentageBasis: "gross",
      },
    });
    // zero-guarantee with no percentage falls into $0–1K
    await addPastShow({ monthsBack: 1, deal: { dealType: "flat", guaranteeAmount: 0 } });

    const r = await getDealAnalysis();
    const m = Object.fromEntries(r.bySize.map((b) => [b.bucket, b.count]));
    expect(m["$0–1K"]).toBe(2);
    expect(m["$1–5K"]).toBe(1);
    expect(m["$5–15K"]).toBe(1);
    expect(m["$15K+"]).toBe(1);
    expect(m["Uncapped %"]).toBe(1);
    expect(r.bySize.map((b) => b.bucket)).toEqual([
      "$0–1K", "$1–5K", "$5–15K", "$15K+", "Uncapped %",
    ]);
  });

  it("treats recoup-disputed settlements as disputed even when status != 'disputed'", async () => {
    // signed settlement, but a recoup line is disputed → dispute counted.
    await addPastShow({
      monthsBack: 1,
      deal: { dealType: "flat", guaranteeAmount: 2500 },
      settlement: {
        status: "signed", grossBoxOffice: 10000, totalToArtist: 5000,
        recoupsJson: JSON.stringify([
          { id: "r1", category: "marketing", label: "ads", amount: 200, status: "disputed" },
        ]),
      },
    });
    // signed settlement with only agreed recoups → not disputed.
    await addPastShow({
      monthsBack: 1,
      deal: { dealType: "flat", guaranteeAmount: 2500 },
      settlement: {
        status: "signed", grossBoxOffice: 9000, totalToArtist: 4500,
        recoupsJson: JSON.stringify([
          { id: "r2", category: "marketing", label: "ads", amount: 100, status: "agreed" },
        ]),
      },
    });
    // status: disputed (no recoups) → disputed.
    await addPastShow({
      monthsBack: 1,
      deal: { dealType: "flat", guaranteeAmount: 2500 },
      settlement: { status: "disputed", grossBoxOffice: 8000, totalToArtist: 4000 },
    });

    const r = await getDealAnalysis();
    const oneToFive = r.bySize.find((b) => b.bucket === "$1–5K")!;
    expect(oneToFive.count).toBe(3);
    // 2 of 3 settled rows are disputed.
    expect(oneToFive.disputeRate).toBeCloseTo(2 / 3, 6);
  });

  it("excludes settlements outside the trailing 24-month window from revenue", async () => {
    // Inside the window
    await addPastShow({
      monthsBack: 2,
      deal: { dealType: "flat", guaranteeAmount: 2500 },
      settlement: { status: "signed", grossBoxOffice: 10000, totalToArtist: 5000 },
    });
    // Outside the window (>= 24 months back)
    await addPastShow({
      monthsBack: 30,
      deal: { dealType: "flat", guaranteeAmount: 2500 },
      settlement: { status: "signed", grossBoxOffice: 99999, totalToArtist: 50000 },
    });

    const r = await getDealAnalysis();
    // Both deals counted in totals (no date filter on bySize/byComplexity)
    expect(r.totalDeals).toBe(2);
    // Revenue rollups only include the in-window settlement
    expect(r.revenue.months.length).toBe(24);
    const totalGross = r.revenue.months.reduce((s, m) => s + m.gross, 0);
    expect(totalGross).toBe(10000);
    expect(r.revenue.byDealType.flat?.gross).toBe(10000);
    expect(r.revenue.byDealType.flat?.count).toBe(1);
  });
});

describe("/shows badge ↔ /deal-analysis bySize disputed totals", () => {
  it("agree on dispute count for the same dataset", async () => {
    // Each settled show falls into a known bucket so we can derive
    // disputed-per-bucket from disputeRate × settledN.
    await addPastShow({
      monthsBack: 1,
      deal: { dealType: "flat", guaranteeAmount: 500 }, // $0–1K
      settlement: {
        status: "signed", grossBoxOffice: 5000, totalToArtist: 2500,
        recoupsJson: JSON.stringify([
          { id: "r1", category: "damages", label: "scuff", amount: 75, status: "disputed" },
        ]),
      },
    });
    await addPastShow({
      monthsBack: 2,
      deal: { dealType: "flat", guaranteeAmount: 8000 }, // $5–15K
      settlement: { status: "disputed", grossBoxOffice: 20000, totalToArtist: 10000 },
    });
    await addPastShow({
      monthsBack: 3,
      deal: { dealType: "flat", guaranteeAmount: 2500 }, // $1–5K
      settlement: {
        status: "signed", grossBoxOffice: 7000, totalToArtist: 3500,
        recoupsJson: JSON.stringify([
          { id: "r2", category: "marketing", label: "ads", amount: 50, status: "agreed" },
        ]),
      },
    });
    // Unsettled show should not affect dispute counts on either side.
    await addPastShow({
      monthsBack: 4,
      deal: { dealType: "flat", guaranteeAmount: 25000 }, // $15K+
      settlement: null,
    });

    // Frontend /shows badge: filter rows by isDisputed.
    const showsRows = await getAllShows();
    const showsDisputed = showsRows.filter((r) => r.isDisputed).length;

    // Backend /deal-analysis: for each bucket, recover disputed = round(rate × settledN).
    // settledN is the count of past deals in that bucket that have a settlement.
    const allDeals = await db.select().from(schema.deals);
    const settled = await db.select().from(schema.settlements);
    const settledShowIds = new Set(settled.map((s) => s.showId));
    const settledNByBucket = new Map<string, number>();
    for (const d of allDeals) {
      if (!settledShowIds.has(d.showId)) continue;
      const b = classifySizeBucket(d);
      settledNByBucket.set(b, (settledNByBucket.get(b) ?? 0) + 1);
    }

    const analysis = await getDealAnalysis();
    const analysisDisputed = analysis.bySize.reduce((sum, b) => {
      const settledN = settledNByBucket.get(b.bucket) ?? 0;
      return sum + Math.round(b.disputeRate * settledN);
    }, 0);

    expect(showsDisputed).toBe(2);
    expect(analysisDisputed).toBe(showsDisputed);
  });
});
