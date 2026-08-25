import { describe, expect, it } from "vitest";
import { buildWeeklyQualityCsvRows } from "./reviewQualityCsv";

describe("每週配對品質 CSV", () => {
  it("includes the quality-proxy explanation, summary, and daily rows", () => {
    const rows = buildWeeklyQualityCsvRows({
      startDate: "2026-08-19", endDate: "2026-08-25",
      summary: { totalMatches: 10, highConfidenceMatches: 8, lowConfidenceMatches: 1, specDiffMatches: 1, autoQualityRate: 80 },
      days: [{ date: "2026-08-19", totalMatches: 10, highConfidenceMatches: 8, lowConfidenceMatches: 1, specDiffMatches: 1, autoQualityRate: 80 }],
      riskSources: [{ category: "顯示卡", totalMatches: 10, riskMatches: 2, riskRate: 20 }],
    });

    expect(rows[1]?.[1]).toContain("非人工驗證準確率");
    expect(rows).toContainEqual(["2026-08-19", 10, 8, 1, 1, "80%"]);
    expect(rows.at(-1)).toEqual(["顯示卡", 10, 2, "20%"]);
  });
});
