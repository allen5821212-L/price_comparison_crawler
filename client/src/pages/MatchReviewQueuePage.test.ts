import { describe, expect, it } from "vitest";
import { buildHealthHistoryInput, buildQueueConfirmationInput, buildQueueSkipInput, shouldLoadQualityReport } from "./MatchReviewQueuePage";

describe("待審核佇列確認操作", () => {
  it("creates a platform-specific rule input when an existing candidate is adopted", () => {
    expect(buildQueueConfirmationInput("ASUS B850M-A", { platform: "momo", name: "ASUS B850M-A WIFI" })).toEqual({
      sinyaName: "ASUS B850M-A",
      platform: "momo",
      targetName: "ASUS B850M-A WIFI",
    });
  });

  it("keeps the source key and candidate fingerprint when a review is deferred", () => {
    expect(buildQueueSkipInput("sinya_42", "a".repeat(64))).toEqual({ sourceKey: "sinya_42", fingerprint: "a".repeat(64) });
  });

  it("defers the weekly quality report query until an administrator explicitly requests it", () => {
    expect(shouldLoadQualityReport("admin", false)).toBe(false);
    expect(shouldLoadQualityReport("admin", true)).toBe(true);
    expect(shouldLoadQualityReport("user", true)).toBe(false);
  });

  it("builds a bounded date and degraded-only health-history filter", () => {
    expect(buildHealthHistoryInput("degraded", "weekly-quality", "2026-09-01", "2026-09-03")).toEqual({
      limit: 24,
      status: "degraded",
      checkId: "weekly-quality",
      startAt: new Date("2026-09-01T00:00:00"),
      endAt: new Date("2026-09-03T23:59:59.999"),
    });
    expect(buildHealthHistoryInput("all", "all", "", "")).toMatchObject({ limit: 24, status: undefined, checkId: undefined, startAt: undefined, endAt: undefined });
  });
});
