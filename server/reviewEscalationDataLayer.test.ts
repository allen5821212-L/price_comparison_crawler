import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMyOverdueMatchReviewEscalations, type OverdueEscalationQueryStore } from "./db";

describe("getMyOverdueMatchReviewEscalations 資料層", () => {
  beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(10_000_000));

  it("returns delegated and fallback assignments only to the intended recipient", async () => {
    const listOverdueAssignments = vi.fn(async (assigneeUserId: number) => [{
      sourceKey: `sinya_${assigneeUserId}`,
      fingerprint: String(assigneeUserId).padStart(64, "0"),
      dueAt: new Date(1_000_000),
    }]);
    const store: OverdueEscalationQueryStore = {
      listActiveSettings: async () => [
        { userId: 11, escalationRecipientUserId: 22, active: true, escalateAfterMinutes: 60, reminderIntervalMinutes: 30 },
        { userId: 22, escalationRecipientUserId: null, active: true, escalateAfterMinutes: 90, reminderIntervalMinutes: 15 },
        { userId: 33, escalationRecipientUserId: 22, active: false, escalateAfterMinutes: 60, reminderIntervalMinutes: 5 },
      ],
      listOverdueAssignments,
    };

    const recipientResult = await getMyOverdueMatchReviewEscalations(22, store);
    const ownerResult = await getMyOverdueMatchReviewEscalations(11, store);

    expect(recipientResult).toMatchObject({ active: true, reminderIntervalMinutes: 15, total: 2 });
    expect(recipientResult.items.map(item => item.ownerUserId).sort()).toEqual([11, 22]);
    expect(listOverdueAssignments).toHaveBeenCalledWith(11, expect.any(Date));
    expect(listOverdueAssignments).toHaveBeenCalledWith(22, expect.any(Date));
    expect(ownerResult).toEqual({ active: false, reminderIntervalMinutes: 30, total: 0, items: [] });
  });

  it("does not query assignments when every matching escalation rule is inactive", async () => {
    const listOverdueAssignments = vi.fn();
    const store: OverdueEscalationQueryStore = {
      listActiveSettings: async () => [{ userId: 11, escalationRecipientUserId: 22, active: false, escalateAfterMinutes: 60, reminderIntervalMinutes: 30 }],
      listOverdueAssignments,
    };

    await expect(getMyOverdueMatchReviewEscalations(22, store)).resolves.toEqual({ active: false, reminderIntervalMinutes: 30, total: 0, items: [] });
    expect(listOverdueAssignments).not.toHaveBeenCalled();
  });
});
