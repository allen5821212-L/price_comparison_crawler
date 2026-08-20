import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  enqueueCrawlerCategoryJobs,
  deleteCoolpcCategoryRecrawlPreset,
  applyCoolpcCategoryRecrawlPreset,
  getCoolpcCategoryRecrawlPresetForUser,
  listCoolpcCategoryRecrawlPresetHistory,
  recordCoolpcCategoryRecrawlPresetHistory,
  reorderCoolpcCategoryRecrawlPresets,
  setCoolpcCategoryRecrawlPresetPinned,
  enqueueCrawlerJob,
  getCategoryRecrawlAnalytics,
  getCrawlerRefreshEstimates,
  getDynamicPriceHistory,
  getFavoriteForUser,
  getLatestCrawlerStatus,
  getLatestDynamicComparison,
  getCoolpcCoverageSummary,
  getSinyaCoverageSummary,
  exportSinyaUnlistedCoolpcProducts,
  getCrawlerIssueContext,
  listCoolpcUnlistedSinyaProducts,
  listSinyaUnlistedCoolpcProducts,
  listCoolpcCategoryRecrawlReminders,
  listCoolpcCategoryRecrawlPresets,
  listCrawlerEvents,
  listCrawlerJobs,
  listFavoritesForUser,
  listPriceNotificationsForUser,
  searchDynamicProducts,
  listActiveMatchingFeedback,
  listMatchingFeedbackForAdmin,
  markCrawlerEventsRead,
  upsertCrawlerIssueReport,
  markPriceNotificationsReadForUser,
  setMatchingFeedbackActive,
  setFavoriteActiveForUser,
  upsertMatchingFeedback,
  upsertFavoriteForUser,
  saveCoolpcCategoryRecrawlReminder,
  saveCoolpcCategoryRecrawlPreset,
  setCoolpcCategoryRecrawlReminderActive,
  acknowledgeCoolpcCategoryRecrawlReminder,
} from "./db";

function deriveModelAlias(name: string): string | null {
  const normalized = name
    .toUpperCase()
    .replace(/【[^】]*】/g, " ")
    .split(/[/(（〈]/)[0] || "";
  const codes = normalized.match(/\b(?=[A-Z0-9-]{4,}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g) || [];
  if (codes.length > 0) {
    return codes.sort((a, b) => b.length - a.length)[0] ?? null;
  }
  const series = normalized.match(/\b(?:ROG|TUF|STRIX|ISKUR|KATANA|THINKPAD|ELITEBOOK|IDEAPAD|NITRO|PREDATOR|PRIME|MORTAR)\s+[A-Z0-9-]+(?:\s+[A-Z0-9-]+)?\b/);
  return series?.[0] || null;
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  matchRules: router({
    /** The scheduled crawler reads only active mappings through this endpoint. */
    listForCrawler: publicProcedure.query(async () => listActiveMatchingFeedback()),
    /** Administrator management view includes disabled rules and crawler usage information. */
    listForAdmin: adminProcedure.query(async () => listMatchingFeedbackForAdmin()),
    setActive: adminProcedure.input(z.object({
      id: z.number().int().positive(),
      active: z.boolean(),
    })).mutation(async ({ input }) => {
      await setMatchingFeedbackActive(input.id, input.active);
      return { success: true } as const;
    }),
    /** Only the project administrator can feed an authoritative match into future crawls. */
    confirm: adminProcedure.input(z.object({
      sinyaName: z.string().min(1).max(512),
      targetName: z.string().min(1).max(512),
      targetId: z.string().max(255).optional(),
      platform: z.enum(["coolpc", "pchome", "momo"]),
    })).mutation(async ({ ctx, input }) => {
      const sourceAlias = deriveModelAlias(input.sinyaName);
      const targetAlias = deriveModelAlias(input.targetName);
      await upsertMatchingFeedback({
        ...input,
        sourceAlias,
        targetAlias,
        createdByOpenId: ctx.user.openId,
      });
      return { success: true, sourceAlias, targetAlias } as const;
    }),
  }),
  comparison: router({
    /** Public dynamic payload with server-side filtering, sorting, and page boundaries. */
    latest: publicProcedure.input(z.object({
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().min(10).max(100).default(25),
      search: z.string().max(200).optional(),
      category: z.string().max(512).optional(),
      coolpcCategory: z.string().max(512).optional(),
      cheaper: z.enum(["sinya", "coolpc", "pchome", "momo", "tie"]).optional(),
      score: z.enum(["high", "medium", "low"]).optional(),
      hasSpecDiff: z.boolean().optional(),
      sort: z.enum(["price_diff", "price_diff_abs", "sinya_price", "coolpc_price", "pchome_price", "momo_price", "name", "score", "best_price"]).default("price_diff"),
      order: z.enum(["asc", "desc"]).default("asc"),
    }).optional()).query(async ({ input }) => getLatestDynamicComparison(input ?? { page: 1, pageSize: 25 })),
    /** Limits manual-match lookup to one requested platform rather than returning the entire catalog. */
    searchProducts: publicProcedure.input(z.object({
      platform: z.enum(["coolpc", "pchome", "momo"]),
      query: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(50).optional(),
    })).query(async ({ input }) => searchDynamicProducts(input)),
    /** Database-backed history replaces price_history.json. */
    history: publicProcedure.query(async () => getDynamicPriceHistory()),
    /** Lightweight polling endpoint for crawler status and recent completion time. */
    status: publicProcedure.query(async () => getLatestCrawlerStatus()),
    /** Historical successful-job timing keeps refresh ETAs grounded in actual worker runs. */
    refreshEstimates: publicProcedure.query(async () => getCrawlerRefreshEstimates()),
    /** Conservative coverage: only accepted Sinya-to-CoolPC matches count as listed. */
    coolpcCoverage: publicProcedure.query(async () => getCoolpcCoverageSummary()),
    coolpcUnlisted: publicProcedure.input(z.object({
      category: z.string().min(1).max(512).optional(),
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().min(10).max(100).default(25),
    }).optional()).query(async ({ input }) => listCoolpcUnlistedSinyaProducts(input ?? { page: 1, pageSize: 25 })),
    /** Reverse conservative coverage: CoolPC products without an accepted Sinya match. */
    sinyaCoverage: publicProcedure.query(async () => getSinyaCoverageSummary()),
    sinyaUnlisted: publicProcedure.input(z.object({
      category: z.string().min(1).max(512).optional(),
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().min(10).max(100).default(25),
    }).optional()).query(async ({ input }) => listSinyaUnlistedCoolpcProducts(input ?? { page: 1, pageSize: 25 })),
    sinyaUnlistedExport: adminProcedure.input(z.object({ category: z.string().min(1).max(512).optional() }).optional())
      .query(async ({ input }) => exportSinyaUnlistedCoolpcProducts(input?.category)),
  }),
  crawler: router({
    /** Recent worker jobs and monitoring events are restricted to administrators. */
    jobs: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
      .query(async ({ input }) => listCrawlerJobs(input?.limit ?? 50)),
    events: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
      .query(async ({ input }) => listCrawlerEvents(input?.limit ?? 100)),
    issueContext: adminProcedure.input(z.object({ jobId: z.number().int().positive() }))
      .query(async ({ input }) => getCrawlerIssueContext(input.jobId)),
    recordIssueDraft: adminProcedure.input(z.object({
      jobId: z.number().int().positive(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      issueLabel: z.enum(["crawler", "data", "source"]),
      issueDraftUrl: z.string().url().max(8_000).refine(url => url.startsWith("https://github.com/allen5821212-L/price-comparison-crawler-issues/issues/new?"), "Issue 草稿網址不正確"),
      errorSummary: z.string().max(8_000).optional(),
    })).mutation(async ({ ctx, input }) => {
      const context = await getCrawlerIssueContext(input.jobId);
      if (!context) throw new Error("找不到爬蟲工作");
      if (context.job.status !== "failed") throw new Error("僅能回報失敗的爬蟲工作");
      return upsertCrawlerIssueReport({ ...input, createdByOpenId: ctx.user.openId });
    }),
    markEventsRead: adminProcedure.input(z.object({ ids: z.array(z.number().int().positive()).max(200) }))
      .mutation(async ({ input }) => {
        await markCrawlerEventsRead(input.ids);
        return { success: true } as const;
      }),
    /** A cloud worker claims queued work; the web process never runs the Python crawler inline. */
    enqueue: adminProcedure.input(z.object({
      scope: z.enum(["full", "category"]),
      categoryId: z.string().max(64).optional(),
      categoryName: z.string().min(1).max(512).optional(),
    }).superRefine((value, ctx) => {
      if (value.scope === "category" && !value.categoryName) {
        ctx.addIssue({ code: "custom", message: "指定分類重跑需要分類名稱", path: ["categoryName"] });
      }
    })).mutation(async ({ ctx, input }) => {
      return enqueueCrawlerJob({
        scope: input.scope,
        trigger: "manual",
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        requestedByOpenId: ctx.user.openId,
      });
    }),
    enqueueCategories: adminProcedure.input(z.object({
      categoryNames: z.array(z.string().min(1).max(512)).min(1).max(12),
    }).refine(value => new Set(value.categoryNames.map(name => name.trim())).size === value.categoryNames.length, "分類不可重複"))
      .mutation(async ({ ctx, input }) => enqueueCrawlerCategoryJobs({
        categoryNames: input.categoryNames,
        requestedByOpenId: ctx.user.openId,
      })),
    categoryRecrawlAnalytics: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(48).default(24) }).optional())
      .query(async ({ input }) => getCategoryRecrawlAnalytics(input?.limit ?? 24)),
    coolpcRecrawlPresets: adminProcedure.query(async ({ ctx }) => listCoolpcCategoryRecrawlPresets(ctx.user.id)),
    coolpcRecrawlPresetHistory: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(30).default(12) }).optional())
      .query(async ({ ctx, input }) => listCoolpcCategoryRecrawlPresetHistory(ctx.user.id, input?.limit ?? 12)),
    saveCoolpcRecrawlPreset: adminProcedure.input(z.object({
      name: z.string().min(1).max(64),
      categoryNames: z.array(z.string().min(1).max(512)).min(1).max(12),
    }).refine(value => new Set(value.categoryNames.map(name => name.trim())).size === value.categoryNames.length, "分類不可重複"))
      .mutation(async ({ ctx, input }) => saveCoolpcCategoryRecrawlPreset({ userId: ctx.user.id, ...input })),
    applyCoolpcRecrawlPreset: adminProcedure.input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => applyCoolpcCategoryRecrawlPreset(ctx.user.id, input.id)),
    setCoolpcRecrawlPresetPinned: adminProcedure.input(z.object({ id: z.number().int().positive(), pinned: z.boolean() }))
      .mutation(async ({ ctx, input }) => setCoolpcCategoryRecrawlPresetPinned(ctx.user.id, input.id, input.pinned)),
    reorderCoolpcRecrawlPresets: adminProcedure.input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) })
      .refine(value => new Set(value.ids).size === value.ids.length, "常用清單不可重複"))
      .mutation(async ({ ctx, input }) => reorderCoolpcCategoryRecrawlPresets(ctx.user.id, input.ids)),
    enqueueCoolpcRecrawlPreset: adminProcedure.input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const preset = await getCoolpcCategoryRecrawlPresetForUser(ctx.user.id, input.id);
        if (!preset) throw new Error("找不到可排入的常用清單");
        const categoryNames = JSON.parse(preset.categoryNames) as unknown;
        if (!Array.isArray(categoryNames) || !categoryNames.every(item => typeof item === "string")) throw new Error("常用清單資料格式不正確");
        const result = await enqueueCrawlerCategoryJobs({ categoryNames, requestedByOpenId: ctx.user.openId });
        await recordCoolpcCategoryRecrawlPresetHistory({
          userId: ctx.user.id,
          presetId: preset.id,
          action: "jobs_enqueued",
          categoryNames,
          jobIds: result.createdJobIds,
        });
        return { ...result, presetName: preset.name };
      }),
    deleteCoolpcRecrawlPreset: adminProcedure.input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => deleteCoolpcCategoryRecrawlPreset(ctx.user.id, input.id)),
    coolpcRecrawlReminders: adminProcedure.query(async ({ ctx }) => listCoolpcCategoryRecrawlReminders(ctx.user.id)),
    saveCoolpcRecrawlReminder: adminProcedure.input(z.object({ categoryName: z.string().min(1).max(512) }))
      .mutation(async ({ ctx, input }) => saveCoolpcCategoryRecrawlReminder({ userId: ctx.user.id, categoryName: input.categoryName })),
    setCoolpcRecrawlReminderActive: adminProcedure.input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
      .mutation(async ({ ctx, input }) => setCoolpcCategoryRecrawlReminderActive(ctx.user.id, input.id, input.active)),
    acknowledgeCoolpcRecrawlReminder: adminProcedure.input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => acknowledgeCoolpcCategoryRecrawlReminder(ctx.user.id, input.id)),
  }),
  favorites: router({
    list: protectedProcedure.query(async ({ ctx }) => listFavoritesForUser(ctx.user.id)),
    save: protectedProcedure.input(z.object({
      sourceKey: z.string().min(1).max(128),
      sinyaName: z.string().min(1).max(1024),
      targetPrice: z.number().int().positive().nullable().optional(),
    })).mutation(async ({ ctx, input }) => upsertFavoriteForUser(ctx.user.id, input)),
    get: protectedProcedure.input(z.object({ sourceKey: z.string().min(1).max(128) }))
      .query(async ({ ctx, input }) => getFavoriteForUser(ctx.user.id, input.sourceKey)),
    setActive: protectedProcedure.input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await setFavoriteActiveForUser(ctx.user.id, input.id, input.active);
        return { success: true } as const;
      }),
    notifications: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
      .query(async ({ ctx, input }) => listPriceNotificationsForUser(ctx.user.id, input?.limit ?? 100)),
    markNotificationsRead: protectedProcedure.input(z.object({ ids: z.array(z.number().int().positive()).max(200) }))
      .mutation(async ({ ctx, input }) => {
        await markPriceNotificationsReadForUser(ctx.user.id, input.ids);
        return { success: true } as const;
      }),
  }),
});

export type AppRouter = typeof appRouter;
