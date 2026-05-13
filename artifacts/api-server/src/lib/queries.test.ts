import { describe, expect, it } from "vitest";
import { classifySizeBucket } from "./queries";
import type { deals } from "../db/schema";

type Deal = typeof deals.$inferSelect;

function deal(overrides: Partial<Deal>): Deal {
  return {
    id: "d1", showId: "s1", dealType: "vs",
    guaranteeAmount: 0, percentage: null, percentageBasis: null,
    expenseCap: null, hospitalityCap: null, bonusesJson: null,
    dealNotesFreetext: null, createdAt: new Date(),
    ...overrides,
  } as Deal;
}

describe("classifySizeBucket — Uncapped % is reserved for percentage_of_gross", () => {
  it("routes percentage_of_gross with no guarantee to Uncapped %", () => {
    const d = deal({ dealType: "percentage_of_gross", guaranteeAmount: 0, percentage: 70 });
    expect(classifySizeBucket(d)).toBe("Uncapped %");
  });

  it("routes percentage_of_net with no guarantee to $0–1K (NOT Uncapped %)", () => {
    const d = deal({ dealType: "percentage_of_net", guaranteeAmount: 0, percentage: 80 });
    expect(classifySizeBucket(d)).toBe("$0–1K");
  });

  it("routes vs with no guarantee to $0–1K (NOT Uncapped %)", () => {
    const d = deal({ dealType: "vs", guaranteeAmount: 0, percentage: 80 });
    expect(classifySizeBucket(d)).toBe("$0–1K");
  });

  it("routes door (no guarantee, has percentage) to $0–1K (NOT Uncapped %)", () => {
    const d = deal({ dealType: "door", guaranteeAmount: 0, percentage: 80 });
    expect(classifySizeBucket(d)).toBe("$0–1K");
  });

  it("respects guarantee buckets regardless of dealType", () => {
    expect(classifySizeBucket(deal({ guaranteeAmount: 500 }))).toBe("$0–1K");
    expect(classifySizeBucket(deal({ guaranteeAmount: 2500 }))).toBe("$1–5K");
    expect(classifySizeBucket(deal({ guaranteeAmount: 8000 }))).toBe("$5–15K");
    expect(classifySizeBucket(deal({ guaranteeAmount: 25000 }))).toBe("$15K+");
  });
});
