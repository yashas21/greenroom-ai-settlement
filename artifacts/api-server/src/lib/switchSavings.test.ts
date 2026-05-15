import { beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "file::memory:";

const { client, db } = await import("../db");
const schema = await import("../db/schema");
const { getSwitchSavings } = await import("./switchSavings");
const { clearSmartSwitchCache } = await import("./smartSwitch");
const { clearGuaranteeCache } = await import("./smartGuarantee");

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
  signoff_text TEXT, notes TEXT,
  positive_summary TEXT, negative_summary TEXT
);
CREATE TABLE expenses (
  id TEXT PRIMARY KEY NOT NULL, show_id TEXT NOT NULL, category TEXT NOT NULL,
  amount REAL NOT NULL, description TEXT,
  approved INTEGER NOT NULL DEFAULT 1, absorbed_by_venue INTEGER NOT NULL DEFAULT 0,
  entered_by_user_id TEXT, entered_at INTEGER NOT NULL
);
CREATE TABLE switch_suggestions (
  id TEXT PRIMARY KEY, show_id TEXT NOT NULL UNIQUE, deal_id TEXT NOT NULL,
  generated_at INTEGER NOT NULL, deal_type_from TEXT NOT NULL, shape TEXT NOT NULL,
  suggested_flat REAL, door_floor REAL, door_split_pct REAL, door_expense_cap REAL,
  confidence_tier TEXT NOT NULL, band_low REAL, band_high REAL, band_width REAL,
  source TEXT, sample_size INTEGER NOT NULL, basis TEXT NOT NULL
);
CREATE TABLE guarantee_suggestions (
  id TEXT PRIMARY KEY, show_id TEXT NOT NULL UNIQUE, deal_id TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  agent_guarantee REAL, suggested_price REAL NOT NULL, delta REAL NOT NULL,
  expected_gross REAL NOT NULL, expected_gross_source TEXT NOT NULL,
  ticketing_fees REAL NOT NULL, net_after_fees REAL NOT NULL,
  expense_estimate REAL NOT NULL, expense_source TEXT NOT NULL, expense_cap REAL,
  net_base REAL NOT NULL, percentage_payout REAL NOT NULL,
  winner TEXT NOT NULL, winner_margin REAL NOT NULL, breakeven_gross REAL NOT NULL,
  artist_show_count INTEGER NOT NULL, agent_show_count INTEGER NOT NULL,
  confidence_tier TEXT NOT NULL, insurance_tier INTEGER NOT NULL,
  basis TEXT NOT NULL, audit_json TEXT NOT NULL
);
`;

const TABLES = [
  "switch_suggestions", "guarantee_suggestions", "expenses", "settlements",
  "deals", "shows", "artists", "agents", "agencies", "venues",
];

const VENUE_ID = "v1";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

let counter = 0;

async function seedShow(opts: {
  daysBack: number;
  artistId: string;
  dealType: "vs" | "percentage_of_net" | "door" | "flat";
  guarantee?: number | null;
  percentage?: number | null;
  payout: number;
  gross: number;
  expense?: number;
  status?: string;
  recoupsJson?: string | null;
  notes?: string | null;
  signoffText?: string | null;
}): Promise<string> {
  counter++;
  const showId = `s${counter}`;
  await db.insert(schema.shows).values({
    id: showId, venueId: VENUE_ID, artistId: opts.artistId,
    date: isoDate(daysFromNow(-opts.daysBack)),
    status: "settled", roomConfig: "standing", createdAt: new Date(),
  });
  await db.insert(schema.deals).values({
    id: `d${counter}`, showId, dealType: opts.dealType,
    guaranteeAmount: opts.guarantee ?? null,
    percentage: opts.percentage ?? null,
    createdAt: new Date(),
  });
  await db.insert(schema.settlements).values({
    id: `set${counter}`, showId,
    status: (opts.status ?? "signed") as typeof schema.settlements.$inferInsert["status"],
    grossBoxOffice: opts.gross, totalToArtist: opts.payout,
    totalExpenses: opts.expense ?? 0,
    recoupsJson: opts.recoupsJson ?? null,
    notes: opts.notes ?? null,
    signoffText: opts.signoffText ?? null,
  });
  if ((opts.expense ?? 0) > 0) {
    await db.insert(schema.expenses).values({
      id: `e${counter}`, showId, category: "production",
      amount: opts.expense!, approved: true, absorbedByVenue: false,
      enteredAt: new Date(),
    });
  }
  return showId;
}

async function seedArtist(id: string) {
  await db.insert(schema.artists).values({ id, name: id });
}

async function seedVenue() {
  await db.insert(schema.venues).values({
    id: VENUE_ID, name: "The Greenroom", capacity: 500,
    city: "Austin", state: "TX",
  });
}

beforeEach(async () => {
  for (const t of TABLES) await client.execute(`DROP TABLE IF EXISTS ${t}`);
  for (const stmt of CREATE_TABLES_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await client.execute(stmt);
  }
  clearSmartSwitchCache();
  clearGuaranteeCache();
  counter = 0;
  await seedVenue();
});

describe("getSwitchSavings", () => {
  it("returns a flat counterfactual for vs $1–5K and money delta = actual − suggested flat", async () => {
    await seedArtist("a1");
    // Single past vs deal, guarantee $2000, paid $3500. SGP will likely fall
    // through (no comparable history seeded), so fallback uses the contract
    // guarantee → flat = $2000. Money saved = 3500 − 2000 = 1500.
    await seedShow({
      daysBack: 30, artistId: "a1",
      dealType: "vs", guarantee: 2000, percentage: 80,
      payout: 3500, gross: 10000, expense: 1000,
    });

    const out = await getSwitchSavings({ months: 6, topN: 10 });

    expect(out.items).toHaveLength(1);
    const it0 = out.items[0];
    expect(it0.dealType).toBe("vs");
    expect(it0.switchShape).toBe("flat");
    expect(it0.actualToArtist).toBe(3500);
    expect(it0.counterfactualToArtist).toBe(2000);
    expect(it0.moneySavedToVenue).toBe(1500);
    expect(it0.breakdown.counterfactual.flat).toBe(2000);
    expect(out.totalCandidates).toBe(1);
    expect(out.totalMoneySavedToVenue).toBe(1500);
  });

  it("door deals route through the door_hybrid counterfactual and report self-consistent money delta", async () => {
    await seedArtist("a2");
    await seedShow({
      daysBack: 20, artistId: "a2",
      dealType: "door", guarantee: 1500,
      payout: 9000, gross: 20000, expense: 1200,
    });

    const out = await getSwitchSavings({ months: 6, topN: 10 });

    expect(out.items).toHaveLength(1);
    const it0 = out.items[0];
    expect(it0.switchShape).toBe("door_hybrid");
    expect(it0.breakdown.counterfactual.shape).toBe("door_hybrid");
    // Re-derive what the savings module computed using the SAME formula it
    // applied internally and assert internal consistency. Whether the
    // generator returned a normal hybrid, a dead-pool degenerate floor, or a
    // suppressed talk-to-agent shape, the money delta must always match
    // (actual − projected) using floor + split·max(0, 0.9·gross − cap).
    const cap = it0.breakdown.counterfactual.doorExpenseCap ?? 1500;
    const floor = it0.breakdown.counterfactual.doorFloor ?? 0;
    const split = it0.breakdown.counterfactual.doorSplitPct ?? 0;
    const expectedProjected = Math.round(
      floor + split * Math.max(0, it0.grossBoxOffice * 0.9 - cap),
    );
    expect(it0.counterfactualToArtist).toBe(expectedProjected);
    expect(it0.moneySavedToVenue).toBe(it0.actualToArtist - expectedProjected);
  });

  it("time heuristic adds disputed-status bonus and paragraph minutes; switch handshake is much shorter", async () => {
    await seedArtist("a3");
    await seedShow({
      daysBack: 10, artistId: "a3",
      dealType: "vs", guarantee: 2000, percentage: 80,
      payout: 3000, gross: 8000, expense: 500,
      status: "disputed",
      // Two paragraphs in notes, one in sign-off → 3 paragraphs total.
      notes: "First paragraph of disagreement.\n\nSecond paragraph still in dispute.",
      signoffText: "We never signed.",
      recoupsJson: JSON.stringify([
        { label: "Sound", amount: 400, status: "disputed" },
        { label: "Hospitality", amount: 200, status: "approved" },
      ]),
    });

    const out = await getSwitchSavings({ months: 6, topN: 10 });
    const it0 = out.items[0];

    // base 30 + 1 disputed recoup × 25 + 3 paragraphs × 5 + 60 dispute bonus
    // = 30 + 25 + 15 + 60 = 130
    expect(it0.estimatedMinutesSpent).toBe(130);
    // Smart Switch flat handshake = 10 min
    expect(it0.estimatedMinutesUnderSwitch).toBe(10);
    expect(it0.minutesSaved).toBe(120);
    expect(it0.hadDispute).toBe(true);
    expect(it0.disputedRecoupCount).toBe(1);
    expect(it0.notesParagraphs).toBe(2);
    expect(it0.signoffParagraphs).toBe(1);
    expect(it0.totalRecoups).toBe(2);
  });

  it("supports negative money savings (counterfactual flat > actual payout) without flipping sign", async () => {
    await seedArtist("a4");
    // vs $1–5K with high guarantee $4500 but the actual payout was only
    // $3000 (artist underperformed at the door). Switching to a flat would
    // have OVERPAID by $1500 → moneySavedToVenue = -1500.
    await seedShow({
      daysBack: 15, artistId: "a4",
      dealType: "vs", guarantee: 4500, percentage: 85,
      payout: 3000, gross: 7000, expense: 800,
    });

    const out = await getSwitchSavings({ months: 6, topN: 10 });
    const it0 = out.items[0];
    expect(it0.counterfactualToArtist).toBe(4500);
    expect(it0.moneySavedToVenue).toBe(-1500);
  });

  it("sorts by money saved desc and trims items to topN; totals roll up the full candidate set", async () => {
    // Three vs deals, descending savings of 1500, 1000, 500.
    await seedArtist("a5");
    await seedArtist("a6");
    await seedArtist("a7");
    await seedShow({
      daysBack: 30, artistId: "a5",
      dealType: "vs", guarantee: 2000, percentage: 80,
      payout: 2500, gross: 5000,
    }); // saves 500
    await seedShow({
      daysBack: 25, artistId: "a6",
      dealType: "vs", guarantee: 2000, percentage: 80,
      payout: 3500, gross: 9000,
    }); // saves 1500
    await seedShow({
      daysBack: 20, artistId: "a7",
      dealType: "vs", guarantee: 2000, percentage: 80,
      payout: 3000, gross: 7000,
    }); // saves 1000

    const out = await getSwitchSavings({ months: 6, topN: 2 });

    expect(out.totalCandidates).toBe(3);
    expect(out.items).toHaveLength(2);
    expect(out.items.map((i) => i.moneySavedToVenue)).toEqual([1500, 1000]);
    // Totals roll up the FULL candidate set (1500 + 1000 + 500 = 3000), not
    // just the displayed top-N slice. Keeping totals and totalCandidates on
    // the same scope prevents callers from mixing top-N numerators with
    // full-set denominators.
    expect(out.totalMoneySavedToVenue).toBe(3000);
  });

  it("excludes deal types Smart Switch does not cover (flat) and unsettled rows", async () => {
    await seedArtist("a8");
    await seedArtist("a9");
    // Flat deal — never eligible for Smart Switch.
    await seedShow({
      daysBack: 10, artistId: "a8",
      dealType: "flat", guarantee: 3000,
      payout: 3000, gross: 6000,
    });
    // vs deal but draft status — not in SETTLED_STATUSES.
    await seedShow({
      daysBack: 10, artistId: "a9",
      dealType: "vs", guarantee: 2000, percentage: 80,
      payout: 3500, gross: 9000,
      status: "draft",
    });

    const out = await getSwitchSavings({ months: 6, topN: 10 });
    expect(out.items).toHaveLength(0);
    expect(out.totalCandidates).toBe(0);
  });
});
