import { describe, expect, it } from "vitest";
import { buildReviewHealthDiagnosticCsvRows } from "./reviewHealthDiagnosticCsv";

describe("重大降級診斷 CSV", () => {
  it("includes persistent incident delivery/read counts and degraded probe evidence", () => {
    const rows = buildReviewHealthDiagnosticCsvRows({
      generatedAt: "2026-09-03T04:00:00.000Z",
      filters: { startAt: "2026-09-01T00:00:00.000Z", endAt: null },
      incidents: [{
        incidentKey: "weekly-quality:2026-09-02T00:00:00.000Z",
        checkId: "weekly-quality",
        title: "審核 API 持續降級：週品質報表",
        message: "資料庫逾時",
        createdAt: "2026-09-02T00:15:00.000Z",
        recipientCount: 2,
        deliveredCount: 2,
        readCount: 1,
        recipients: ["Alice", "Bob"],
      }],
      evidence: [{
        checkId: "weekly-quality",
        checkLabel: "週品質報表",
        status: "degraded",
        durationMs: 5400,
        message: "資料庫逾時",
        observedAt: "2026-09-02T00:10:00.000Z",
      }],
    });

    expect(rows).toContainEqual(["重大降級事件"]);
    expect(rows).toContainEqual(expect.arrayContaining(["weekly-quality", 2, 2, 1, "Alice、Bob"]));
    expect(rows).toContainEqual(["檢查項目", "名稱", "狀態", "延遲（ms）", "訊息", "觀測時間"]);
    expect(rows).toContainEqual(expect.arrayContaining(["weekly-quality", "週品質報表", "降級", 5400, "資料庫逾時"]));
  });
});
