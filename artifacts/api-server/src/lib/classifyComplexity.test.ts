import { describe, expect, it } from "vitest";
import { classifyComplexity } from "./queries";
import type { deals } from "../db/schema";

type Deal = typeof deals.$inferSelect;

function deal(overrides: Partial<Deal>): Deal {
  return {
    id: "d1",
    showId: "s1",
    dealType: "flat",
    guaranteeAmount: 1000,
    percentage: null,
    percentageBasis: null,
    expenseCap: null,
    hospitalityCap: null,
    bonusesJson: null,
    dealNotesFreetext: null,
    createdAt: new Date(),
    ...overrides,
  } as Deal;
}

describe("classifyComplexity — structural read of deal shape", () => {
  describe("simple bucket (clean flats only)", () => {
    it("classifies a clean flat with no caps/bonuses as simple", () => {
      expect(classifyComplexity(deal({ dealType: "flat" }))).toBe("simple");
    });

    it("ignores deal-notes freetext (the seed-data noise that used to fire complex)", () => {
      // This is the regression test for the May 2026 fix: every seed deal has
      // a one-line descriptor like "Flat $2,332. No upside." and that string
      // must NOT make a flat deal complex.
      expect(
        classifyComplexity(
          deal({
            dealType: "flat",
            dealNotesFreetext: "Flat $2,332. No upside.",
          }),
        ),
      ).toBe("simple");
      expect(
        classifyComplexity(
          deal({
            dealType: "flat",
            dealNotesFreetext: "Tour routing fill, no expenses.",
          }),
        ),
      ).toBe("simple");
    });

    it("treats empty-bonus-JSON sentinels as no-bonuses", () => {
      expect(classifyComplexity(deal({ dealType: "flat", bonusesJson: "[]" }))).toBe("simple");
      expect(classifyComplexity(deal({ dealType: "flat", bonusesJson: "null" }))).toBe("simple");
    });
  });

  describe("medium bucket (% of gross or any cap)", () => {
    it("classifies a clean percentage_of_gross as medium", () => {
      expect(classifyComplexity(deal({ dealType: "percentage_of_gross", percentage: 70 }))).toBe(
        "medium",
      );
    });

    it("classifies a flat with an expense cap as medium", () => {
      expect(classifyComplexity(deal({ dealType: "flat", expenseCap: 1500 }))).toBe("medium");
    });

    it("classifies a flat with a hospitality cap as medium", () => {
      expect(classifyComplexity(deal({ dealType: "flat", hospitalityCap: 400 }))).toBe("medium");
    });

    it("classifies a flat with both caps as medium (no bonuses, no %)", () => {
      expect(
        classifyComplexity(deal({ dealType: "flat", expenseCap: 2000, hospitalityCap: 300 })),
      ).toBe("medium");
    });
  });

  describe("complex bucket (vs / door / pn / any bonuses)", () => {
    it("classifies vs as complex", () => {
      expect(classifyComplexity(deal({ dealType: "vs", percentage: 85 }))).toBe("complex");
    });

    it("classifies door as complex", () => {
      expect(classifyComplexity(deal({ dealType: "door", percentage: 80 }))).toBe("complex");
    });

    it("classifies percentage_of_net as complex", () => {
      expect(classifyComplexity(deal({ dealType: "percentage_of_net", percentage: 85 }))).toBe(
        "complex",
      );
    });

    it("classifies a flat with bonuses as complex (structural add-on)", () => {
      expect(
        classifyComplexity(
          deal({
            dealType: "flat",
            bonusesJson: '[{"type":"sellout","label":"+$500 on sellout","amount":500}]',
          }),
        ),
      ).toBe("complex");
    });

    it("escalates a percentage_of_gross with bonuses from medium to complex", () => {
      expect(
        classifyComplexity(
          deal({
            dealType: "percentage_of_gross",
            percentage: 80,
            bonusesJson: '[{"type":"sellout","amount":300}]',
          }),
        ),
      ).toBe("complex");
    });
  });

  describe("notes-only is no longer a complex signal (regression guard)", () => {
    // Every code path in classifyComplexity must produce its result without
    // reading d.dealNotesFreetext. If anyone re-adds a hasNotes branch,
    // these tests catch it immediately.
    it("vs deal stays complex regardless of notes content", () => {
      expect(classifyComplexity(deal({ dealType: "vs", dealNotesFreetext: "" }))).toBe("complex");
      expect(
        classifyComplexity(deal({ dealType: "vs", dealNotesFreetext: "lots of detail here" })),
      ).toBe("complex");
    });

    it("flat-with-cap stays medium regardless of notes content", () => {
      expect(
        classifyComplexity(
          deal({
            dealType: "flat",
            expenseCap: 1000,
            dealNotesFreetext: "Three-paragraph custom side agreement.",
          }),
        ),
      ).toBe("medium");
    });

    it("clean flat stays simple regardless of notes content", () => {
      expect(
        classifyComplexity(
          deal({
            dealType: "flat",
            dealNotesFreetext: "Three-paragraph custom side agreement.",
          }),
        ),
      ).toBe("simple");
    });
  });
});
