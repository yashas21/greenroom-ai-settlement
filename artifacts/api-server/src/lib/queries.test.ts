import { describe, expect, it } from "vitest";
import {
  classifySizeBucket,
  classifyAnalyticsSizeBucket,
} from "./queries";
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

describe("classifySizeBucket — original (shared with Smart Guaranteed Price)", () => {
  // Behavior preserved verbatim so SGP's bucket-keyed expense-estimate table
  // is not perturbed by the analytics-side audit fix.
  it("routes ANY zero-guarantee deal with a percentage to Uncapped %", () => {
    expect(classifySizeBucket(deal({ dealType: "percentage_of_gross", percentage: 70 }))).toBe("Uncapped %");
    expect(classifySizeBucket(deal({ dealType: "percentage_of_net", percentage: 80 }))).toBe("Uncapped %");
    expect(classifySizeBucket(deal({ dealType: "vs", percentage: 80 }))).toBe("Uncapped %");
    expect(classifySizeBucket(deal({ dealType: "door", percentage: 80 }))).toBe("Uncapped %");
  });

  it("routes zero-guarantee with no percentage to $0–1K", () => {
    expect(classifySizeBucket(deal({ dealType: "flat", percentage: null }))).toBe("$0–1K");
  });

  it("respects guarantee buckets", () => {
    expect(classifySizeBucket(deal({ guaranteeAmount: 500 }))).toBe("$0–1K");
    expect(classifySizeBucket(deal({ guaranteeAmount: 2500 }))).toBe("$1–5K");
    expect(classifySizeBucket(deal({ guaranteeAmount: 8000 }))).toBe("$5–15K");
    expect(classifySizeBucket(deal({ guaranteeAmount: 25000 }))).toBe("$15K+");
  });
});

describe("classifyAnalyticsSizeBucket — Uncapped % is reserved for percentage_of_gross (audit fix #8)", () => {
  it("routes percentage_of_gross with no guarantee to Uncapped %", () => {
    const d = deal({ dealType: "percentage_of_gross", guaranteeAmount: 0, percentage: 70 });
    expect(classifyAnalyticsSizeBucket(d)).toBe("Uncapped %");
  });

  it("routes percentage_of_net with no guarantee to $0–1K (NOT Uncapped %)", () => {
    const d = deal({ dealType: "percentage_of_net", guaranteeAmount: 0, percentage: 80 });
    expect(classifyAnalyticsSizeBucket(d)).toBe("$0–1K");
  });

  it("routes vs with no guarantee to $0–1K (NOT Uncapped %)", () => {
    const d = deal({ dealType: "vs", guaranteeAmount: 0, percentage: 80 });
    expect(classifyAnalyticsSizeBucket(d)).toBe("$0–1K");
  });

  it("routes door (no guarantee, has percentage) to $0–1K (NOT Uncapped %)", () => {
    const d = deal({ dealType: "door", guaranteeAmount: 0, percentage: 80 });
    expect(classifyAnalyticsSizeBucket(d)).toBe("$0–1K");
  });

  it("respects guarantee buckets regardless of dealType", () => {
    expect(classifyAnalyticsSizeBucket(deal({ guaranteeAmount: 500 }))).toBe("$0–1K");
    expect(classifyAnalyticsSizeBucket(deal({ guaranteeAmount: 2500 }))).toBe("$1–5K");
    expect(classifyAnalyticsSizeBucket(deal({ guaranteeAmount: 8000 }))).toBe("$5–15K");
    expect(classifyAnalyticsSizeBucket(deal({ guaranteeAmount: 25000 }))).toBe("$15K+");
  });

  it("matches the original classifier for all non-affected cases", () => {
    // Sanity: anywhere the bucket is determined by the guarantee, the two
    // classifiers must agree.
    for (const g of [500, 2500, 8000, 25000]) {
      for (const dt of ["vs", "door", "percentage_of_gross", "percentage_of_net", "flat"] as const) {
        const d = deal({ dealType: dt, guaranteeAmount: g });
        expect(classifyAnalyticsSizeBucket(d)).toBe(classifySizeBucket(d));
      }
    }
  });
});
