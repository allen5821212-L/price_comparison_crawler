import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mode: "loading" as "loading" | "ready" | "error" }));
const noop = vi.fn();

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/components/ManualMatchDialog", () => ({
  ManualMatchDialog: () => null,
}));

vi.mock("@/components/ReviewActivityPanel", () => ({
  ReviewActivityPanel: () => null,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => "skeleton",
}));

vi.mock("@/lib/trpc", () => {
  const query = (data: unknown) => ({ useQuery: () => ({ data, isLoading: false, isError: false, isFetching: false, error: null, refetch: noop }) });
  const status = (data: unknown) => ({
    useQuery: () => {
      if (state.mode === "loading") return { data: undefined, isLoading: true, isError: false, isFetching: false, error: null, refetch: noop };
      if (state.mode === "error") return { data: undefined, isLoading: false, isError: true, isFetching: false, error: new Error("報表暫時無法取得"), refetch: noop };
      return { data, isLoading: false, isError: false, isFetching: false, error: null, refetch: noop };
    },
  });
  const mutate = { useMutation: () => ({ mutate: noop, isPending: false }) };
  return {
    trpc: {
      useUtils: () => ({ comparison: { reviewQueue: { invalidate: noop }, reviewSummary: { invalidate: noop }, reviewNotificationSettings: { invalidate: noop }, reviewEscalationSettings: { invalidate: noop } }, matchRules: { listForAdmin: { invalidate: noop } } }),
      comparison: {
        reviewQueue: query({ run: { id: 1 }, total: 0, page: 1, pageSize: 20, totalPages: 0, items: [] }),
        reviewSummary: query({ total: 0, criticalTotal: 0, highTotal: 0, mediumTotal: 0 }),
        reviewAssignees: query([]),
        reviewNotificationSettings: query({ mediumThreshold: 0, highThreshold: 1, criticalThreshold: 1 }),
        reviewEscalationSettings: query({ active: true, escalationRecipientUserId: null, escalateAfterMinutes: 60, reminderIntervalMinutes: 30 }),
        weeklyQualityReport: status({ startDate: "2026-08-22", endDate: "2026-08-28", cache: { hit: true, ageMs: 10_000, expiresAt: 70_000 }, summary: { autoQualityRate: 92, totalMatches: 20, lowConfidenceMatches: 1, specDiffMatches: 1 }, days: [], riskSources: [] }),
        reviewHealth: status({ status: "healthy", checks: [{ id: "weekly-quality", label: "週品質報表", status: "healthy", durationMs: 12, message: null }] }),
        assignReview: mutate,
        resolveReview: mutate,
        updateReviewNotificationSettings: mutate,
        updateReviewEscalationSettings: mutate,
        bulkReassignOverdueReviews: mutate,
        skipReview: mutate,
      },
      matchRules: { confirm: mutate },
    },
  };
});

import MatchReviewQueuePage from "./MatchReviewQueuePage";

describe("待審核工作台可靠性介面", () => {
  it("renders labelled loading skeletons while quality and health data are loading", () => {
    state.mode = "loading";
    const markup = renderToStaticMarkup(<MatchReviewQueuePage />);

    expect(markup).toContain("週品質報表載入中");
    expect(markup).toContain("審核 API 健康檢查載入中");
  });

  it("renders cache state and healthy API details after an admin report query succeeds", () => {
    state.mode = "ready";
    const markup = renderToStaticMarkup(<MatchReviewQueuePage />);

    expect(markup).toContain("快取 · 10 秒前");
    expect(markup).toContain("審核 API 健康狀態");
    expect(markup).toContain("週品質報表");
    expect(markup).toContain("正常");
  });

  it("renders a retry action when the weekly report query fails", () => {
    state.mode = "error";
    const markup = renderToStaticMarkup(<MatchReviewQueuePage />);

    expect(markup).toContain("週品質報表暫時無法載入");
    expect(markup).toContain("再試一次");
  });
});
