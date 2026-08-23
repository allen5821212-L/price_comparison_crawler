import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  enqueueCrawlerJob,
  getDynamicPriceHistory,
  getLatestListingAvailability,
  getFavoriteForUser,
  getLatestCrawlerStatus,
  getLatestDynamicComparison,
  listCrawlerEvents,
  listCrawlerJobs,
  listFavoritesForUser,
  listPriceNotificationsForUser,
  searchDynamicProducts,
  listActiveMatchingFeedback,
  listMatchingFeedbackForAdmin,
  markCrawlerEventsRead,
  markPriceNotificationsReadForUser,
  setMatchingFeedbackActive,
  setFavoriteActiveForUser,
  upsertMatchingFeedback,
  upsertFavoriteForUser,
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
    /** Small availability payload for the public listing-rate dashboard. */
    availability: publicProcedure.query(async () => getLatestListingAvailability()),
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
  }),
  crawler: router({
    /** Recent worker jobs and monitoring events are restricted to administrators. */
    jobs: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
      .query(async ({ input }) => listCrawlerJobs(input?.limit ?? 50)),
    events: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
      .query(async ({ input }) => listCrawlerEvents(input?.limit ?? 100)),
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
      const id = await enqueueCrawlerJob({
        scope: input.scope,
        trigger: "manual",
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        requestedByOpenId: ctx.user.openId,
      });
      return { id } as const;
    }),
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
