import { describe, expect, it } from "vitest";
import { selectEscalationRulesForRecipient, shouldNotifyEscalationRecipient } from "./reviewEscalations";

describe("逾期升級接收者", () => {
  it("sends an explicitly delegated escalation only to the configured administrator", () => {
    const rule = { userId: 1, escalationRecipientUserId: 2, active: true };
    expect(shouldNotifyEscalationRecipient(rule, 2)).toBe(true);
    expect(shouldNotifyEscalationRecipient(rule, 1)).toBe(false);
  });

  it("keeps a non-delegated escalation with the original assignee and ignores inactive rules", () => {
    expect(shouldNotifyEscalationRecipient({ userId: 1, escalationRecipientUserId: null, active: true }, 1)).toBe(true);
    expect(shouldNotifyEscalationRecipient({ userId: 1, escalationRecipientUserId: null, active: false }, 1)).toBe(false);
  });

  it("selects the same rules that the overdue-query data layer should inspect for each recipient", () => {
    const rules = [
      { id: 1, userId: 11, escalationRecipientUserId: 22, active: true },
      { id: 2, userId: 22, escalationRecipientUserId: null, active: true },
      { id: 3, userId: 33, escalationRecipientUserId: 22, active: false },
    ];

    expect(selectEscalationRulesForRecipient(rules, 22).map(rule => rule.id)).toEqual([1, 2]);
    expect(selectEscalationRulesForRecipient(rules, 11)).toEqual([]);
  });
});
