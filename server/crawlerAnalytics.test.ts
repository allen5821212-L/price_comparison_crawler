import { describe, expect, it } from "vitest";
import { deriveCategoryRecrawlAnalytics } from "./db";

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
});
