import { describe, expect, it } from "vitest";
import { measureReviewHealthCheck, summarizeReviewHealth } from "./reviewHealth";

describe("審核 API 健康摘要", () => {
  it("returns healthy when every dependency probe succeeds", async () => {
    const check = await measureReviewHealthCheck("weekly", "週品質報表", async () => undefined);
    expect(summarizeReviewHealth([check])).toMatchObject({ status: "healthy", checks: [{ id: "weekly", status: "healthy", message: null }] });
  });

  it("reports a degraded probe without preventing the remaining dashboard data from rendering", async () => {
    const check = await measureReviewHealthCheck("activity", "評論活動", async () => { throw new Error("資料庫逾時"); });
    expect(summarizeReviewHealth([check])).toMatchObject({ status: "degraded", checks: [{ id: "activity", status: "degraded", message: "資料庫逾時" }] });
  });
});
