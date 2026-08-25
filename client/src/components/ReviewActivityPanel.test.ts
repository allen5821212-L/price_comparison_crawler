import { describe, expect, it } from "vitest";
import { buildReviewHandoffInput, toggleMentionUser } from "./ReviewActivityPanel";

describe("審核交接輸入", () => {
  it("retains the review identity, target assignee, deadline offset, and trimmed handoff message", () => {
    const before = Date.now();
    const input = buildReviewHandoffInput("sinya_9", "a".repeat(64), 3, 24, "  請確認容量  ");
    expect(input).toMatchObject({ sourceKey: "sinya_9", fingerprint: "a".repeat(64), assigneeUserId: 3, message: "請確認容量" });
    expect(input.dueAt.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
  });

  it("adds and removes explicitly mentioned administrators", () => {
    expect(toggleMentionUser([], 3)).toEqual([3]);
    expect(toggleMentionUser([2, 3], 3)).toEqual([2]);
  });
});
