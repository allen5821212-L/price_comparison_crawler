import { describe, expect, it } from "vitest";
import { buildReviewAlert } from "./ReviewQueueAlertListener";

describe("高風險配對提醒", () => {
  it("prioritizes newly critical review items", () => {
    expect(buildReviewAlert({ highRiskTotal: 3, criticalTotal: 1 }, { highRiskTotal: 5, criticalTotal: 3 })).toEqual({
      title: "新增需優先確認的配對",
      message: "有 2 件新的緊急風險配對，請優先處理。",
    });
  });

  it("alerts only when the high-risk count increases", () => {
    expect(buildReviewAlert({ highRiskTotal: 2, criticalTotal: 1 }, { highRiskTotal: 3, criticalTotal: 1 })).toEqual({
      title: "高風險配對數量增加",
      message: "有 1 件新的高風險配對，請安排人工確認。",
    });
    expect(buildReviewAlert({ highRiskTotal: 3, criticalTotal: 1 }, { highRiskTotal: 2, criticalTotal: 1 })).toBeNull();
  });
});
