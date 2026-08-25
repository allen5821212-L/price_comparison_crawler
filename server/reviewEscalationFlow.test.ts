import { describe, expect, it } from "vitest";
import { shouldEmitOverdueEscalation } from "../client/src/components/ReviewQueueAlertListener";
import { shouldNotifyEscalationRecipient } from "./reviewEscalations";

describe("指定接收者逾期提醒流程", () => {
  it("delivers a delegated overdue assignment only to the configured recipient, then respects reminder frequency", () => {
    const rule = { userId: 11, escalationRecipientUserId: 22, active: true };
    const recipientCanReceive = shouldNotifyEscalationRecipient(rule, 22);
    const ownerCanReceive = shouldNotifyEscalationRecipient(rule, 11);

    expect(recipientCanReceive).toBe(true);
    expect(ownerCanReceive).toBe(false);
    expect(shouldEmitOverdueEscalation(0, 60 * 60_000, 1, recipientCanReceive, 30)).toBe(true);
    expect(shouldEmitOverdueEscalation(45 * 60_000, 60 * 60_000, 1, recipientCanReceive, 30)).toBe(false);
  });

  it("falls back to the original assignee and suppresses inactive or zero-overdue cases", () => {
    const fallbackRule = { userId: 11, escalationRecipientUserId: null, active: true };
    const inactiveRule = { userId: 11, escalationRecipientUserId: 22, active: false };

    expect(shouldNotifyEscalationRecipient(fallbackRule, 11)).toBe(true);
    expect(shouldNotifyEscalationRecipient(inactiveRule, 22)).toBe(false);
    expect(shouldEmitOverdueEscalation(0, 60 * 60_000, 0, true, 30)).toBe(false);
  });
});
