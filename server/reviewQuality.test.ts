import { describe, expect, it } from "vitest";
import { aggregateReviewQualityRows, buildReviewQualityDays, buildRiskSourceRanking, summarizeReviewQuality } from "./reviewQuality";

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

  it("ranks categories by the number of risky auto-matches", () => {
    expect(buildRiskSourceRanking([
      { category: "主機板", totalMatches: 40, riskMatches: 4 },
      { category: "顯示卡", totalMatches: 10, riskMatches: 5 },
    ])).toEqual([
      { category: "顯示卡", totalMatches: 10, riskMatches: 5, riskRate: 50 },
      { category: "主機板", totalMatches: 40, riskMatches: 4, riskRate: 10 },
    ]);
  });

  it("aggregates raw match rows without relying on database date grouping", () => {
    const report = aggregateReviewQualityRows([
      { createdAt: "2026-08-22T12:00:00.000Z", score: "0.95", hasSpecDiff: 0, category: "CPU" },
      { createdAt: "2026-08-22T13:00:00.000Z", score: "0.70", hasSpecDiff: 0, category: "CPU" },
      { createdAt: "2026-08-23T10:00:00.000Z", score: "0.98", hasSpecDiff: 1, category: "主機板" },
    ]);

    expect(report.days).toMatchObject([
      { date: "2026-08-22", totalMatches: 2, highConfidenceMatches: 1, lowConfidenceMatches: 1 },
      { date: "2026-08-23", totalMatches: 1, specDiffMatches: 1 },
    ]);
    expect(report.riskSources.map(source => [source.category, source.riskMatches])).toEqual([["主機板", 1], ["CPU", 1]]);
  });
});
