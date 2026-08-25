import { describe, expect, it } from "vitest";
import { buildReviewAlert } from "./ReviewQueueAlertListener";

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
});
