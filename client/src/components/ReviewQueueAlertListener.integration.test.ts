import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  cursor: 0,
  overdueData: undefined as undefined | { active: boolean; reminderIntervalMinutes: number; total: number; items: Array<{ ownerUserId: number; escalateAfterMinutes: number }> },
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("react", () => ({
  useRef: (initial: unknown) => {
    const index = state.cursor++;
    if (!state.refs[index]) state.refs[index] = { current: initial };
    return state.refs[index];
  },
  useEffect: (effect: () => void) => effect(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    comparison: {
      reviewSummary: { useQuery: () => ({ data: undefined }) },
      reviewNotificationSettings: { useQuery: () => ({ data: undefined }) },
      reviewEscalationSettings: { useQuery: () => ({ data: { reminderIntervalMinutes: 30 } }) },
      myOverdueReviewEscalations: { useQuery: () => ({ data: state.overdueData }) },
      unreadReviewMentions: { useQuery: () => ({ data: [] }) },
      markReviewMentionsRead: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { warning: state.warning, info: state.info },
}));

import { ReviewQueueAlertListener } from "./ReviewQueueAlertListener";

function renderListener() {
  state.cursor = 0;
  ReviewQueueAlertListener();
}

describe("ReviewQueueAlertListener tRPC 整合", () => {
  beforeEach(() => {
    state.refs = [];
    state.cursor = 0;
    state.overdueData = undefined;
    state.warning.mockReset();
    state.info.mockReset();
    vi.spyOn(Date, "now").mockReturnValue(3_600_000);
  });

  it("uses the tRPC overdue payload for a designated recipient and suppresses repeat alerts until the configured interval", () => {
    state.overdueData = {
      active: true,
      reminderIntervalMinutes: 30,
      total: 1,
      items: [{ ownerUserId: 11, escalateAfterMinutes: 60 }],
    };

    renderListener();
    expect(state.warning).toHaveBeenCalledWith("有逾期審核案件需要處理", expect.objectContaining({
      description: "你有 1 件審核工作已超過 60 分鐘的升級時限。",
    }));

    renderListener();
    expect(state.warning).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the tRPC payload reports no overdue work or an inactive escalation rule", () => {
    state.overdueData = { active: false, reminderIntervalMinutes: 30, total: 1, items: [{ ownerUserId: 11, escalateAfterMinutes: 60 }] };
    renderListener();
    state.overdueData = { active: true, reminderIntervalMinutes: 30, total: 0, items: [] };
    renderListener();

    expect(state.warning).not.toHaveBeenCalled();
  });
});
