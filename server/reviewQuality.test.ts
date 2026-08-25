import { describe, expect, it } from "vitest";
import { buildReviewQualityDays, summarizeReviewQuality } from "./reviewQuality";

describe("七日配對品質報表", () => {
  it("computes the auto-quality indicator from high-confidence, no-spec-difference matches", () => {
    const days = buildReviewQualityDays([
      { date: "2026-08-18", totalMatches: "100", highConfidenceMatches: "82", lowConfidenceMatches: "12", specDiffMatches: "6" },
      { date: "2026-08-19", totalMatches: 50, highConfidenceMatches: 45, lowConfidenceMatches: 3, specDiffMatches: 2 },
    ]);

    expect(days[0]).toMatchObject({ autoQualityRate: 82, totalMatches: 100 });
    expect(summarizeReviewQuality(days)).toEqual({ totalMatches: 150, highConfidenceMatches: 127, lowConfidenceMatches: 15, specDiffMatches: 8, autoQualityRate: 84.7 });
  });

  it("does not divide by zero when a weekly day has no matches", () => {
    expect(buildReviewQualityDays([{ date: "2026-08-20", totalMatches: 0, highConfidenceMatches: 0, lowConfidenceMatches: 0, specDiffMatches: 0 }])[0]?.autoQualityRate).toBe(0);
  });
});
