import { describe, expect, it } from "vitest";
import { getWeeklyMatchQualityReport } from "./db";

const databaseIt = process.env.DATABASE_URL ? it : it.skip;

describe("週品質報表資料庫整合", () => {
  databaseIt("reads recent match rows and produces a report without database DATE/GROUP BY aggregation", async () => {
    const report = await getWeeklyMatchQualityReport();

    expect(report).toMatchObject({
      startDate: expect.any(String),
      endDate: expect.any(String),
      summary: expect.objectContaining({ totalMatches: expect.any(Number), autoQualityRate: expect.any(Number) }),
    });
    expect(Array.isArray(report.days)).toBe(true);
    expect(Array.isArray(report.riskSources)).toBe(true);
  }, 15_000);
});
