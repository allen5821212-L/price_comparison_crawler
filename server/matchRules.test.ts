import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  getDynamicPriceHistory: vi.fn(),
  getCrawlerRefreshEstimates: vi.fn(),
  getFavoriteForUser: vi.fn(),
  getLatestCrawlerStatus: vi.fn(),
  getLatestDynamicComparison: vi.fn(),
  enqueueCrawlerJob: vi.fn(),
  listActiveMatchingFeedback: vi.fn(),
  listCrawlerEvents: vi.fn(),
  listCrawlerJobs: vi.fn(),
  listFavoritesForUser: vi.fn(),
  listMatchingFeedbackForAdmin: vi.fn(),
  listPriceNotificationsForUser: vi.fn(),
  getLatestMatchReviewQueue: vi.fn(),
  getLatestMatchReviewSummary: vi.fn(),
  getReviewApiHealth: vi.fn(),
  getReviewApiHealthHistory: vi.fn(),
  getReviewApiHealthMonitorSettings: vi.fn(),
  getReviewApiDegradationAlertStats: vi.fn(),
  getReviewApiDegradationDiagnostics: vi.fn(),
  getRecentReviewApiDegradationAlerts: vi.fn(),
  getReviewApiWeeklyDegradationTrend: vi.fn(),
  getUnreadReviewApiDegradationAlerts: vi.fn(),
  getMatchReviewEscalationSettings: vi.fn(),
  getMatchReviewNotificationSettings: vi.fn(),
  getMyOverdueMatchReviewEscalations: vi.fn(),
  getWeeklyMatchQualityReport: vi.fn(),
  addMatchReviewComment: vi.fn(),
  bulkReassignOverdueMatchReviews: vi.fn(),
  handoffMatchReview: vi.fn(),
  listMatchReviewActivity: vi.fn(),
  listUnreadMatchReviewMentions: vi.fn(),
  listReviewAssignees: vi.fn(),
  resolveMatchReviewAssignment: vi.fn(),
  saveMatchReviewSkip: vi.fn(),
  upsertMatchReviewAssignment: vi.fn(),
  upsertMatchReviewEscalationSettings: vi.fn(),
  upsertMatchReviewNotificationSettings: vi.fn(),
  updateReviewApiHealthMonitorSettings: vi.fn(),
  markCrawlerEventsRead: vi.fn(),
  markMatchReviewMentionsRead: vi.fn(),
  markReviewApiDegradationAlertsDelivered: vi.fn(),
  markReviewApiDegradationAlertsRead: vi.fn(),
  recordNegativeMatchFeatureFeedback: vi.fn(),
  upsertReviewApiDegradationAlertResolution: vi.fn(),
  searchDynamicProducts: vi.fn(),
  setMatchingFeedbackActive: vi.fn(),
  setFavoriteActiveForUser: vi.fn(),
  upsertMatchingFeedback: vi.fn(),
  upsertFavoriteForUser: vi.fn(),
}));

vi.mock("./db", () => dbMocks);

import { appRouter } from "./routers";

function createAdminContext(): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 1,
      openId: "owner-open-id",
      name: "Owner",
      email: null,
      loginMethod: "manus",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("matchRules router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports only the active rules supplied by the persistence layer", async () => {
    dbMocks.listActiveMatchingFeedback.mockResolvedValue([
      { sinyaName: "ASUS B850-G", targetName: "ROG B850-G", targetId: "coolpc_1", platform: "coolpc" },
    ]);

    const caller = appRouter.createCaller(createAdminContext());
    await expect(caller.matchRules.listForCrawler()).resolves.toEqual([
      { sinyaName: "ASUS B850-G", targetName: "ROG B850-G", targetId: "coolpc_1", platform: "coolpc" },
    ]);
  });

  it("stores an administrator-confirmed mapping with the caller identity", async () => {
    dbMocks.upsertMatchingFeedback.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.matchRules.confirm({
      sinyaName: "ASUS B850-G",
      targetName: "ROG B850-G",
      targetId: "coolpc_1",
      platform: "coolpc",
    })).resolves.toEqual({ success: true, sourceAlias: "B850-G", targetAlias: "B850-G" });

    expect(dbMocks.upsertMatchingFeedback).toHaveBeenCalledWith({
      sinyaName: "ASUS B850-G",
      targetName: "ROG B850-G",
      targetId: "coolpc_1",
      platform: "coolpc",
      sourceAlias: "B850-G",
      targetAlias: "B850-G",
      createdByOpenId: "owner-open-id",
    });
  });

  it("returns active and inactive rules with management usage fields for administrators", async () => {
    const rules = [{ id: 7, sinyaName: "ASUS B850-G", targetName: "ROG B850-G", platform: "coolpc", active: false, hitCount: 3, lastHitAt: null }];
    dbMocks.listMatchingFeedbackForAdmin.mockResolvedValue(rules);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.matchRules.listForAdmin()).resolves.toEqual(rules);
  });

  it("updates a rule activation state through the administrator procedure", async () => {
    dbMocks.setMatchingFeedbackActive.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.matchRules.setActive({ id: 7, active: false })).resolves.toEqual({ success: true });
    expect(dbMocks.setMatchingFeedbackActive).toHaveBeenCalledWith(7, false);
  });

  it("returns the latest dynamic comparison payload for public storefront queries", async () => {
    const comparison = {
      stats: { matched_total: 1 },
      matched: [{ sinya_name: "Samsung 870 EVO 4TB", coolpc_name: "Samsung 870 EVO 4TB" }],
      sinya_products: [], coolpc_products: [], pchome_products: [], momo_products: [], sinya_categories: [],
    };
    dbMocks.getLatestDynamicComparison.mockResolvedValue(comparison);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.comparison.latest()).resolves.toEqual(comparison);
  });

  it("returns the latest suspicious-match review queue only through the administrator procedure", async () => {
    const queue = { run: { id: 21 }, total: 1, page: 1, pageSize: 25, totalPages: 1, items: [{ id: 4, severity: "high" }] };
    dbMocks.getLatestMatchReviewQueue.mockResolvedValue(queue);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.comparison.reviewQueue({ page: 1, pageSize: 25 })).resolves.toEqual(queue);
    expect(dbMocks.getLatestMatchReviewQueue).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
  });

  it("records mutually-exclusive feature feedback for a rejected manual candidate", async () => {
    dbMocks.recordNegativeMatchFeatureFeedback.mockResolvedValue([
      { sourceFeature: "color:white", targetFeature: "color:black" },
    ]);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.comparison.rejectReviewCandidate({
      sourceKey: "sinya-123",
      fingerprint: "a".repeat(64),
      sourceName: "ASUS 白色主機板 DDR5",
      targetName: "ASUS 黑色主機板 DDR4",
      targetId: "coolpc-456",
      platform: "coolpc",
    })).resolves.toEqual({ success: true, learnedFeatureCount: 1 });

    expect(dbMocks.recordNegativeMatchFeatureFeedback).toHaveBeenCalledWith({
      platform: "coolpc",
      sourceName: "ASUS 白色主機板 DDR5",
      targetName: "ASUS 黑色主機板 DDR4",
      rejectedByUserId: 1,
    });
  });

  it("returns the compact high-risk review summary through the administrator procedure", async () => {
    const summary = { run: { id: 21 }, total: 7, mediumTotal: 3, highTotal: 2, criticalTotal: 2, highRiskTotal: 4 };
    dbMocks.getLatestMatchReviewSummary.mockResolvedValue(summary);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.comparison.reviewSummary()).resolves.toEqual(summary);
  });

  it("returns the review API health summary through the administrator procedure", async () => {
    const health = { checkedAt: "2026-08-28T04:30:00.000Z", status: "healthy", checks: [] };
    dbMocks.getReviewApiHealth.mockResolvedValue(health);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.comparison.reviewHealth()).resolves.toEqual(health);
  });

  it("filters health history, returns alert statistics, exports diagnostics, and records in-app delivery", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const startAt = new Date("2026-09-01T00:00:00.000Z");
    const endAt = new Date("2026-09-02T23:59:59.999Z");
    const history = [{ id: 8, checkId: "weekly-quality", status: "degraded" }];
    const stats = { total: 3, delivered: 2, read: 1, unread: 2, distinctIncidents: 2, latestAlertAt: startAt };
    const diagnostics = { generatedAt: startAt.toISOString(), filters: { startAt, endAt }, incidents: [], evidence: [] };
    dbMocks.getReviewApiHealthHistory.mockResolvedValue(history);
    dbMocks.getReviewApiDegradationAlertStats.mockResolvedValue(stats);
    dbMocks.getReviewApiDegradationDiagnostics.mockResolvedValue(diagnostics);

    await expect(caller.comparison.reviewHealthHistory({ limit: 50, status: "degraded", startAt, endAt })).resolves.toEqual(history);
    expect(dbMocks.getReviewApiHealthHistory).toHaveBeenCalledWith({ limit: 50, status: "degraded", startAt, endAt });
    await expect(caller.comparison.reviewDegradationAlertStats()).resolves.toEqual(stats);
    await expect(caller.comparison.reviewDegradationDiagnostics({ startAt, endAt })).resolves.toEqual(diagnostics);
    expect(dbMocks.getReviewApiDegradationDiagnostics).toHaveBeenCalledWith({ startAt, endAt });
    await expect(caller.comparison.markReviewDegradationAlertsDelivered({ ids: [8, 9] })).resolves.toEqual({ success: true });
    expect(dbMocks.markReviewApiDegradationAlertsDelivered).toHaveBeenCalledWith(1, [8, 9]);
  });

  it("filters alert records by check, saves read-alert handling notes, and returns a weekly degradation trend", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const records = [{ id: 9, checkId: "review-queue", readAt: new Date(), resolvedAt: null }];
    const trend = { startDate: "2026-09-01", endDate: "2026-09-07", checkId: "review-queue", summary: { totalChecks: 21, degradedChecks: 2, persistentIncidents: 1 }, days: [] };
    dbMocks.getRecentReviewApiDegradationAlerts.mockResolvedValue(records);
    dbMocks.getReviewApiWeeklyDegradationTrend.mockResolvedValue(trend);

    await expect(caller.comparison.reviewDegradationAlertRecords({ limit: 20, checkId: "review-queue" })).resolves.toEqual(records);
    expect(dbMocks.getRecentReviewApiDegradationAlerts).toHaveBeenCalledWith({ limit: 20, checkId: "review-queue" });
    await expect(caller.comparison.saveReviewDegradationAlertResolution({ alertId: 9, note: "已完成查詢重試並恢復" })).resolves.toEqual({ success: true });
    expect(dbMocks.upsertReviewApiDegradationAlertResolution).toHaveBeenCalledWith({ alertId: 9, note: "已完成查詢重試並恢復", resolvedByUserId: 1 });
    await expect(caller.comparison.reviewWeeklyDegradationTrend({ checkId: "review-queue" })).resolves.toEqual(trend);
    expect(dbMocks.getReviewApiWeeklyDegradationTrend).toHaveBeenCalledWith({ checkId: "review-queue" });
  });

  it("persists assignment, personal notification thresholds, and the weekly quality report through administrator procedures", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const fingerprint = "b".repeat(64);
    const dueAt = new Date(Date.now() + 3_600_000);
    const report = { startDate: "2026-08-19", endDate: "2026-08-25", summary: { totalMatches: 10 }, days: [] };
    dbMocks.getWeeklyMatchQualityReport.mockResolvedValue(report);
    dbMocks.getMatchReviewNotificationSettings.mockResolvedValue({ userId: 1, mediumThreshold: 0, highThreshold: 2, criticalThreshold: 1 });

    await expect(caller.comparison.assignReview({ sourceKey: "sinya_5", fingerprint, assigneeUserId: 1, dueAt })).resolves.toEqual({ success: true });
    expect(dbMocks.upsertMatchReviewAssignment).toHaveBeenCalledWith({ sourceKey: "sinya_5", fingerprint, assigneeUserId: 1, dueAt, assignedByOpenId: "owner-open-id" });
    await expect(caller.comparison.updateReviewNotificationSettings({ mediumThreshold: 3, highThreshold: 2, criticalThreshold: 1 })).resolves.toEqual({ success: true });
    expect(dbMocks.upsertMatchReviewNotificationSettings).toHaveBeenCalledWith({ userId: 1, mediumThreshold: 3, highThreshold: 2, criticalThreshold: 1 });
    await expect(caller.comparison.reviewNotificationSettings()).resolves.toMatchObject({ highThreshold: 2 });
    await expect(caller.comparison.weeklyQualityReport()).resolves.toEqual(report);
  });

  it("records review comments and handoffs, and can bulk reassign overdue work", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const fingerprint = "d".repeat(64);
    const dueAt = new Date(Date.now() + 86_400_000);
    dbMocks.listMatchReviewActivity.mockResolvedValue([{ id: 1, type: "comment", message: "請確認容量規格" }]);
    dbMocks.bulkReassignOverdueMatchReviews.mockResolvedValue({ count: 3 });

    await expect(caller.comparison.addReviewComment({ sourceKey: "sinya_7", fingerprint, message: "請確認容量規格" })).resolves.toEqual({ success: true });
    expect(dbMocks.addMatchReviewComment).toHaveBeenCalledWith({ sourceKey: "sinya_7", fingerprint, message: "請確認容量規格", authorUserId: 1 });
    await expect(caller.comparison.handoffReview({ sourceKey: "sinya_7", fingerprint, assigneeUserId: 2, dueAt, message: "交接給下一班" })).resolves.toEqual({ success: true });
    expect(dbMocks.handoffMatchReview).toHaveBeenCalledWith({ sourceKey: "sinya_7", fingerprint, assigneeUserId: 2, dueAt, message: "交接給下一班", authorUserId: 1, assignedByOpenId: "owner-open-id" });
    await expect(caller.comparison.reviewActivity({ sourceKey: "sinya_7", fingerprint })).resolves.toEqual([{ id: 1, type: "comment", message: "請確認容量規格" }]);
    await expect(caller.comparison.bulkReassignOverdueReviews({ assigneeUserId: 2, dueAt, message: "晚班接手" })).resolves.toEqual({ count: 3 });
    expect(dbMocks.bulkReassignOverdueMatchReviews).toHaveBeenCalledWith({ assigneeUserId: 2, dueAt, message: "晚班接手", authorUserId: 1, assignedByOpenId: "owner-open-id" });
  });

  it("stores explicit manager mentions and returns personal mention plus overdue escalation data", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const fingerprint = "e".repeat(64);
    const escalationSettings = { userId: 1, escalationRecipientUserId: 2, active: true, escalateAfterMinutes: 60, reminderIntervalMinutes: 30 };
    dbMocks.listUnreadMatchReviewMentions.mockResolvedValue([{ id: 5, sourceKey: "sinya_8", fingerprint, message: "請協助確認" }]);
    dbMocks.getMatchReviewEscalationSettings.mockResolvedValue(escalationSettings);
    dbMocks.getMyOverdueMatchReviewEscalations.mockResolvedValue({ active: true, reminderIntervalMinutes: 30, total: 2, items: [] });

    await expect(caller.comparison.addReviewComment({ sourceKey: "sinya_8", fingerprint, message: "請協助確認", mentionedUserIds: [2] })).resolves.toEqual({ success: true });
    expect(dbMocks.addMatchReviewComment).toHaveBeenCalledWith({ sourceKey: "sinya_8", fingerprint, message: "請協助確認", mentionedUserIds: [2], authorUserId: 1 });
    await expect(caller.comparison.unreadReviewMentions()).resolves.toHaveLength(1);
    await expect(caller.comparison.markReviewMentionsRead({ mentionIds: [5] })).resolves.toEqual({ success: true });
    expect(dbMocks.markMatchReviewMentionsRead).toHaveBeenCalledWith(1, [5]);
    await expect(caller.comparison.reviewEscalationSettings()).resolves.toEqual(escalationSettings);
    await expect(caller.comparison.updateReviewEscalationSettings(escalationSettings)).resolves.toEqual({ success: true });
    expect(dbMocks.upsertMatchReviewEscalationSettings).toHaveBeenCalledWith(escalationSettings);
    await expect(caller.comparison.myOverdueReviewEscalations()).resolves.toMatchObject({ total: 2 });
  });

  it("persists an administrator's deferred-review decision for the exact candidate fingerprint", async () => {
    dbMocks.saveMatchReviewSkip.mockResolvedValue(undefined);
    dbMocks.resolveMatchReviewAssignment.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAdminContext());
    const fingerprint = "a".repeat(64);

    await expect(caller.comparison.skipReview({ sourceKey: "sinya_42", fingerprint })).resolves.toEqual({ success: true });
    expect(dbMocks.saveMatchReviewSkip).toHaveBeenCalledWith({ sourceKey: "sinya_42", fingerprint, createdByOpenId: "owner-open-id" });
    expect(dbMocks.resolveMatchReviewAssignment).toHaveBeenCalledWith({ sourceKey: "sinya_42", fingerprint, assigneeUserId: 1, assignedByOpenId: "owner-open-id" });
  });

  it("creates a resolved review record for an unassigned candidate after a pairing is adopted", async () => {
    dbMocks.resolveMatchReviewAssignment.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAdminContext());
    const fingerprint = "c".repeat(64);

    await expect(caller.comparison.resolveReview({ sourceKey: "sinya_52", fingerprint })).resolves.toEqual({ success: true });
    expect(dbMocks.resolveMatchReviewAssignment).toHaveBeenCalledWith({ sourceKey: "sinya_52", fingerprint, assigneeUserId: 1, assignedByOpenId: "owner-open-id" });
  });

  it("allows precision matching to search the Sinya source catalog", async () => {
    const products = [{ source: "sinya", id: "227519", name: "微星 B850M GAMING PLUS WIFI6E", price: 5990 }];
    dbMocks.searchDynamicProducts.mockResolvedValue(products);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.comparison.searchProducts({
      platform: "sinya",
      query: "B850M",
      limit: 10,
    })).resolves.toEqual(products);
    expect(dbMocks.searchDynamicProducts).toHaveBeenCalledWith({
      platform: "sinya",
      query: "B850M",
      limit: 10,
    });
  });

  it("serves database-backed price history and crawler status through public queries", async () => {
    const history = [{ date: "2026-08-16", matched: [] }];
    const status = { id: 4, status: "completed", matchedTotal: 2008 };
    dbMocks.getDynamicPriceHistory.mockResolvedValue(history);
    dbMocks.getLatestCrawlerStatus.mockResolvedValue(status);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.comparison.history()).resolves.toEqual(history);
    await expect(caller.comparison.status()).resolves.toEqual(status);
  });

  it("serves refresh timing estimates derived by the persistence layer", async () => {
    const estimates = {
      full: { estimateMs: 4_800_000, sampleSize: 4, source: "scope_history" },
      category: { estimateMs: 1_200_000, sampleSize: 4, source: "full_history_ratio" },
    };
    dbMocks.getCrawlerRefreshEstimates.mockResolvedValue(estimates);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.comparison.refreshEstimates()).resolves.toEqual(estimates);
  });

  it("lists monitoring data and queues a requested category for the persistent worker", async () => {
    dbMocks.listCrawlerJobs.mockResolvedValue([{ id: 21, status: "queued", scope: "category" }]);
    dbMocks.listCrawlerEvents.mockResolvedValue([{ id: 9, level: "error", title: "來源逾時" }]);
    dbMocks.enqueueCrawlerJob.mockResolvedValue({ id: 22, created: true, status: "queued" });
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.crawler.jobs()).resolves.toEqual([{ id: 21, status: "queued", scope: "category" }]);
    await expect(caller.crawler.events()).resolves.toEqual([{ id: 9, level: "error", title: "來源逾時" }]);
    await expect(caller.crawler.enqueue({ scope: "category", categoryName: "CPU 中央處理器" })).resolves.toEqual({ id: 22, created: true, status: "queued" });
    expect(dbMocks.enqueueCrawlerJob).toHaveBeenCalledWith({
      scope: "category", trigger: "manual", categoryId: undefined, categoryName: "CPU 中央處理器", requestedByOpenId: "owner-open-id",
    });
  });

  it("returns a reused full refresh job instead of requiring the client to queue a duplicate", async () => {
    dbMocks.enqueueCrawlerJob.mockResolvedValue({ id: 91, created: false, status: "running" });
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.crawler.enqueue({ scope: "full" })).resolves.toEqual({ id: 91, created: false, status: "running" });
    expect(dbMocks.enqueueCrawlerJob).toHaveBeenCalledWith({
      scope: "full", trigger: "manual", categoryId: undefined, categoryName: undefined, requestedByOpenId: "owner-open-id",
    });
  });

  it("stores user favorites and returns their database-backed price notifications", async () => {
    const favorite = { id: 4, sourceKey: "sinya_870-evo", sinyaName: "Samsung 870 EVO 4TB", active: true };
    const notifications = [{ id: 8, favoriteId: 4, title: "收藏商品降價", currentPrice: 8990 }];
    dbMocks.upsertFavoriteForUser.mockResolvedValue(favorite);
    dbMocks.listFavoritesForUser.mockResolvedValue([favorite]);
    dbMocks.listPriceNotificationsForUser.mockResolvedValue(notifications);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.favorites.save({ sourceKey: "sinya_870-evo", sinyaName: "Samsung 870 EVO 4TB" })).resolves.toEqual(favorite);
    await expect(caller.favorites.list()).resolves.toEqual([favorite]);
    await expect(caller.favorites.notifications()).resolves.toEqual(notifications);
    expect(dbMocks.upsertFavoriteForUser).toHaveBeenCalledWith(1, { sourceKey: "sinya_870-evo", sinyaName: "Samsung 870 EVO 4TB" });
  });
});
