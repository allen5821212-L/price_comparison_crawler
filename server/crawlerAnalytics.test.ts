import { describe, expect, it } from "vitest";
import { collectExistingCategoryJobIds, createCategoryRecrawlJobValues, deriveCategoryRecrawlAnalytics, partitionCategoryRecrawlNames } from "./db";

describe("deriveCategoryRecrawlAnalytics", () => {
  it("從已完成與失敗的分類工作計算耗時、整體成功率與五筆滾動成功率", () => {
    const analytics = deriveCategoryRecrawlAnalytics([
      { id: 3, categoryName: "CASE 機殼", status: "failed", startedAt: new Date("2026-08-19T01:00:00.000Z"), finishedAt: new Date("2026-08-19T01:10:00.000Z") },
      { id: 1, categoryName: "螢幕", status: "completed", startedAt: new Date("2026-08-19T00:00:00.000Z"), finishedAt: new Date("2026-08-19T00:20:00.000Z") },
      { id: 2, categoryName: "記憶體", status: "completed", startedAt: new Date("2026-08-19T00:30:00.000Z"), finishedAt: new Date("2026-08-19T00:40:00.000Z") },
      { id: 4, categoryName: "處理器", status: "queued", startedAt: null, finishedAt: null },
    ]);

    expect(analytics).toMatchObject({
      sampleSize: 3,
      completedCount: 2,
      failedCount: 1,
      successRate: 2 / 3,
      averageDurationMs: 800_000,
    });
    expect(analytics.points.map(point => ({ id: point.id, durationMinutes: point.durationMinutes, rollingSuccessRate: point.rollingSuccessRate }))).toEqual([
      { id: 1, durationMinutes: 20, rollingSuccessRate: 100 },
      { id: 2, durationMinutes: 10, rollingSuccessRate: 100 },
      { id: 3, durationMinutes: 10, rollingSuccessRate: 66.7 },
    ]);
  });

  it("忽略尚未完成、無分類或時間倒置的紀錄", () => {
    const analytics = deriveCategoryRecrawlAnalytics([
      { id: 1, categoryName: null, status: "completed", startedAt: new Date("2026-08-19T00:00:00.000Z"), finishedAt: new Date("2026-08-19T00:10:00.000Z") },
      { id: 2, categoryName: "網通", status: "running", startedAt: new Date("2026-08-19T00:00:00.000Z"), finishedAt: null },
      { id: 3, categoryName: "主機板", status: "failed", startedAt: new Date("2026-08-19T01:00:00.000Z"), finishedAt: new Date("2026-08-19T00:50:00.000Z") },
    ]);

    expect(analytics).toEqual({ sampleSize: 0, completedCount: 0, failedCount: 0, successRate: null, averageDurationMs: null, points: [] });
  });

  it("去除重複與空白分類，並保留已在佇列或執行中的分類不重複建立", () => {
    expect(partitionCategoryRecrawlNames([" 鍵盤 ", "筆電", "鍵盤", "", "網通"], new Set(["筆電"]))).toEqual({
      requestedCategoryNames: ["鍵盤", "筆電", "網通"],
      createdCategoryNames: ["鍵盤", "網通"],
      existingCategoryNames: ["筆電"],
    });
  });

  it("多分類送出只產生多筆 category/manual 工作，絕不建立 full 工作", () => {
    expect(createCategoryRecrawlJobValues(["鍵盤", "筆電"], "admin-open-id")).toEqual([
      { scope: "category", trigger: "manual", status: "queued", categoryName: "鍵盤", requestedByOpenId: "admin-open-id" },
      { scope: "category", trigger: "manual", status: "queued", categoryName: "筆電", requestedByOpenId: "admin-open-id" },
    ]);
  });

  it("將既有排隊或執行分類的工作編號回傳給常用清單歷程", () => {
    expect(collectExistingCategoryJobIds([
      { id: 101, categoryName: "鍵盤" },
      { id: 102, categoryName: "筆電" },
      { id: 103, categoryName: null },
    ], ["筆電", "網通"])).toEqual([102]);
  });
});
