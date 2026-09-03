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
    useQuery: (_input?: unknown, options?: { enabled?: boolean }) => {
      if (options?.enabled === false) return { data: undefined, isLoading: false, isError: false, isFetching: false, error: null, refetch: noop };
      if (state.mode === "loading") return { data: undefined, isLoading: true, isError: false, isFetching: false, error: null, refetch: noop };
      if (state.mode === "error") return { data: undefined, isLoading: false, isError: true, isFetching: false, error: new Error("報表暫時無法取得"), refetch: noop };
      return { data, isLoading: false, isError: false, isFetching: false, error: null, refetch: noop };
    },
  });
  const mutate = { useMutation: () => ({ mutate: noop, isPending: false }) };
  return {
    trpc: {
      useUtils: () => ({ comparison: { reviewQueue: { invalidate: noop }, reviewSummary: { invalidate: noop }, reviewNotificationSettings: { invalidate: noop }, reviewEscalationSettings: { invalidate: noop }, reviewHealthMonitorSettings: { invalidate: noop } }, matchRules: { listForAdmin: { invalidate: noop } } }),
      comparison: {
        reviewQueue: query({ run: { id: 1 }, total: 0, page: 1, pageSize: 20, totalPages: 0, items: [] }),
        reviewSummary: query({ total: 0, criticalTotal: 0, highTotal: 0, mediumTotal: 0 }),
        reviewAssignees: query([]),
        reviewNotificationSettings: query({ mediumThreshold: 0, highThreshold: 1, criticalThreshold: 1 }),
        reviewEscalationSettings: query({ active: true, escalationRecipientUserId: null, escalateAfterMinutes: 60, reminderIntervalMinutes: 30 }),
        weeklyQualityReport: status({ startDate: "2026-08-22", endDate: "2026-08-28", cache: { hit: true, ageMs: 10_000, expiresAt: 70_000 }, summary: { autoQualityRate: 92, totalMatches: 20, lowConfidenceMatches: 1, specDiffMatches: 1 }, days: [], riskSources: [] }),
        reviewHealth: status({ status: "healthy", checks: [{ id: "weekly-quality", label: "週品質報表", status: "healthy", durationMs: 12, message: null }] }),
        reviewHealthHistory: status([{ id: 1, checkLabel: "週品質報表", status: "degraded", message: "逾時", observedAt: new Date("2026-08-28T00:00:00.000Z"), durationMs: 5000 }]),
        reviewHealthMonitorSettings: query({ active: true, degradationThresholdMinutes: 15 }),
        reviewDegradationAlertStats: query({ total: 3, delivered: 2, read: 1, unread: 2, distinctIncidents: 2, latestAlertAt: new Date("2026-08-28T00:00:00.000Z") }),
        reviewDegradationDiagnostics: status({ generatedAt: new Date("2026-08-28T00:00:00.000Z"), filters: { startAt: null, endAt: null }, incidents: [], evidence: [] }),
        assignReview: mutate,
        resolveReview: mutate,
        updateReviewNotificationSettings: mutate,
        updateReviewEscalationSettings: mutate,
        updateReviewHealthMonitorSettings: mutate,
        bulkReassignOverdueReviews: mutate,
        skipReview: mutate,
      },
      matchRules: { confirm: mutate },
    },
  };
});

import MatchReviewQueuePage from "./MatchReviewQueuePage";

describe("待審核工作台可靠性介面", () => {
  it("renders health loading feedback while leaving the optional weekly report deferred", () => {
    state.mode = "loading";
    const markup = renderToStaticMarkup(<MatchReviewQueuePage />);

    expect(markup).toContain("審核 API 健康檢查載入中");
    expect(markup).toContain("載入週品質報表");
  });

  it("renders health details and the timeline while keeping the weekly report opt-in", () => {
    state.mode = "ready";
    const markup = renderToStaticMarkup(<MatchReviewQueuePage />);

    expect(markup).toContain("審核 API 健康狀態");
    expect(markup).toContain("週品質報表");
    expect(markup).toContain("正常");
    expect(markup).toContain("健康狀態歷程");
    expect(markup).toContain("降級");
    expect(markup).toContain("健康歷程篩選");
    expect(markup).toContain("全部狀態");
    expect(markup).toContain("持續降級提醒統計");
    expect(markup).toContain("已送達");
    expect(markup).toContain("匯出重大降級診斷 CSV");
    expect(markup).toContain("載入週品質報表");
  });

  it("does not issue the optional report error state before it has been enabled", () => {
    state.mode = "error";
    const markup = renderToStaticMarkup(<MatchReviewQueuePage />);

    expect(markup).not.toContain("週品質報表暫時無法載入");
    expect(markup).toContain("載入週品質報表");
  });
});
