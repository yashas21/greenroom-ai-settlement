/**
 * Idempotent seed for Smart Switch demo data.
 *
 * Creates a clean set of upcoming shows that demonstrate both Smart Switch
 * shapes (flat replacement + door hybrid) across multiple confidence tiers,
 * plus the small history needed to make tier A reachable for "familiar"
 * artists.
 *
 * Run with:  pnpm --filter @workspace/api-server exec tsx scripts/seedSmartSwitchDemo.ts
 *
 * Safe to re-run: every insert is gated on existence by primary key.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, migrationsReady } from "../src/db";
import {
  artists, shows, deals, settlements, switchSuggestions,
} from "../src/db/schema";

const VENUE_ID = "venue_crescent";

// 5 demo artists: 2 familiar (3 prior shows each → tier A reachable),
// 3 first-timers (capped at tier B per computeTier demote rule).
const DEMO_ARTISTS = [
  { id: "artist_demo_marble_index",     name: "Marble Index",     familiar: false },
  { id: "artist_demo_north_frontier",   name: "North Frontier",   familiar: true  },
  { id: "artist_demo_vespertine_choir", name: "Vespertine Choir", familiar: false },
  { id: "artist_demo_quartz_lantern",   name: "Quartz Lantern",   familiar: true  },
  { id: "artist_demo_drowsy_beacon",    name: "Drowsy Beacon",    familiar: false },
] as const;

// 5 upcoming deals: 2 vs ($1–5K → flat switch), 1 % of net (uncapped, not
// eligible — included to demonstrate the "not eligible" path), 2 door (door
// hybrid switch). The % of net deal is intentionally outside the $1–5K band
// so that switchAppliesTo() returns false and no suggestion is generated.
const UPCOMING = [
  { showId: "show_demo_marble_index",     artistId: "artist_demo_marble_index",     date: daysFromToday(5),  dealType: "vs",                guarantee: 1500, percentage: 0.85, basis: "gross" },
  { showId: "show_demo_north_frontier",   artistId: "artist_demo_north_frontier",   date: daysFromToday(8),  dealType: "vs",                guarantee: 4000, percentage: 0.85, basis: "gross" },
  { showId: "show_demo_vespertine_choir", artistId: "artist_demo_vespertine_choir", date: daysFromToday(13), dealType: "percentage_of_net", guarantee: null, percentage: 0.85, basis: "net"   },
  { showId: "show_demo_quartz_lantern",   artistId: "artist_demo_quartz_lantern",   date: daysFromToday(17), dealType: "door",              guarantee: null, percentage: null, basis: null    },
  { showId: "show_demo_drowsy_beacon",    artistId: "artist_demo_drowsy_beacon",    date: daysFromToday(23), dealType: "door",              guarantee: null, percentage: null, basis: null    },
] as const;

// History rows used to give the two "familiar" artists 3 prior closed shows
// each at the venue. Each prior show is a clean settled flat — just enough to
// satisfy `artistShowsAtVenue >= 2` so the tier ceiling stays at A.
const HIST_OFFSETS_DAYS = [-100, -150, -200];

function daysFromToday(offset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function ensureArtist(id: string, name: string): Promise<void> {
  const [existing] = await db.select().from(artists).where(eq(artists.id, id));
  if (existing) return;
  await db.insert(artists).values({ id, name, genre: "indie", priorShowCount: 0 });
}

async function ensureShow(
  showId: string, artistId: string, date: string,
  status: "booked" | "settled" = "booked",
): Promise<void> {
  const [existing] = await db.select().from(shows).where(eq(shows.id, showId));
  if (existing) return;
  await db.insert(shows).values({
    id: showId, venueId: VENUE_ID, artistId, date, status,
    roomConfig: "standing", createdAt: new Date(),
  });
}

async function ensureDeal(
  showId: string,
  dealType: "vs" | "percentage_of_net" | "door" | "flat",
  guarantee: number | null,
  percentage: number | null,
  basis: "gross" | "net" | null,
): Promise<void> {
  const [existing] = await db.select().from(deals).where(eq(deals.showId, showId));
  if (existing) return;
  await db.insert(deals).values({
    id: `deal_${showId}`, showId, dealType,
    guaranteeAmount: guarantee, percentage, percentageBasis: basis,
    createdAt: new Date(),
  });
}

async function ensureSettlement(showId: string, gross: number, payout: number): Promise<void> {
  const [existing] = await db.select().from(settlements).where(eq(settlements.showId, showId));
  if (existing) return;
  await db.insert(settlements).values({
    id: `set_${showId}`, showId, status: "paid",
    grossBoxOffice: gross, totalToArtist: payout,
    netBoxOffice: gross - payout, totalExpenses: 0,
    paidAt: new Date(),
  });
}

async function ensureSwitchSuggestion(args: {
  showId: string;
  shape: "flat" | "door_hybrid";
  tier: "A" | "B" | "C" | "D";
  status: "suggested" | "accepted";
  flat?: number;
  doorFloor?: number; doorSplit?: number; doorCap?: number;
  basis: string;
  artistShowsAtVenue: number;
}): Promise<void> {
  const [existing] = await db.select().from(switchSuggestions).where(eq(switchSuggestions.showId, args.showId));
  if (existing) return;
  const [dealRow] = await db.select().from(deals).where(eq(deals.showId, args.showId));
  if (!dealRow) return;
  await db.insert(switchSuggestions).values({
    id: randomUUID(), showId: args.showId, dealId: dealRow.id,
    suggestedAt: new Date(),
    dealTypeFrom: dealRow.dealType,
    shape: args.shape,
    suggestedFlat: args.flat ?? null,
    doorFloor: args.doorFloor ?? null,
    doorSplitPct: args.doorSplit ?? null,
    doorExpenseCap: args.doorCap ?? null,
    confidenceTier: args.tier,
    bandLow: args.shape === "flat" ? Math.round((args.flat ?? 0) * 0.8) : args.doorFloor ?? null,
    bandHigh: args.shape === "flat" ? Math.round((args.flat ?? 0) * 1.2) : Math.round((args.doorFloor ?? 0) + (args.doorSplit ?? 0) * 4000),
    sampleSize: 12,
    basis: args.basis,
    status: args.status,
    decidedAt: args.status === "accepted" ? new Date() : null,
    artistShowsAtVenue: args.artistShowsAtVenue,
  });
}

async function main(): Promise<void> {
  await migrationsReady;

  for (const a of DEMO_ARTISTS) await ensureArtist(a.id, a.name);

  // History rows for "familiar" artists — 3 prior settled shows at the venue.
  for (const a of DEMO_ARTISTS.filter((x) => x.familiar)) {
    for (let i = 0; i < HIST_OFFSETS_DAYS.length; i++) {
      const showId = `show_demohist_${a.id.replace("artist_demo_", "")}_${i}`;
      await ensureShow(showId, a.id, daysFromToday(HIST_OFFSETS_DAYS[i]), "settled");
      await ensureDeal(showId, "flat", 800, null, null);
      await ensureSettlement(showId, 4000, 800);
    }
  }

  // Upcoming deals.
  for (const u of UPCOMING) {
    await ensureShow(u.showId, u.artistId, u.date, "booked");
    await ensureDeal(u.showId, u.dealType, u.guarantee, u.percentage, u.basis);
  }

  // Pre-baked suggestions: 2 pre-accepted (one per shape) so /shows?switched=1
  // has clean examples; the other 2 stay as "suggested" so the worklist filter
  // also has examples. Vespertine Choir intentionally has no suggestion (the
  // % of net deal is in the "Uncapped %" bucket, where switchAppliesTo()
  // returns false).
  await ensureSwitchSuggestion({
    showId: "show_demo_marble_index", shape: "flat", tier: "B", status: "accepted", flat: 4950,
    basis: "First-timer at the venue (tier capped at B). Comparable vs deals in the $1–5K bucket settled at $4,950 on average across 12 prior shows.",
    artistShowsAtVenue: 0,
  });
  await ensureSwitchSuggestion({
    showId: "show_demo_north_frontier", shape: "flat", tier: "A", status: "suggested", flat: 4950,
    basis: "3 prior shows at the venue keep the tier ceiling at A. Comparable vs deals in the $1–5K bucket averaged $4,950 to artist.",
    artistShowsAtVenue: 3,
  });
  await ensureSwitchSuggestion({
    showId: "show_demo_quartz_lantern", shape: "door_hybrid", tier: "A", status: "accepted",
    doorFloor: 500, doorSplit: 0.6, doorCap: 800,
    basis: "Pure door deals lose money for the venue 93% of the time. Hybrid: $500 floor + 60% above an $800 expense cap. 3 prior shows → tier A.",
    artistShowsAtVenue: 3,
  });
  await ensureSwitchSuggestion({
    showId: "show_demo_drowsy_beacon", shape: "door_hybrid", tier: "B", status: "suggested",
    doorFloor: 500, doorSplit: 0.6, doorCap: 800,
    basis: "First-time at the venue (tier capped at B). Hybrid replaces pure door with a $500 floor + 60% above an $800 expense cap.",
    artistShowsAtVenue: 0,
  });

  console.log("seedSmartSwitchDemo: complete (idempotent).");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
