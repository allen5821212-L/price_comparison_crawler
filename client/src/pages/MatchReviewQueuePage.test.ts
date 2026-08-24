import { describe, expect, it } from "vitest";
import { buildQueueConfirmationInput, buildQueueSkipInput } from "./MatchReviewQueuePage";

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
});
