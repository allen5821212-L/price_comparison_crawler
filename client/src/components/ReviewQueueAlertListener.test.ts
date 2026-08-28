import { describe, expect, it } from "vitest";
import { buildOverdueEscalationAlert, buildPersistentDegradationAlert, buildReviewAlert, shouldEmitOverdueEscalation } from "./ReviewQueueAlertListener";

describe("高風險配對提醒", () => {
  it("prioritizes newly critical review items", () => {
    expect(buildReviewAlert({ mediumTotal: 3, highTotal: 2, criticalTotal: 1 }, { mediumTotal: 3, highTotal: 3, criticalTotal: 3 }, { mediumThreshold: 0, highThreshold: 2, criticalThreshold: 2 })).toEqual({
      title: "緊急風險配對數量增加",
      message: "目前共有 3 件緊急風險配對，已達你設定的 2 件提醒門檻。",
    });
  });

  it("respects each risk threshold and ignores disabled or decreasing counts", () => {
    expect(buildReviewAlert({ mediumTotal: 1, highTotal: 1, criticalTotal: 0 }, { mediumTotal: 2, highTotal: 2, criticalTotal: 0 }, { mediumThreshold: 3, highThreshold: 2, criticalThreshold: 0 })).toEqual({
      title: "高度風險配對數量增加",
      message: "目前共有 2 件高度風險配對，已達你設定的 2 件提醒門檻。",
    });
    expect(buildReviewAlert({ mediumTotal: 3, highTotal: 2, criticalTotal: 1 }, { mediumTotal: 2, highTotal: 2, criticalTotal: 1 }, { mediumThreshold: 1, highThreshold: 1, criticalThreshold: 1 })).toBeNull();
  });

  it("creates an overdue escalation alert only when a personal assignment is overdue", () => {
    expect(buildOverdueEscalationAlert(2, 60)).toEqual({
      title: "有逾期審核案件需要處理",
      message: "你有 2 件審核工作已超過 60 分鐘的升級時限。",
    });
    expect(buildOverdueEscalationAlert(0, 60)).toBeNull();
  });

  it("honors the configured reminder frequency and never emits without overdue work", () => {
    const now = 10_000_000;
    expect(shouldEmitOverdueEscalation(now - 30 * 60_000, now, 1, true, 60)).toBe(false);
    expect(shouldEmitOverdueEscalation(now - 60 * 60_000, now, 1, true, 60)).toBe(true);
    expect(shouldEmitOverdueEscalation(now - 60 * 60_000, now, 0, true, 60)).toBe(false);
  });

  it("uses the source API incident for one alert and summarizes multiple unread incidents", () => {
    expect(buildPersistentDegradationAlert([{ title: "審核 API 持續降級：週品質報表", message: "已持續降級 15 分鐘" }])).toEqual({ title: "審核 API 持續降級：週品質報表", message: "已持續降級 15 分鐘" });
    expect(buildPersistentDegradationAlert([{ title: "A", message: "a" }, { title: "B", message: "b" }])).toEqual({ title: "有 2 項審核 API 持續降級", message: "a" });
    expect(buildPersistentDegradationAlert([])).toBeNull();
  });
});
