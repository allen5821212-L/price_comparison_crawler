import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import {
  getDynamicPriceHistory,
  getLatestCrawlerStatus,
  getLatestDynamicComparison,
  searchDynamicProducts,
  listActiveMatchingFeedback,
  listMatchingFeedbackForAdmin,
  setMatchingFeedbackActive,
  upsertMatchingFeedback,
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
  }),
});

export type AppRouter = typeof appRouter;
