import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  getDynamicPriceHistory: vi.fn(),
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
  markCrawlerEventsRead: vi.fn(),
  markPriceNotificationsReadForUser: vi.fn(),
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

  it("serves database-backed price history and crawler status through public queries", async () => {
    const history = [{ date: "2026-08-16", matched: [] }];
    const status = { id: 4, status: "completed", matchedTotal: 2008 };
    dbMocks.getDynamicPriceHistory.mockResolvedValue(history);
    dbMocks.getLatestCrawlerStatus.mockResolvedValue(status);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.comparison.history()).resolves.toEqual(history);
    await expect(caller.comparison.status()).resolves.toEqual(status);
  });

  it("lists monitoring data and queues a requested category for the persistent worker", async () => {
    dbMocks.listCrawlerJobs.mockResolvedValue([{ id: 21, status: "queued", scope: "category" }]);
    dbMocks.listCrawlerEvents.mockResolvedValue([{ id: 9, level: "error", title: "來源逾時" }]);
    dbMocks.enqueueCrawlerJob.mockResolvedValue(22);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.crawler.jobs()).resolves.toEqual([{ id: 21, status: "queued", scope: "category" }]);
    await expect(caller.crawler.events()).resolves.toEqual([{ id: 9, level: "error", title: "來源逾時" }]);
    await expect(caller.crawler.enqueue({ scope: "category", categoryName: "CPU 中央處理器" })).resolves.toEqual({ id: 22 });
    expect(dbMocks.enqueueCrawlerJob).toHaveBeenCalledWith({
      scope: "category", trigger: "manual", categoryId: undefined, categoryName: "CPU 中央處理器", requestedByOpenId: "owner-open-id",
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
