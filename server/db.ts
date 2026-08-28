import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  comparisonMatches,
  comparisonPriceHistory,
  comparisonProducts,
  comparisonRuns,
  coolpcCategoryRecrawlPresetHistory,
  coolpcCategoryRecrawlPresets,
  coolpcCategoryRecrawlPresetTemplateCollaborators,
  coolpcCategoryRecrawlPresetTemplates,
  coolpcCategoryRecrawlReminders,
  crawlerEvents,
  crawlerIssueReports,
  crawlerJobs,
  InsertUser,
  matchReviewActivityLogs,
  matchReviewAssignments,
  matchReviewEscalationSettings,
  matchReviewMentions,
  matchReviewNotificationSettings,
  matchReviewSkips,
  matchingFeedback,
  priceNotifications,
  productFavorites,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { buildListingAvailability, buildListingCategories } from "./listingAvailability";
import { filterAndSortReviewItems, summarizeReviewItems, type ReviewPlatform, type ReviewSeverity } from "./reviewQueue";
import { aggregateReviewQualityRows, summarizeReviewQuality } from "./reviewQuality";
import { selectEscalationRulesForRecipient } from "./reviewEscalations";
import { measureReviewHealthCheck, summarizeReviewHealth } from "./reviewHealth";
import { TtlCache } from "./ttlCache";

export type FeedbackPlatform = "coolpc" | "pchome" | "momo";

export interface MatchingFeedbackInput {
  sinyaName: string;
  targetName: string;
  targetId?: string | null;
  sourceAlias?: string | null;
  targetAlias?: string | null;
  platform: FeedbackPlatform;
  createdByOpenId: string;
  note?: string | null;
}

export interface MatchReviewSkipInput {
  sourceKey: string;
  fingerprint: string;
  createdByOpenId: string;
  note?: string | null;
}

export interface MatchReviewAssignmentInput {
  sourceKey: string;
  fingerprint: string;
  assigneeUserId: number;
  assignedByOpenId: string;
  dueAt: Date;
}

export interface MatchReviewNotificationSettingsInput {
  userId: number;
  mediumThreshold: number;
  highThreshold: number;
  criticalThreshold: number;
}

export interface MatchReviewActivityInput {
  sourceKey: string;
  fingerprint: string;
  authorUserId: number;
  message: string;
}

export interface MatchReviewHandoffInput extends MatchReviewActivityInput {
  assigneeUserId: number;
  assignedByOpenId: string;
  dueAt: Date;
}

export interface MatchReviewMentionCommentInput extends MatchReviewActivityInput {
  mentionedUserIds?: number[];
}

export interface MatchReviewEscalationSettingsInput {
  userId: number;
  escalationRecipientUserId?: number | null;
  active: boolean;
  escalateAfterMinutes: number;
  reminderIntervalMinutes: number;
}

const weeklyQualityReportCache = new TtlCache<Awaited<ReturnType<typeof buildWeeklyMatchQualityReport>>>(60_000);

export interface CrawlerJobInput {
  scope: "full" | "category";
  trigger: "scheduled" | "manual";
  requestedByOpenId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
}

export interface EnqueueCrawlerJobResult {
  id: number;
  created: boolean;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
}

export interface EnqueueCrawlerCategoryJobsResult {
  requestedCount: number;
  createdCategoryNames: string[];
  existingCategoryNames: string[];
  createdJobIds: number[];
  existingJobIds: number[];
}

export interface CoolpcCategoryRecrawlPresetInput {
  userId: number;
  name: string;
  categoryNames: string[];
}

export type CoolpcCategoryRecrawlPresetHistoryAction = "applied" | "jobs_enqueued";

export interface CoolpcCategoryRecrawlPresetHistoryInput {
  userId: number;
  presetId: number | null;
  action: CoolpcCategoryRecrawlPresetHistoryAction;
  categoryNames: string[];
  jobIds?: number[];
}

export type CategoryRecrawlMetricInput = {
  id: number;
  categoryName: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
};

export type CategoryRecrawlAnalytics = {
  sampleSize: number;
  completedCount: number;
  failedCount: number;
  successRate: number | null;
  averageDurationMs: number | null;
  points: Array<{
    id: number;
    categoryName: string;
    finishedAt: Date | string;
    durationMinutes: number;
    rollingSuccessRate: number;
    succeeded: boolean;
  }>;
};

export interface CrawlerRefreshEstimate {
  estimateMs: number | null;
  sampleSize: number;
  source: "scope_history" | "full_history_ratio" | "unavailable";
}

export interface FavoriteInput {
  sourceKey: string;
  sinyaName: string;
  targetPrice?: number | null;
}

export interface CoolpcCoverageCategory {
  category: string;
  sinyaTotal: number;
  coolpcListed: number;
  coolpcUnlisted: number;
  coverageRate: number;
}

export interface SinyaCoverageCategory {
  category: string;
  coolpcTotal: number;
  sinyaListed: number;
  sinyaUnlisted: number;
  coverageRate: number;
}

export type CrawlerIssueSeverity = "low" | "medium" | "high" | "critical";
export type CrawlerIssueLabel = "crawler" | "data" | "source";

export interface CrawlerIssueReportInput {
  jobId: number;
  severity: CrawlerIssueSeverity;
  issueLabel: CrawlerIssueLabel;
  issueDraftUrl: string;
  errorSummary?: string | null;
  createdByOpenId: string;
}

export interface CoolpcRecrawlReminderInput {
  userId: number;
  categoryName: string;
}

type PlatformCoverageProduct = {
  externalId: string;
  name: string;
  category: string | null;
  price: number;
  url: string | null;
  image: string | null;
};

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/** Store one authoritative target per Sinya product and platform. */
export async function upsertMatchingFeedback(input: MatchingFeedbackInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  await db.insert(matchingFeedback).values({
    sinyaName: input.sinyaName,
    targetName: input.targetName,
    targetId: input.targetId ?? null,
    sourceAlias: input.sourceAlias ?? null,
    targetAlias: input.targetAlias ?? null,
    platform: input.platform,
    createdByOpenId: input.createdByOpenId,
    active: true,
    note: input.note ?? null,
  }).onDuplicateKeyUpdate({
    set: {
      targetName: input.targetName,
      targetId: input.targetId ?? null,
      sourceAlias: input.sourceAlias ?? null,
      targetAlias: input.targetAlias ?? null,
      createdByOpenId: input.createdByOpenId,
      active: true,
      note: input.note ?? null,
    },
  });
}

/** Public, minimal crawler export that does not expose creator identity. */
export async function listActiveMatchingFeedback() {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    id: matchingFeedback.id,
    sinyaName: matchingFeedback.sinyaName,
    targetName: matchingFeedback.targetName,
    targetId: matchingFeedback.targetId,
    sourceAlias: matchingFeedback.sourceAlias,
    targetAlias: matchingFeedback.targetAlias,
    platform: matchingFeedback.platform,
    updatedAt: matchingFeedback.updatedAt,
  }).from(matchingFeedback).where(eq(matchingFeedback.active, true));
}

/** Administrator view of all synchronized rules, including inactive rows and usage metrics. */
export async function listMatchingFeedbackForAdmin() {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  return db.select({
    id: matchingFeedback.id,
    sinyaName: matchingFeedback.sinyaName,
    targetName: matchingFeedback.targetName,
    targetId: matchingFeedback.targetId,
    sourceAlias: matchingFeedback.sourceAlias,
    targetAlias: matchingFeedback.targetAlias,
    platform: matchingFeedback.platform,
    active: matchingFeedback.active,
    hitCount: matchingFeedback.hitCount,
    lastHitAt: matchingFeedback.lastHitAt,
    createdAt: matchingFeedback.createdAt,
    updatedAt: matchingFeedback.updatedAt,
  }).from(matchingFeedback).orderBy(desc(matchingFeedback.updatedAt));
}

export async function setMatchingFeedbackActive(id: number, active: boolean) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  await db.update(matchingFeedback).set({ active }).where(eq(matchingFeedback.id, id));
}

/** Increment usage counts for rules that were actually applied during one crawler run. */
export async function recordMatchingFeedbackUsage(ids: number[]) {
  const uniqueIds = Array.from(new Set(ids)).filter(id => Number.isInteger(id) && id > 0);
  if (uniqueIds.length === 0) return;

  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  await db.update(matchingFeedback).set({
    hitCount: sql`${matchingFeedback.hitCount} + 1`,
    lastHitAt: new Date(),
  }).where(inArray(matchingFeedback.id, uniqueIds));
}

type DynamicProduct = {
  source: string;
  id: string;
  name: string;
  subtitle: string;
  price: number;
  original_price: number | null;
  url: string;
  image: string;
  category: string;
};

function mapDynamicProduct(row: {
  platform: string;
  externalId: string;
  name: string;
  subtitle: string | null;
  price: number;
  originalPrice: number | null;
  url: string | null;
  image: string | null;
  category: string | null;
}): DynamicProduct {
  return {
    source: row.platform,
    id: row.externalId,
    name: row.name,
    subtitle: row.subtitle ?? "",
    price: row.price,
    original_price: row.originalPrice,
    url: row.url ?? "",
    image: row.image ?? "",
    category: row.category ?? "",
  };
}

export interface DynamicComparisonQuery {
  page: number;
  pageSize: number;
  search?: string;
  category?: string;
  coolpcCategory?: string;
  cheaper?: "sinya" | "coolpc" | "pchome" | "momo" | "tie";
  score?: "high" | "medium" | "low";
  hasSpecDiff?: boolean;
  sort?: "price_diff" | "price_diff_abs" | "sinya_price" | "coolpc_price" | "pchome_price" | "momo_price" | "name" | "score" | "best_price";
  order?: "asc" | "desc";
}

/** Latest completed run is the single source of truth for the public comparison page. */
export async function getLatestDynamicComparison(query: DynamicComparisonQuery = { page: 1, pageSize: 25 }) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  const [run] = await db.select().from(comparisonRuns)
    .where(eq(comparisonRuns.status, "completed"))
    .orderBy(desc(comparisonRuns.finishedAt), desc(comparisonRuns.id))
    .limit(1);
  if (!run) return null;

  const page = Math.max(1, query.page);
  const pageSize = Math.min(100, Math.max(10, query.pageSize));
  const conditions = [eq(comparisonMatches.runId, run.id)];
  const search = query.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(
      like(comparisonMatches.sinyaName, pattern),
      like(comparisonMatches.coolpcName, pattern),
      like(comparisonMatches.pchomeName, pattern),
      like(comparisonMatches.momoName, pattern),
    )!);
  }
  if (query.category) conditions.push(eq(comparisonMatches.category, query.category));
  if (query.coolpcCategory) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM comparison_products AS current_coolpc
      WHERE current_coolpc.last_seen_run_id = ${run.id}
        AND current_coolpc.platform = 'coolpc'
        AND current_coolpc.category = ${query.coolpcCategory}
        AND current_coolpc.name = ${comparisonMatches.coolpcName}
    )`);
  }
  if (query.cheaper) conditions.push(eq(comparisonMatches.cheaper, query.cheaper));
  if (query.score === "high") conditions.push(sql`${comparisonMatches.score} >= 0.85`);
  if (query.score === "medium") conditions.push(sql`${comparisonMatches.score} >= 0.70 AND ${comparisonMatches.score} < 0.85`);
  if (query.score === "low") conditions.push(sql`${comparisonMatches.score} < 0.70`);
  if (query.hasSpecDiff) conditions.push(eq(comparisonMatches.hasSpecDiff, true));
  const whereClause = and(...conditions);

  const sortExpression = {
    price_diff: comparisonMatches.priceDiff,
    price_diff_abs: sql`ABS(${comparisonMatches.priceDiff})`,
    sinya_price: comparisonMatches.sinyaPrice,
    coolpc_price: comparisonMatches.coolpcPrice,
    pchome_price: sql`COALESCE(${comparisonMatches.pchomePrice}, 2147483647)`,
    momo_price: sql`COALESCE(${comparisonMatches.momoPrice}, 2147483647)`,
    name: comparisonMatches.sinyaName,
    score: comparisonMatches.score,
    best_price: sql`LEAST(${comparisonMatches.sinyaPrice}, ${comparisonMatches.coolpcPrice}, COALESCE(${comparisonMatches.pchomePrice}, 2147483647), COALESCE(${comparisonMatches.momoPrice}, 2147483647))`,
  }[query.sort ?? "price_diff"];
  const orderBy = query.order === "desc" ? desc(sortExpression) : asc(sortExpression);

  const [matchRows, countRows, coolpcCategoryRows] = await Promise.all([
    db.select({ payload: comparisonMatches.payload }).from(comparisonMatches)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)` }).from(comparisonMatches).where(whereClause),
    db.select({
      name: comparisonProducts.category,
      count: sql<number>`count(*)`,
    }).from(comparisonProducts)
      .where(and(
        eq(comparisonProducts.lastSeenRunId, run.id),
        eq(comparisonProducts.platform, "coolpc"),
      ))
      .groupBy(comparisonProducts.category)
      .orderBy(desc(sql`count(*)`)),
  ]);

  const matched = matchRows.flatMap(row => {
    try {
      return [JSON.parse(row.payload)];
    } catch {
      return [];
    }
  });

  let sinyaCategories: string[] = [];
  try {
    sinyaCategories = run.sinyaCategories ? JSON.parse(run.sinyaCategories) : [];
  } catch {
    sinyaCategories = [];
  }

  return {
    stats: {
      update_time: (run.finishedAt ?? run.startedAt).toLocaleString("sv-SE", { hour12: false }),
      sinya_total: run.sinyaTotal,
      coolpc_total: run.coolpcTotal,
      pchome_total: run.pchomeTotal,
      momo_total: run.momoTotal,
      matched_total: run.matchedTotal,
      sinya_cheaper: run.sinyaCheaper,
      coolpc_cheaper: run.coolpcCheaper,
      pchome_cheaper: run.pchomeCheaper,
      momo_cheaper: run.momoCheaper,
      same_price: run.samePrice,
      avg_price_diff: Number(run.avgPriceDiff),
    },
    matched,
    sinya_categories: sinyaCategories,
    coolpc_categories: coolpcCategoryRows
      .filter(row => Boolean(row.name))
      .map(row => ({ name: row.name!, count: Number(row.count) })),
    pagination: {
      page,
      pageSize,
      total: Number(countRows[0]?.total ?? 0),
      totalPages: Math.max(1, Math.ceil(Number(countRows[0]?.total ?? 0) / pageSize)),
    },
    run: {
      id: run.id,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      status: run.status,
    },
  };
}

/**
 * Availability-first summary. A platform is counted as listed when a Sinya reference
 * item has a resolved current-run counterpart on that platform.
 */
export async function getLatestListingAvailability() {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  const [run] = await db.select().from(comparisonRuns)
    .where(eq(comparisonRuns.status, "completed"))
    .orderBy(desc(comparisonRuns.finishedAt), desc(comparisonRuns.id))
    .limit(1);
  if (!run) return null;

  const [listingRows, sourceCategoryRows, matchedCategoryRows] = await Promise.all([
    db.select({
      coolpcCount: sql<number>`SUM(CASE WHEN ${comparisonMatches.coolpcName} IS NOT NULL THEN 1 ELSE 0 END)`,
      pchomeCount: sql<number>`SUM(CASE WHEN ${comparisonMatches.pchomeName} IS NOT NULL THEN 1 ELSE 0 END)`,
      momoCount: sql<number>`SUM(CASE WHEN ${comparisonMatches.momoName} IS NOT NULL THEN 1 ELSE 0 END)`,
      allPlatformsCount: sql<number>`SUM(CASE WHEN ${comparisonMatches.coolpcName} IS NOT NULL AND ${comparisonMatches.pchomeName} IS NOT NULL AND ${comparisonMatches.momoName} IS NOT NULL THEN 1 ELSE 0 END)`,
    }).from(comparisonMatches).where(eq(comparisonMatches.runId, run.id)),
    db.select({
      category: comparisonProducts.category,
      sourceCount: sql<number>`COUNT(*)`,
    }).from(comparisonProducts)
      .where(and(
        eq(comparisonProducts.lastSeenRunId, run.id),
        eq(comparisonProducts.platform, "sinya"),
      ))
      .groupBy(comparisonProducts.category)
      .orderBy(asc(comparisonProducts.category)),
    db.select({
      category: comparisonMatches.category,
      coolpcCount: sql<number>`SUM(CASE WHEN ${comparisonMatches.coolpcName} IS NOT NULL THEN 1 ELSE 0 END)`,
      pchomeCount: sql<number>`SUM(CASE WHEN ${comparisonMatches.pchomeName} IS NOT NULL THEN 1 ELSE 0 END)`,
      momoCount: sql<number>`SUM(CASE WHEN ${comparisonMatches.momoName} IS NOT NULL THEN 1 ELSE 0 END)`,
    }).from(comparisonMatches)
      .where(eq(comparisonMatches.runId, run.id))
      .groupBy(comparisonMatches.category),
  ]);

  const listingCounts = listingRows[0] ?? { coolpcCount: 0, pchomeCount: 0, momoCount: 0, allPlatformsCount: 0 };
  const summary = buildListingAvailability({
    sourceTotal: run.sinyaTotal,
    catalogTotals: {
      sinya: run.sinyaTotal,
      coolpc: run.coolpcTotal,
      pchome: run.pchomeTotal,
      momo: run.momoTotal,
    },
    listedCounts: {
      sinya: run.sinyaTotal,
      coolpc: Number(listingCounts.coolpcCount ?? 0),
      pchome: Number(listingCounts.pchomeCount ?? 0),
      momo: Number(listingCounts.momoCount ?? 0),
    },
    allPlatformsListedCount: Number(listingCounts.allPlatformsCount ?? 0),
  });

  return {
    ...summary,
    categories: buildListingCategories(sourceCategoryRows, matchedCategoryRows),
    updateTime: (run.finishedAt ?? run.startedAt).toLocaleString("sv-SE", { hour12: false }),
    run: {
      id: run.id,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      status: run.status,
    },
  };
}

/** Searches only the active platform catalog needed by the manual-match dialog. */
export async function searchDynamicProducts(input: {
  platform: "sinya" | "coolpc" | "pchome" | "momo";
  query: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  const [run] = await db.select({ id: comparisonRuns.id }).from(comparisonRuns)
    .where(eq(comparisonRuns.status, "completed"))
    .orderBy(desc(comparisonRuns.finishedAt), desc(comparisonRuns.id))
    .limit(1);
  if (!run) return [];

  const query = input.query.trim();
  if (!query) return [];
  const pattern = `%${query}%`;
  const rows = await db.select({
    platform: comparisonProducts.platform,
    externalId: comparisonProducts.externalId,
    name: comparisonProducts.name,
    subtitle: comparisonProducts.subtitle,
    price: comparisonProducts.price,
    originalPrice: comparisonProducts.originalPrice,
    url: comparisonProducts.url,
    image: comparisonProducts.image,
    category: comparisonProducts.category,
  }).from(comparisonProducts)
    .where(and(
      eq(comparisonProducts.lastSeenRunId, run.id),
      eq(comparisonProducts.platform, input.platform),
      sql`${comparisonProducts.price} > 0`,
      or(like(comparisonProducts.name, pattern), like(comparisonProducts.subtitle, pattern))!,
    ))
    .orderBy(asc(comparisonProducts.name))
    .limit(Math.min(50, Math.max(1, input.limit ?? 50)));

  return rows.map(mapDynamicProduct);
}

export async function getLatestMatchReviewQueue(input: {
  page: number;
  pageSize: number;
  severity?: ReviewSeverity;
  platform?: ReviewPlatform;
  search?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  const [run] = await db.select({ id: comparisonRuns.id, finishedAt: comparisonRuns.finishedAt, startedAt: comparisonRuns.startedAt })
    .from(comparisonRuns)
    .where(eq(comparisonRuns.status, "completed"))
    .orderBy(desc(comparisonRuns.finishedAt), desc(comparisonRuns.id))
    .limit(1);
  if (!run) return { run: null, total: 0, page: input.page, pageSize: input.pageSize, totalPages: 0, summary: summarizeReviewItems([]), items: [] };

  const rows = await db.select({
    id: comparisonMatches.id,
    sourceKey: comparisonMatches.sourceKey,
    sinyaName: comparisonMatches.sinyaName,
    category: comparisonMatches.category,
    sinyaPrice: comparisonMatches.sinyaPrice,
    coolpcName: comparisonMatches.coolpcName,
    coolpcPrice: comparisonMatches.coolpcPrice,
    pchomeName: comparisonMatches.pchomeName,
    pchomePrice: comparisonMatches.pchomePrice,
    momoName: comparisonMatches.momoName,
    momoPrice: comparisonMatches.momoPrice,
    score: comparisonMatches.score,
    hasSpecDiff: comparisonMatches.hasSpecDiff,
  }).from(comparisonMatches)
    .where(eq(comparisonMatches.runId, run.id));

  const [skippedRows, assignmentRows, assignees] = await Promise.all([
    db.select({ fingerprint: matchReviewSkips.fingerprint }).from(matchReviewSkips),
    db.select().from(matchReviewAssignments),
    db.select({ id: users.id, openId: users.openId, name: users.name, email: users.email }).from(users).where(eq(users.role, "admin")),
  ]);
  const resolvedAssignmentKeys = new Set(assignmentRows.filter(row => row.status === "resolved").map(row => `${row.sourceKey}:${row.fingerprint}`));
  const activeAssignments = new Map(assignmentRows.filter(row => row.status === "assigned").map(row => [`${row.sourceKey}:${row.fingerprint}`, row]));
  const assigneeById = new Map(assignees.map(user => [user.id, user]));
  const candidates = filterAndSortReviewItems(rows, {
    ...input,
    skippedFingerprints: new Set(skippedRows.map(row => row.fingerprint)),
  }).filter(item => !resolvedAssignmentKeys.has(`${item.sourceKey}:${item.fingerprint}`));
  const total = candidates.length;
  const pageSize = Math.min(100, Math.max(10, input.pageSize));
  const totalPages = Math.ceil(total / pageSize);
  const page = Math.min(Math.max(1, input.page), Math.max(1, totalPages));
  return {
    run: { id: run.id, finishedAt: run.finishedAt ?? run.startedAt },
    total,
    page,
    pageSize,
    totalPages,
    summary: summarizeReviewItems(candidates),
    items: candidates.slice((page - 1) * pageSize, page * pageSize).map(item => {
      const assignment = activeAssignments.get(`${item.sourceKey}:${item.fingerprint}`);
      const assignee = assignment ? assigneeById.get(assignment.assigneeUserId) : null;
      return {
        ...item,
        assignment: assignment ? {
          id: assignment.id,
          assigneeUserId: assignment.assigneeUserId,
          assigneeName: assignee?.name || assignee?.email || `管理員 #${assignment.assigneeUserId}`,
          dueAt: assignment.dueAt,
          isOverdue: assignment.dueAt.getTime() < Date.now(),
        } : null,
      };
    }),
  };
}

/** Small admin payload suitable for frequent UI polling and alert badges. */
export async function getLatestMatchReviewSummary() {
  const queue = await getLatestMatchReviewQueue({ page: 1, pageSize: 10 });
  return { run: queue.run, ...queue.summary };
}

export async function listReviewAssignees() {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  return db.select({ id: users.id, name: users.name, email: users.email, openId: users.openId })
    .from(users)
    .where(eq(users.role, "admin"))
    .orderBy(asc(users.name), asc(users.email));
}

export async function upsertMatchReviewAssignment(input: MatchReviewAssignmentInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.insert(matchReviewAssignments).values({
    sourceKey: input.sourceKey,
    fingerprint: input.fingerprint,
    assigneeUserId: input.assigneeUserId,
    assignedByOpenId: input.assignedByOpenId,
    dueAt: input.dueAt,
    status: "assigned",
    resolvedAt: null,
  }).onDuplicateKeyUpdate({
    set: {
      assigneeUserId: input.assigneeUserId,
      assignedByOpenId: input.assignedByOpenId,
      dueAt: input.dueAt,
      status: "assigned",
      resolvedAt: null,
    },
  });
}

export async function resolveMatchReviewAssignment(input: {
  sourceKey: string;
  fingerprint: string;
  assigneeUserId: number;
  assignedByOpenId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const now = new Date();
  await db.insert(matchReviewAssignments).values({
    sourceKey: input.sourceKey,
    fingerprint: input.fingerprint,
    assigneeUserId: input.assigneeUserId,
    assignedByOpenId: input.assignedByOpenId,
    dueAt: now,
    status: "resolved",
    resolvedAt: now,
  }).onDuplicateKeyUpdate({
    set: { status: "resolved", resolvedAt: now },
  });
}

export async function listMatchReviewActivity(sourceKey: string, fingerprint: string) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  return db.select().from(matchReviewActivityLogs)
    .where(and(eq(matchReviewActivityLogs.sourceKey, sourceKey), eq(matchReviewActivityLogs.fingerprint, fingerprint)))
    .orderBy(desc(matchReviewActivityLogs.createdAt));
}

export async function addMatchReviewComment(input: MatchReviewMentionCommentInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const result = await db.insert(matchReviewActivityLogs).values({
    sourceKey: input.sourceKey,
    fingerprint: input.fingerprint,
    type: "comment",
    authorUserId: input.authorUserId,
    message: input.message,
  });
  const activityLogId = Number((result as unknown as Array<{ insertId?: number }>)[0]?.insertId ?? 0);
  const mentionedUserIds = Array.from(new Set(input.mentionedUserIds ?? []))
    .filter(userId => Number.isInteger(userId) && userId > 0 && userId !== input.authorUserId);
  if (activityLogId > 0 && mentionedUserIds.length > 0) {
    await db.insert(matchReviewMentions).values(mentionedUserIds.map(mentionedUserId => ({ activityLogId, mentionedUserId })));
  }
  return { activityLogId, mentionedUserIds };
}

export async function listUnreadMatchReviewMentions(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  return db.select({
    id: matchReviewMentions.id,
    activityLogId: matchReviewMentions.activityLogId,
    sourceKey: matchReviewActivityLogs.sourceKey,
    fingerprint: matchReviewActivityLogs.fingerprint,
    message: matchReviewActivityLogs.message,
    authorUserId: matchReviewActivityLogs.authorUserId,
    createdAt: matchReviewMentions.createdAt,
  }).from(matchReviewMentions)
    .innerJoin(matchReviewActivityLogs, eq(matchReviewMentions.activityLogId, matchReviewActivityLogs.id))
    .where(and(eq(matchReviewMentions.mentionedUserId, userId), isNull(matchReviewMentions.readAt)))
    .orderBy(desc(matchReviewMentions.createdAt))
    .limit(20);
}

export async function markMatchReviewMentionsRead(userId: number, mentionIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const ids = Array.from(new Set(mentionIds)).filter(id => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return;
  await db.update(matchReviewMentions).set({ readAt: new Date() })
    .where(and(eq(matchReviewMentions.mentionedUserId, userId), inArray(matchReviewMentions.id, ids)));
}

export async function handoffMatchReview(input: MatchReviewHandoffInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [existing] = await db.select().from(matchReviewAssignments)
    .where(and(eq(matchReviewAssignments.sourceKey, input.sourceKey), eq(matchReviewAssignments.fingerprint, input.fingerprint)))
    .limit(1);
  await upsertMatchReviewAssignment({
    sourceKey: input.sourceKey,
    fingerprint: input.fingerprint,
    assigneeUserId: input.assigneeUserId,
    assignedByOpenId: input.assignedByOpenId,
    dueAt: input.dueAt,
  });
  await db.insert(matchReviewActivityLogs).values({
    sourceKey: input.sourceKey,
    fingerprint: input.fingerprint,
    type: "handoff",
    authorUserId: input.authorUserId,
    fromUserId: existing?.assigneeUserId ?? null,
    toUserId: input.assigneeUserId,
    message: input.message,
  });
}

export async function bulkReassignOverdueMatchReviews(input: {
  assigneeUserId: number;
  assignedByOpenId: string;
  authorUserId: number;
  dueAt: Date;
  message: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const now = new Date();
  const overdueAssignments = await db.select().from(matchReviewAssignments)
    .where(and(eq(matchReviewAssignments.status, "assigned"), lt(matchReviewAssignments.dueAt, now)));
  await Promise.all(overdueAssignments.map(async assignment => {
    await db.update(matchReviewAssignments).set({
      assigneeUserId: input.assigneeUserId,
      assignedByOpenId: input.assignedByOpenId,
      dueAt: input.dueAt,
    }).where(eq(matchReviewAssignments.id, assignment.id));
    await db.insert(matchReviewActivityLogs).values({
      sourceKey: assignment.sourceKey,
      fingerprint: assignment.fingerprint,
      type: "handoff",
      authorUserId: input.authorUserId,
      fromUserId: assignment.assigneeUserId,
      toUserId: input.assigneeUserId,
      message: input.message,
    });
  }));
  return { count: overdueAssignments.length };
}

export async function getMatchReviewNotificationSettings(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [settings] = await db.select().from(matchReviewNotificationSettings)
    .where(eq(matchReviewNotificationSettings.userId, userId)).limit(1);
  return settings ?? { userId, mediumThreshold: 0, highThreshold: 1, criticalThreshold: 1 };
}

export async function upsertMatchReviewNotificationSettings(input: MatchReviewNotificationSettingsInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.insert(matchReviewNotificationSettings).values(input).onDuplicateKeyUpdate({
    set: {
      mediumThreshold: input.mediumThreshold,
      highThreshold: input.highThreshold,
      criticalThreshold: input.criticalThreshold,
    },
  });
}

export async function getMatchReviewEscalationSettings(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [settings] = await db.select().from(matchReviewEscalationSettings)
    .where(eq(matchReviewEscalationSettings.userId, userId)).limit(1);
  return settings ?? { userId, escalationRecipientUserId: null, active: true, escalateAfterMinutes: 60, reminderIntervalMinutes: 30 };
}

export async function upsertMatchReviewEscalationSettings(input: MatchReviewEscalationSettingsInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.insert(matchReviewEscalationSettings).values(input).onDuplicateKeyUpdate({
    set: {
      escalationRecipientUserId: input.escalationRecipientUserId ?? null,
      active: input.active,
      escalateAfterMinutes: input.escalateAfterMinutes,
      reminderIntervalMinutes: input.reminderIntervalMinutes,
    },
  });
}

export type OverdueEscalationSetting = {
  userId: number;
  escalationRecipientUserId: number | null;
  active: boolean;
  escalateAfterMinutes: number;
  reminderIntervalMinutes: number;
};

export type OverdueEscalationAssignment = {
  sourceKey: string;
  fingerprint: string;
  dueAt: Date;
};

export type OverdueEscalationQueryStore = {
  listActiveSettings: () => Promise<OverdueEscalationSetting[]>;
  listOverdueAssignments: (assigneeUserId: number, cutoff: Date) => Promise<OverdueEscalationAssignment[]>;
};

/** Checks assignments monitored by this administrator, including work explicitly escalated to them. */
export async function getMyOverdueMatchReviewEscalations(userId: number, testStore?: OverdueEscalationQueryStore) {
  const db = testStore ? null : await getDb();
  if (!testStore && !db) throw new Error("資料庫目前無法使用");
  const store: OverdueEscalationQueryStore = testStore ?? {
    listActiveSettings: async () => db!.select().from(matchReviewEscalationSettings).where(eq(matchReviewEscalationSettings.active, true)),
    listOverdueAssignments: async (assigneeUserId, cutoff) => db!.select({
      sourceKey: matchReviewAssignments.sourceKey,
      fingerprint: matchReviewAssignments.fingerprint,
      dueAt: matchReviewAssignments.dueAt,
    }).from(matchReviewAssignments)
      .where(and(
        eq(matchReviewAssignments.assigneeUserId, assigneeUserId),
        eq(matchReviewAssignments.status, "assigned"),
        lt(matchReviewAssignments.dueAt, cutoff),
      ))
      .orderBy(asc(matchReviewAssignments.dueAt))
      .limit(20),
  };
  const monitoredSettings = selectEscalationRulesForRecipient(await store.listActiveSettings(), userId);
  if (monitoredSettings.length === 0) return { active: false, reminderIntervalMinutes: 30, total: 0, items: [] };
  const batches = await Promise.all(monitoredSettings.map(async setting => {
    const cutoff = new Date(Date.now() - setting.escalateAfterMinutes * 60 * 1000);
    const items = await store.listOverdueAssignments(setting.userId, cutoff);
    return items.map(item => ({ ...item, ownerUserId: setting.userId, escalateAfterMinutes: setting.escalateAfterMinutes }));
  }));
  const items = batches.flat().sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime()).slice(0, 20);
  return {
    active: true,
    reminderIntervalMinutes: Math.min(...monitoredSettings.map(setting => setting.reminderIntervalMinutes)),
    total: items.length,
    items,
  };
}

/** Seven-day auto-match quality indicator. It is a transparent quality proxy, not a human-verified accuracy claim. */
async function buildWeeklyMatchQualityReport() {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await db.select({
    createdAt: comparisonMatches.createdAt,
    score: comparisonMatches.score,
    hasSpecDiff: comparisonMatches.hasSpecDiff,
    category: comparisonMatches.category,
  }).from(comparisonMatches)
    .where(gte(comparisonMatches.createdAt, start));
  const { days, riskSources } = aggregateReviewQualityRows(rows);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    summary: summarizeReviewQuality(days),
    days,
    riskSources: riskSources.slice(0, 10),
  };
}

/** Uses a short per-instance cache so frequent dashboard reads do not repeat the weekly aggregation query. */
export async function getWeeklyMatchQualityReport() {
  const { value, cache } = await weeklyQualityReportCache.get(buildWeeklyMatchQualityReport);
  return { ...value, cache };
}

/** Checks the read dependencies most critical to the review workspace without failing the whole dashboard. */
export async function getReviewApiHealth() {
  const checks = await Promise.all([
    measureReviewHealthCheck("review-queue", "待審核佇列", async () => {
      await getLatestMatchReviewSummary();
    }),
    measureReviewHealthCheck("review-activity", "評論與交接紀錄", async () => {
      const db = await getDb();
      if (!db) throw new Error("資料庫目前無法使用");
      await db.select({ id: matchReviewActivityLogs.id }).from(matchReviewActivityLogs).limit(1);
    }),
    measureReviewHealthCheck("weekly-quality", "週品質報表", async () => {
      await getWeeklyMatchQualityReport();
    }),
  ]);
  return { checkedAt: new Date().toISOString(), ...summarizeReviewHealth(checks) };
}

export async function saveMatchReviewSkip(input: MatchReviewSkipInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  await db.insert(matchReviewSkips).values({
    sourceKey: input.sourceKey,
    fingerprint: input.fingerprint,
    createdByOpenId: input.createdByOpenId,
    note: input.note ?? null,
  }).onDuplicateKeyUpdate({
    set: {
      createdByOpenId: input.createdByOpenId,
      note: input.note ?? null,
    },
  });
}

/** Dynamic four-platform history grouped into the current dialog's day-based response shape. */
export async function getDynamicPriceHistory() {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  const rows = await db.select({
    snapshotDate: comparisonPriceHistory.snapshotDate,
    sourceKey: comparisonPriceHistory.sourceKey,
    sinyaName: comparisonPriceHistory.sinyaName,
    coolpcName: comparisonPriceHistory.coolpcName,
    pchomeName: comparisonPriceHistory.pchomeName,
    momoName: comparisonPriceHistory.momoName,
    sinyaPrice: comparisonPriceHistory.sinyaPrice,
    coolpcPrice: comparisonPriceHistory.coolpcPrice,
    pchomePrice: comparisonPriceHistory.pchomePrice,
    momoPrice: comparisonPriceHistory.momoPrice,
    priceDiff: comparisonPriceHistory.priceDiff,
  }).from(comparisonPriceHistory)
    .orderBy(comparisonPriceHistory.snapshotDate, comparisonPriceHistory.sourceKey);

  const days = new Map<string, { date: string; matched: unknown[] }>();
  rows.forEach(row => {
    const date = row.snapshotDate instanceof Date
      ? row.snapshotDate.toISOString().slice(0, 10)
      : String(row.snapshotDate).slice(0, 10);
    const day = days.get(date) ?? { date, matched: [] };
    day.matched.push({
      source_key: row.sourceKey,
      sinya_name: row.sinyaName,
      coolpc_name: row.coolpcName,
      pchome_name: row.pchomeName,
      momo_name: row.momoName,
      sinya_price: row.sinyaPrice,
      coolpc_price: row.coolpcPrice,
      pchome_price: row.pchomePrice,
      momo_price: row.momoPrice,
      price_diff: row.priceDiff,
    });
    days.set(date, day);
  });
  return Array.from(days.values());
}

/** Status is deliberately small so the UI can refresh it without loading the catalog. */
export async function getLatestCrawlerStatus() {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [latestRun] = await db.select().from(comparisonRuns)
    .orderBy(desc(comparisonRuns.id)).limit(1);
  const [latestCompletedRun] = await db.select().from(comparisonRuns)
    .where(eq(comparisonRuns.status, "completed"))
    .orderBy(desc(comparisonRuns.id)).limit(1);
  return {
    latestRun: latestRun ?? null,
    latestCompletedRun: latestCompletedRun ?? null,
  };
}

/**
 * Estimate a job duration from actual successful worker history. Categories
 * fall back to a quarter of the measured full-refresh average only until the
 * system has completed category-specific jobs to learn from.
 */
export async function getCrawlerRefreshEstimates(): Promise<Record<"full" | "category", CrawlerRefreshEstimate>> {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  const rows = await db.select({
    scope: crawlerJobs.scope,
    startedAt: crawlerJobs.startedAt,
    finishedAt: crawlerJobs.finishedAt,
  }).from(crawlerJobs)
    .where(and(
      eq(crawlerJobs.status, "completed"),
      isNotNull(crawlerJobs.startedAt),
      isNotNull(crawlerJobs.finishedAt),
    ))
    .orderBy(desc(crawlerJobs.finishedAt), desc(crawlerJobs.id))
    .limit(40);

  const durations = { full: [] as number[], category: [] as number[] };
  rows.forEach(row => {
    if (!row.startedAt || !row.finishedAt) return;
    const startedAt = new Date(row.startedAt).getTime();
    const finishedAt = new Date(row.finishedAt).getTime();
    const durationMs = finishedAt - startedAt;
    // Ignore clock-skew and clearly abnormal jobs so one bad record cannot
    // make the user-facing estimate misleading.
    if (durationMs >= 60_000 && durationMs <= 12 * 60 * 60_000) {
      durations[row.scope].push(durationMs);
    }
  });

  const average = (values: number[]) => values.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
    : null;
  const fullEstimateMs = average(durations.full);
  const categoryEstimateMs = average(durations.category);

  return {
    full: {
      estimateMs: fullEstimateMs,
      sampleSize: durations.full.length,
      source: fullEstimateMs ? "scope_history" : "unavailable",
    },
    category: categoryEstimateMs
      ? { estimateMs: categoryEstimateMs, sampleSize: durations.category.length, source: "scope_history" }
      : fullEstimateMs
        ? { estimateMs: Math.round(fullEstimateMs / 4), sampleSize: durations.full.length, source: "full_history_ratio" }
        : { estimateMs: null, sampleSize: 0, source: "unavailable" },
  };
}

export function deriveCoolpcCoverage(products: PlatformCoverageProduct[], coolpcListedNames: Set<string>) {
  const grouped = new Map<string, { sinyaTotal: number; coolpcListed: number }>();
  for (const product of products) {
    const category = product.category?.trim() || "未分類";
    const current = grouped.get(category) ?? { sinyaTotal: 0, coolpcListed: 0 };
    current.sinyaTotal += 1;
    if (coolpcListedNames.has(product.name)) current.coolpcListed += 1;
    grouped.set(category, current);
  }

  const categories: CoolpcCoverageCategory[] = Array.from(grouped.entries()).map(([category, totals]) => ({
    category,
    sinyaTotal: totals.sinyaTotal,
    coolpcListed: totals.coolpcListed,
    coolpcUnlisted: totals.sinyaTotal - totals.coolpcListed,
    coverageRate: totals.sinyaTotal ? totals.coolpcListed / totals.sinyaTotal : 0,
  })).sort((left, right) => right.sinyaTotal - left.sinyaTotal || left.category.localeCompare(right.category, "zh-TW"));

  const sinyaTotal = products.length;
  const coolpcListed = categories.reduce((sum, category) => sum + category.coolpcListed, 0);
  return {
    sinyaTotal,
    coolpcListed,
    coolpcUnlisted: sinyaTotal - coolpcListed,
    coverageRate: sinyaTotal ? coolpcListed / sinyaTotal : 0,
    categories,
  };
}

async function getLatestCoolpcCoverageSource() {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [run] = await db.select({ id: comparisonRuns.id, finishedAt: comparisonRuns.finishedAt })
    .from(comparisonRuns)
    .where(eq(comparisonRuns.status, "completed"))
    .orderBy(desc(comparisonRuns.finishedAt), desc(comparisonRuns.id))
    .limit(1);
  if (!run) return null;

  const [sinyaProducts, listedMatches] = await Promise.all([
    db.select({
      externalId: comparisonProducts.externalId,
      name: comparisonProducts.name,
      category: comparisonProducts.category,
      price: comparisonProducts.price,
      url: comparisonProducts.url,
      image: comparisonProducts.image,
    }).from(comparisonProducts).where(and(
      eq(comparisonProducts.lastSeenRunId, run.id),
      eq(comparisonProducts.platform, "sinya"),
    )),
    db.select({ sinyaName: comparisonMatches.sinyaName }).from(comparisonMatches).where(and(
      eq(comparisonMatches.runId, run.id),
      isNotNull(comparisonMatches.coolpcName),
      sql`${comparisonMatches.coolpcName} <> ''`,
    )),
  ]);

  return {
    run,
    sinyaProducts,
    coolpcListedNames: new Set(listedMatches.map(match => match.sinyaName)),
  };
}

/** Reports only names with an accepted CoolPC match, preserving the conservative no-false-positive policy. */
export async function getCoolpcCoverageSummary() {
  const source = await getLatestCoolpcCoverageSource();
  if (!source) return null;
  return {
    run: source.run,
    ...deriveCoolpcCoverage(source.sinyaProducts, source.coolpcListedNames),
  };
}

export async function listCoolpcUnlistedSinyaProducts(input: { category?: string; page?: number; pageSize?: number }) {
  const source = await getLatestCoolpcCoverageSource();
  if (!source) return null;
  const category = input.category?.trim();
  const items = source.sinyaProducts
    .filter(product => !source.coolpcListedNames.has(product.name))
    .filter(product => !category || (product.category?.trim() || "未分類") === category)
    .sort((left, right) => (left.category ?? "未分類").localeCompare(right.category ?? "未分類", "zh-TW") || left.name.localeCompare(right.name, "zh-TW"));
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, input.pageSize ?? 25));
  return {
    run: source.run,
    total: items.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
    items: items.slice((page - 1) * pageSize, page * pageSize).map(product => ({
      externalId: product.externalId,
      name: product.name,
      category: product.category?.trim() || "未分類",
      price: product.price,
      url: product.url ?? "",
      image: product.image ?? "",
    })),
  };
}

export function deriveSinyaCoverage(products: PlatformCoverageProduct[], sinyaListedNames: Set<string>) {
  const grouped = new Map<string, { coolpcTotal: number; sinyaListed: number }>();
  for (const product of products) {
    const category = product.category?.trim() || "未分類";
    const current = grouped.get(category) ?? { coolpcTotal: 0, sinyaListed: 0 };
    current.coolpcTotal += 1;
    if (sinyaListedNames.has(product.name)) current.sinyaListed += 1;
    grouped.set(category, current);
  }
  const categories: SinyaCoverageCategory[] = Array.from(grouped.entries()).map(([category, totals]) => ({
    category,
    coolpcTotal: totals.coolpcTotal,
    sinyaListed: totals.sinyaListed,
    sinyaUnlisted: totals.coolpcTotal - totals.sinyaListed,
    coverageRate: totals.coolpcTotal ? totals.sinyaListed / totals.coolpcTotal : 0,
  })).sort((left, right) => right.coolpcTotal - left.coolpcTotal || left.category.localeCompare(right.category, "zh-TW"));
  const coolpcTotal = products.length;
  const sinyaListed = categories.reduce((sum, category) => sum + category.sinyaListed, 0);
  return {
    coolpcTotal,
    sinyaListed,
    sinyaUnlisted: coolpcTotal - sinyaListed,
    coverageRate: coolpcTotal ? sinyaListed / coolpcTotal : 0,
    categories,
  };
}

async function getLatestSinyaCoverageSource() {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [run] = await db.select({ id: comparisonRuns.id, finishedAt: comparisonRuns.finishedAt })
    .from(comparisonRuns)
    .where(eq(comparisonRuns.status, "completed"))
    .orderBy(desc(comparisonRuns.finishedAt), desc(comparisonRuns.id))
    .limit(1);
  if (!run) return null;
  const [coolpcProducts, listedMatches] = await Promise.all([
    db.select({
      externalId: comparisonProducts.externalId,
      name: comparisonProducts.name,
      category: comparisonProducts.category,
      price: comparisonProducts.price,
      url: comparisonProducts.url,
      image: comparisonProducts.image,
    }).from(comparisonProducts).where(and(
      eq(comparisonProducts.lastSeenRunId, run.id),
      eq(comparisonProducts.platform, "coolpc"),
    )),
    db.select({ coolpcName: comparisonMatches.coolpcName }).from(comparisonMatches).where(and(
      eq(comparisonMatches.runId, run.id),
      isNotNull(comparisonMatches.sinyaName),
      sql`${comparisonMatches.sinyaName} <> ''`,
    )),
  ]);
  return { run, coolpcProducts, sinyaListedNames: new Set(listedMatches.map(match => match.coolpcName).filter((name): name is string => Boolean(name))) };
}

/** Reverse conservative coverage: CoolPC products without an accepted Sinya match. */
export async function getSinyaCoverageSummary() {
  const source = await getLatestSinyaCoverageSource();
  if (!source) return null;
  return { run: source.run, ...deriveSinyaCoverage(source.coolpcProducts, source.sinyaListedNames) };
}

export async function listSinyaUnlistedCoolpcProducts(input: { category?: string; page?: number; pageSize?: number }) {
  const source = await getLatestSinyaCoverageSource();
  if (!source) return null;
  const category = input.category?.trim();
  const items = source.coolpcProducts
    .filter(product => !source.sinyaListedNames.has(product.name))
    .filter(product => !category || (product.category?.trim() || "未分類") === category)
    .sort((left, right) => (left.category ?? "未分類").localeCompare(right.category ?? "未分類", "zh-TW") || left.name.localeCompare(right.name, "zh-TW"));
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, input.pageSize ?? 25));
  return {
    run: source.run,
    total: items.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
    items: items.slice((page - 1) * pageSize, page * pageSize).map(product => ({
      externalId: product.externalId,
      name: product.name,
      category: product.category?.trim() || "未分類",
      price: product.price,
      url: product.url ?? "",
      image: product.image ?? "",
    })),
  };
}

export async function exportSinyaUnlistedCoolpcProducts(category?: string) {
  const source = await getLatestSinyaCoverageSource();
  if (!source) return null;
  const normalizedCategory = category?.trim();
  return {
    run: source.run,
    items: source.coolpcProducts
      .filter(product => !source.sinyaListedNames.has(product.name))
      .filter(product => !normalizedCategory || (product.category?.trim() || "未分類") === normalizedCategory)
      .sort((left, right) => (left.category ?? "未分類").localeCompare(right.category ?? "未分類", "zh-TW") || left.name.localeCompare(right.name, "zh-TW"))
      .map(product => ({
        externalId: product.externalId,
        name: product.name,
        category: product.category?.trim() || "未分類",
        price: product.price,
        url: product.url ?? "",
      })),
  };
}

export function normalizeRecrawlPresetCategoryNames(categoryNames: string[]) {
  return Array.from(new Set(categoryNames.map(name => name.trim()).filter(Boolean))).slice(0, 12);
}

export function parseRecrawlPresetCategoryNames(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every(item => typeof item === "string")) return [];
    return normalizeRecrawlPresetCategoryNames(parsed);
  } catch {
    return [];
  }
}

export function parseRecrawlPresetJobIds(value: string | null) {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter(item => Number.isInteger(item) && Number(item) > 0).map(Number)));
  } catch {
    return [];
  }
}

export function normalizeRecrawlPresetOrder(ids: number[]) {
  return Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0)));
}

export const RECRAWL_PRESET_BACKUP_VERSION = 1;
export type RecrawlPresetBackupItem = {
  name: string;
  categoryNames: string[];
  pinned: boolean;
  sortOrder: number;
};

export type RecrawlPresetBackup = {
  version: typeof RECRAWL_PRESET_BACKUP_VERSION;
  exportedAt: string;
  presets: RecrawlPresetBackupItem[];
};

export type RecrawlPresetConflictStrategy = "overwrite" | "skip" | "copy";
export type RecrawlPresetImportDiffKind = "new" | "unchanged" | "conflict";
export type RecrawlPresetHistoryStatusFilter = "all" | "success" | "failed" | "running";
export type RecrawlPresetTemplateCollaborationMode = "read_only" | "collaborative";

type ExistingRecrawlPresetForImport = {
  id: number;
  name: string;
  categoryNames: string[];
  pinned: boolean;
  sortOrder: number;
};

export function buildRecrawlPresetImportPreview(backupInput: unknown, existing: ExistingRecrawlPresetForImport[]) {
  const backup = parseRecrawlPresetBackup(backupInput);
  if (!backup) throw new Error("備份格式不正確或版本不支援");
  const existingByName = new Map(existing.map(preset => [preset.name, preset]));
  const sameCategories = (left: string[], right: string[]) => left.length === right.length && left.every((name, index) => name === right[index]);
  const items = backup.presets.map(preset => {
    const current = existingByName.get(preset.name);
    const kind: RecrawlPresetImportDiffKind = !current
      ? "new"
      : sameCategories(preset.categoryNames, current.categoryNames) && preset.pinned === current.pinned && preset.sortOrder === current.sortOrder
        ? "unchanged"
        : "conflict";
    return {
      name: preset.name,
      categoryNames: preset.categoryNames,
      pinned: preset.pinned,
      sortOrder: preset.sortOrder,
      kind,
      existing: current ? { categoryNames: current.categoryNames, pinned: current.pinned, sortOrder: current.sortOrder } : null,
    };
  });
  return {
    version: backup.version,
    exportedAt: backup.exportedAt,
    items,
    counts: {
      new: items.filter(item => item.kind === "new").length,
      unchanged: items.filter(item => item.kind === "unchanged").length,
      conflict: items.filter(item => item.kind === "conflict").length,
    },
  } as const;
}

export function getRecrawlPresetHistoryStatus(entry: { execution: { total: number; completedCount: number; failedCount: number; pendingCount: number } }): RecrawlPresetHistoryStatusFilter {
  if (!entry.execution.total) return "all";
  if (entry.execution.failedCount > 0) return "failed";
  if (entry.execution.pendingCount > 0) return "running";
  return entry.execution.completedCount === entry.execution.total ? "success" : "all";
}

/** Accepts only the small, versioned data envelope emitted by the export endpoint. */
export function parseRecrawlPresetBackup(value: unknown): RecrawlPresetBackup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { version?: unknown; exportedAt?: unknown; presets?: unknown };
  if (candidate.version !== RECRAWL_PRESET_BACKUP_VERSION || typeof candidate.exportedAt !== "string" || !Array.isArray(candidate.presets)) return null;
  const seenNames = new Set<string>();
  const presets: RecrawlPresetBackupItem[] = [];
  candidate.presets.slice(0, 50).forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const input = item as { name?: unknown; categoryNames?: unknown; pinned?: unknown; sortOrder?: unknown };
    if (typeof input.name !== "string" || !Array.isArray(input.categoryNames) || !input.categoryNames.every(category => typeof category === "string")) return;
    const name = input.name.trim().slice(0, 64);
    const categoryNames = normalizeRecrawlPresetCategoryNames(input.categoryNames);
    if (!name || !categoryNames.length || seenNames.has(name)) return;
    seenNames.add(name);
    presets.push({
      name,
      categoryNames,
      pinned: input.pinned === true,
      sortOrder: typeof input.sortOrder === "number" && Number.isInteger(input.sortOrder) && input.sortOrder >= 0 ? input.sortOrder : index + 1,
    });
  });
  return { version: RECRAWL_PRESET_BACKUP_VERSION, exportedAt: candidate.exportedAt, presets };
}

export type RecrawlPresetExecutionJob = {
  id: number;
  categoryName: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  errorMessage: string | null;
  summary: string | null;
};

export function deriveRecrawlPresetExecutionSummary(jobs: RecrawlPresetExecutionJob[]) {
  const completed = jobs.filter(job => job.status === "completed");
  const failed = jobs.filter(job => job.status === "failed");
  const terminalCount = completed.length + failed.length;
  const timestamps = jobs.flatMap(job => [job.startedAt, job.finishedAt]
    .filter((value): value is Date | string => Boolean(value))
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite));
  const durationMs = timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : null;
  const failures = failed.slice(0, 2).map(job => ({
    categoryName: job.categoryName ?? "未分類",
    message: job.errorMessage?.trim() || job.summary?.trim() || "未提供錯誤摘要",
  }));
  return {
    total: jobs.length,
    completedCount: completed.length,
    failedCount: failed.length,
    pendingCount: jobs.length - terminalCount,
    completionRate: terminalCount ? completed.length / terminalCount : null,
    durationMs: durationMs !== null && durationMs >= 0 ? durationMs : null,
    failures,
  };
}

/** Lists only the signed-in administrator's own reusable category selections. */
export async function listCoolpcCategoryRecrawlPresets(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [rows, estimates] = await Promise.all([
    db.select().from(coolpcCategoryRecrawlPresets)
      .where(eq(coolpcCategoryRecrawlPresets.userId, userId))
      .orderBy(desc(coolpcCategoryRecrawlPresets.pinned), asc(coolpcCategoryRecrawlPresets.sortOrder), desc(coolpcCategoryRecrawlPresets.updatedAt), desc(coolpcCategoryRecrawlPresets.id)),
    getCrawlerRefreshEstimates(),
  ]);
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    categoryNames: parseRecrawlPresetCategoryNames(row.categoryNames),
    pinned: row.pinned,
    sortOrder: row.sortOrder,
    estimateMs: estimates.category.estimateMs ? estimates.category.estimateMs * parseRecrawlPresetCategoryNames(row.categoryNames).length : null,
    estimateSampleSize: estimates.category.sampleSize,
    updatedAt: row.updatedAt,
  }));
}

/** Exports only user-owned, portable fields; database ids, ownership and runtime history never leave the account. */
export async function exportCoolpcCategoryRecrawlPresets(userId: number): Promise<RecrawlPresetBackup> {
  const presets = await listCoolpcCategoryRecrawlPresets(userId);
  return {
    version: RECRAWL_PRESET_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    presets: presets.map(preset => ({
      name: preset.name,
      categoryNames: preset.categoryNames,
      pinned: preset.pinned,
      sortOrder: preset.sortOrder,
    })),
  };
}

/** Shows the signed-in user's import differences without persisting any change. */
export async function previewCoolpcCategoryRecrawlPresetImport(userId: number, backupInput: unknown) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const rows = await db.select({
    id: coolpcCategoryRecrawlPresets.id,
    name: coolpcCategoryRecrawlPresets.name,
    categoryNames: coolpcCategoryRecrawlPresets.categoryNames,
    pinned: coolpcCategoryRecrawlPresets.pinned,
    sortOrder: coolpcCategoryRecrawlPresets.sortOrder,
  }).from(coolpcCategoryRecrawlPresets).where(eq(coolpcCategoryRecrawlPresets.userId, userId));
  return buildRecrawlPresetImportPreview(backupInput, rows.map(row => ({ ...row, categoryNames: parseRecrawlPresetCategoryNames(row.categoryNames) })));
}

function nextImportedPresetName(baseName: string, existingNames: Set<string>) {
  const suffix = "（匯入）";
  const stem = baseName.slice(0, Math.max(1, 64 - suffix.length));
  let candidate = `${stem}${suffix}`;
  let index = 2;
  while (existingNames.has(candidate)) {
    const numberedSuffix = `（匯入 ${index}）`;
    candidate = `${baseName.slice(0, Math.max(1, 64 - numberedSuffix.length))}${numberedSuffix}`;
    index += 1;
  }
  return candidate;
}

/** Imports by name into the caller's account only, with an explicit strategy for each same-name conflict. */
export async function importCoolpcCategoryRecrawlPresets(userId: number, backupInput: unknown, conflictStrategies: Record<string, RecrawlPresetConflictStrategy> = {}) {
  const backup = parseRecrawlPresetBackup(backupInput);
  if (!backup) throw new Error("備份格式不正確或版本不支援");
  if (!backup.presets.length) throw new Error("備份中沒有可匯入的常用清單");
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const existing = await db.select({
    id: coolpcCategoryRecrawlPresets.id,
    name: coolpcCategoryRecrawlPresets.name,
    sortOrder: coolpcCategoryRecrawlPresets.sortOrder,
  }).from(coolpcCategoryRecrawlPresets).where(eq(coolpcCategoryRecrawlPresets.userId, userId));
  const existingByName = new Map(existing.map(preset => [preset.name, preset]));
  let nextSortOrder = Math.max(0, ...existing.map(preset => preset.sortOrder)) + 1;
  const existingNames = new Set(existing.map(preset => preset.name));
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date();
  const orderedPresets = [...backup.presets].sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-TW"));
  for (const preset of orderedPresets) {
    const current = existingByName.get(preset.name);
    if (current) {
      const strategy = conflictStrategies[preset.name] ?? "overwrite";
      if (strategy === "skip") {
        skipped += 1;
        continue;
      }
      if (strategy === "copy") {
        const name = nextImportedPresetName(preset.name, existingNames);
        await db.insert(coolpcCategoryRecrawlPresets).values({
          userId,
          name,
          categoryNames: JSON.stringify(preset.categoryNames),
          pinned: preset.pinned,
          sortOrder: nextSortOrder++,
          updatedAt: now,
        });
        existingNames.add(name);
        created += 1;
        continue;
      }
      await db.update(coolpcCategoryRecrawlPresets).set({
        categoryNames: JSON.stringify(preset.categoryNames),
        pinned: preset.pinned,
        updatedAt: now,
      }).where(and(eq(coolpcCategoryRecrawlPresets.id, current.id), eq(coolpcCategoryRecrawlPresets.userId, userId)));
      updated += 1;
    } else {
      await db.insert(coolpcCategoryRecrawlPresets).values({
        userId,
        name: preset.name,
        categoryNames: JSON.stringify(preset.categoryNames),
        pinned: preset.pinned,
        sortOrder: nextSortOrder++,
        updatedAt: now,
      });
      existingNames.add(preset.name);
      created += 1;
    }
  }
  return { created, updated, skipped, total: backup.presets.length } as const;
}

/** Saving the same name updates that personal preset instead of producing ambiguous duplicates. */
export async function saveCoolpcCategoryRecrawlPreset(input: CoolpcCategoryRecrawlPresetInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const name = input.name.trim();
  const categoryNames = normalizeRecrawlPresetCategoryNames(input.categoryNames);
  if (!name) throw new Error("請輸入清單名稱");
  if (!categoryNames.length) throw new Error("請至少選擇一個分類");
  const now = new Date();
  const categoryNamesJson = JSON.stringify(categoryNames);
  const [lastPreset] = await db.select({ sortOrder: coolpcCategoryRecrawlPresets.sortOrder })
    .from(coolpcCategoryRecrawlPresets)
    .where(eq(coolpcCategoryRecrawlPresets.userId, input.userId))
    .orderBy(desc(coolpcCategoryRecrawlPresets.sortOrder))
    .limit(1);
  await db.insert(coolpcCategoryRecrawlPresets).values({
    userId: input.userId,
    name,
    categoryNames: categoryNamesJson,
    sortOrder: (lastPreset?.sortOrder ?? 0) + 1,
    updatedAt: now,
  }).onDuplicateKeyUpdate({
    set: { categoryNames: categoryNamesJson, updatedAt: now },
  });
  return { success: true, name, categoryNames } as const;
}

/** The user id condition prevents a preset identifier alone from deleting another account's data. */
export async function deleteCoolpcCategoryRecrawlPreset(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.delete(coolpcCategoryRecrawlPresets).where(and(
    eq(coolpcCategoryRecrawlPresets.id, id),
    eq(coolpcCategoryRecrawlPresets.userId, userId),
  ));
  return { success: true } as const;
}

export async function getCoolpcCategoryRecrawlPresetForUser(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [preset] = await db.select().from(coolpcCategoryRecrawlPresets).where(and(
    eq(coolpcCategoryRecrawlPresets.id, id),
    eq(coolpcCategoryRecrawlPresets.userId, userId),
  )).limit(1);
  return preset ?? null;
}

export async function setCoolpcCategoryRecrawlPresetPinned(userId: number, id: number, pinned: boolean) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.update(coolpcCategoryRecrawlPresets).set({ pinned }).where(and(
    eq(coolpcCategoryRecrawlPresets.id, id),
    eq(coolpcCategoryRecrawlPresets.userId, userId),
  ));
  return { success: true } as const;
}

export async function reorderCoolpcCategoryRecrawlPresets(userId: number, orderedIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const normalizedIds = normalizeRecrawlPresetOrder(orderedIds);
  if (!normalizedIds.length) return { success: true } as const;
  const owned = await db.select({ id: coolpcCategoryRecrawlPresets.id }).from(coolpcCategoryRecrawlPresets)
    .where(and(eq(coolpcCategoryRecrawlPresets.userId, userId), inArray(coolpcCategoryRecrawlPresets.id, normalizedIds)));
  if (owned.length !== normalizedIds.length) throw new Error("常用清單不存在或不屬於目前帳戶");
  await Promise.all(normalizedIds.map((id, index) => db.update(coolpcCategoryRecrawlPresets).set({ sortOrder: index + 1 }).where(and(
    eq(coolpcCategoryRecrawlPresets.id, id),
    eq(coolpcCategoryRecrawlPresets.userId, userId),
  ))));
  return { success: true } as const;
}

export async function recordCoolpcCategoryRecrawlPresetHistory(input: CoolpcCategoryRecrawlPresetHistoryInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const categoryNames = normalizeRecrawlPresetCategoryNames(input.categoryNames);
  if (!categoryNames.length) return null;
  const jobIds = Array.from(new Set((input.jobIds ?? []).filter(id => Number.isInteger(id) && id > 0)));
  await db.insert(coolpcCategoryRecrawlPresetHistory).values({
    userId: input.userId,
    presetId: input.presetId,
    action: input.action,
    categoryNames: JSON.stringify(categoryNames),
    jobIds: jobIds.length ? JSON.stringify(jobIds) : null,
  });
  return { success: true } as const;
}

export async function listCoolpcCategoryRecrawlPresetHistory(userId: number, limit = 12, statusFilter: RecrawlPresetHistoryStatusFilter = "all") {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const rows = await db.select().from(coolpcCategoryRecrawlPresetHistory)
    .where(eq(coolpcCategoryRecrawlPresetHistory.userId, userId))
    .orderBy(desc(coolpcCategoryRecrawlPresetHistory.createdAt), desc(coolpcCategoryRecrawlPresetHistory.id))
    .limit(30);
  const presetIds = Array.from(new Set(rows.map(row => row.presetId).filter((id): id is number => typeof id === "number")));
  const jobIds = Array.from(new Set(rows.flatMap(row => parseRecrawlPresetJobIds(row.jobIds))));
  const [presets, jobs] = await Promise.all([
    presetIds.length ? db.select({ id: coolpcCategoryRecrawlPresets.id, name: coolpcCategoryRecrawlPresets.name }).from(coolpcCategoryRecrawlPresets)
      .where(and(eq(coolpcCategoryRecrawlPresets.userId, userId), inArray(coolpcCategoryRecrawlPresets.id, presetIds))) : Promise.resolve([]),
    jobIds.length ? db.select({
      id: crawlerJobs.id,
      categoryName: crawlerJobs.categoryName,
      status: crawlerJobs.status,
      startedAt: crawlerJobs.startedAt,
      finishedAt: crawlerJobs.finishedAt,
      errorMessage: crawlerJobs.errorMessage,
      summary: crawlerJobs.summary,
    })
      .from(crawlerJobs).where(inArray(crawlerJobs.id, jobIds)) : Promise.resolve([]),
  ]);
  const presetNames = new Map(presets.map(preset => [preset.id, preset.name]));
  const jobsById = new Map(jobs.map(job => [job.id, job]));
  const entries = rows.map(row => ({
    id: row.id,
    presetId: row.presetId,
    presetName: row.presetId ? presetNames.get(row.presetId) ?? "已刪除清單" : "手動選取",
    action: row.action,
    categoryNames: parseRecrawlPresetCategoryNames(row.categoryNames),
    createdAt: row.createdAt,
    jobs: parseRecrawlPresetJobIds(row.jobIds).flatMap(id => {
      const job = jobsById.get(id);
      return job ? [{
        id: job.id,
        categoryName: job.categoryName,
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        errorMessage: job.errorMessage,
        summary: job.summary,
      }] : [];
    }),
  })).map(entry => ({ ...entry, execution: deriveRecrawlPresetExecutionSummary(entry.jobs) }));
  return entries.filter(entry => statusFilter === "all" || getRecrawlPresetHistoryStatus(entry) === statusFilter)
    .slice(0, Math.min(30, Math.max(1, limit)));
}

function createRecrawlPresetShareToken() {
  return randomBytes(24).toString("base64url");
}

async function getRecrawlPresetTemplateSource(token: string) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [template] = await db.select().from(coolpcCategoryRecrawlPresetTemplates)
    .where(and(eq(coolpcCategoryRecrawlPresetTemplates.shareToken, token), eq(coolpcCategoryRecrawlPresetTemplates.active, true)))
    .limit(1);
  if (!template) return null;
  const [preset] = await db.select().from(coolpcCategoryRecrawlPresets)
    .where(and(eq(coolpcCategoryRecrawlPresets.id, template.presetId), eq(coolpcCategoryRecrawlPresets.userId, template.userId)))
    .limit(1);
  return preset ? { template, preset } : null;
}

async function getRecrawlPresetTemplateForOwner(userId: number, templateId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [template] = await db.select().from(coolpcCategoryRecrawlPresetTemplates).where(and(
    eq(coolpcCategoryRecrawlPresetTemplates.id, templateId),
    eq(coolpcCategoryRecrawlPresetTemplates.userId, userId),
  )).limit(1);
  if (!template) throw new Error("找不到可管理的團隊範本");
  return template;
}

export function canMaintainRecrawlPresetTemplate(
  collaborationMode: RecrawlPresetTemplateCollaborationMode,
  isOwner: boolean,
  isCollaborator: boolean,
) {
  return isOwner || (collaborationMode === "collaborative" && isCollaborator);
}

export function canManageRecrawlPresetTemplateCollaborators(isOwner: boolean) {
  return isOwner;
}

export function deriveRecrawlPresetTemplateEstimate(categoryCount: number, categoryEstimateMs: number | null, estimateSampleSize: number) {
  return {
    estimateMs: categoryEstimateMs && categoryCount > 0 ? categoryEstimateMs * categoryCount : null,
    estimateSampleSize,
  };
}

async function getRecrawlPresetTemplateEstimate(categoryNames: string[]) {
  const estimates = await getCrawlerRefreshEstimates();
  return deriveRecrawlPresetTemplateEstimate(categoryNames.length, estimates.category.estimateMs, estimates.category.sampleSize);
}

/** Lists safely shareable template metadata, plus owner information needed for collaboration. */
export async function listCoolpcCategoryRecrawlPresetTemplates(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const templates = await db.select().from(coolpcCategoryRecrawlPresetTemplates)
    .where(eq(coolpcCategoryRecrawlPresetTemplates.active, true))
    .orderBy(desc(coolpcCategoryRecrawlPresetTemplates.updatedAt), desc(coolpcCategoryRecrawlPresetTemplates.id));
  const sourcePresetIds = Array.from(new Set(templates.map(template => template.presetId)));
  const ownerIds = Array.from(new Set(templates.map(template => template.userId)));
  const [presets, owners, collaborators, estimates] = await Promise.all([
    sourcePresetIds.length ? db.select().from(coolpcCategoryRecrawlPresets)
      .where(inArray(coolpcCategoryRecrawlPresets.id, sourcePresetIds)) : Promise.resolve([]),
    ownerIds.length ? db.select({ id: users.id, name: users.name, email: users.email }).from(users)
      .where(inArray(users.id, ownerIds)) : Promise.resolve([]),
    templates.length ? db.select({ templateId: coolpcCategoryRecrawlPresetTemplateCollaborators.templateId, userId: coolpcCategoryRecrawlPresetTemplateCollaborators.userId, name: users.name, email: users.email })
      .from(coolpcCategoryRecrawlPresetTemplateCollaborators)
      .innerJoin(users, eq(coolpcCategoryRecrawlPresetTemplateCollaborators.userId, users.id))
      .where(inArray(coolpcCategoryRecrawlPresetTemplateCollaborators.templateId, templates.map(template => template.id))) : Promise.resolve([]),
    getCrawlerRefreshEstimates(),
  ]);
  const presetById = new Map(presets.map(preset => [preset.id, preset]));
  const ownerById = new Map(owners.map(owner => [owner.id, owner]));
  const collaboratorsByTemplate = new Map<number, Array<{ userId: number; name: string | null; email: string | null }>>();
  collaborators.forEach(collaborator => {
    const current = collaboratorsByTemplate.get(collaborator.templateId) ?? [];
    current.push(collaborator);
    collaboratorsByTemplate.set(collaborator.templateId, current);
  });
  return templates.flatMap(template => {
    const preset = presetById.get(template.presetId);
    if (!preset) return [];
    const categoryNames = parseRecrawlPresetCategoryNames(preset.categoryNames);
    const owner = ownerById.get(template.userId);
    const templateCollaborators = collaboratorsByTemplate.get(template.id) ?? [];
    const updatedAt = new Date(template.updatedAt).getTime() >= new Date(preset.updatedAt).getTime() ? template.updatedAt : preset.updatedAt;
    return [{
      id: template.id,
      token: template.shareToken,
      sourcePresetId: template.presetId,
      canRevoke: template.userId === userId,
      isOwner: template.userId === userId,
      canCollaborate: template.collaborationMode === "collaborative" && templateCollaborators.some(collaborator => collaborator.userId === userId),
      name: preset.name,
      categoryNames,
      pinned: preset.pinned,
      ownerName: owner?.name?.trim() || owner?.email || "未知擁有者",
      collaborationMode: template.collaborationMode,
      collaborators: template.userId === userId ? templateCollaborators : [],
      ...deriveRecrawlPresetTemplateEstimate(categoryNames.length, estimates.category.estimateMs, estimates.category.sampleSize),
      updatedAt,
    }];
  });
}

/** Reuses one template per source preset and rotates a revoked link when publishing it again. */
export async function publishCoolpcCategoryRecrawlPresetTemplate(userId: number, presetId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const preset = await getCoolpcCategoryRecrawlPresetForUser(userId, presetId);
  if (!preset) throw new Error("找不到可分享的常用清單");
  const [existing] = await db.select().from(coolpcCategoryRecrawlPresetTemplates)
    .where(eq(coolpcCategoryRecrawlPresetTemplates.presetId, presetId)).limit(1);
  if (existing?.active) return { token: existing.shareToken, presetName: preset.name, created: false } as const;
  const token = createRecrawlPresetShareToken();
  if (existing) {
    await db.update(coolpcCategoryRecrawlPresetTemplates).set({ shareToken: token, active: true, updatedAt: new Date() })
      .where(and(eq(coolpcCategoryRecrawlPresetTemplates.id, existing.id), eq(coolpcCategoryRecrawlPresetTemplates.userId, userId)));
  } else {
    await db.insert(coolpcCategoryRecrawlPresetTemplates).values({ userId, presetId, shareToken: token, active: true });
  }
  return { token, presetName: preset.name, created: true } as const;
}

export async function revokeCoolpcCategoryRecrawlPresetTemplate(userId: number, templateId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.update(coolpcCategoryRecrawlPresetTemplates).set({ active: false, updatedAt: new Date() })
    .where(and(eq(coolpcCategoryRecrawlPresetTemplates.id, templateId), eq(coolpcCategoryRecrawlPresetTemplates.userId, userId)));
  return { success: true } as const;
}

export async function setCoolpcCategoryRecrawlPresetTemplateCollaborationMode(
  userId: number,
  templateId: number,
  collaborationMode: RecrawlPresetTemplateCollaborationMode,
) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const template = await getRecrawlPresetTemplateForOwner(userId, templateId);
  if (!canManageRecrawlPresetTemplateCollaborators(template.userId === userId)) throw new Error("只有範本擁有者可以變更協作模式");
  await db.update(coolpcCategoryRecrawlPresetTemplates).set({ collaborationMode, updatedAt: new Date() }).where(and(
    eq(coolpcCategoryRecrawlPresetTemplates.id, templateId),
    eq(coolpcCategoryRecrawlPresetTemplates.userId, userId),
  ));
  return { success: true, collaborationMode } as const;
}

export async function addCoolpcCategoryRecrawlPresetTemplateCollaborator(userId: number, templateId: number, email: string) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const template = await getRecrawlPresetTemplateForOwner(userId, templateId);
  if (!canManageRecrawlPresetTemplateCollaborators(template.userId === userId)) throw new Error("只有範本擁有者可以管理協作者");
  const normalizedEmail = email.trim().toLowerCase();
  const [collaborator] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users)
    .where(eq(users.email, normalizedEmail)).limit(1);
  if (!collaborator) throw new Error("找不到此電子郵件對應的已註冊使用者");
  if (collaborator.id === template.userId) throw new Error("範本擁有者不需要重複加入協作者");
  await db.insert(coolpcCategoryRecrawlPresetTemplateCollaborators).values({ templateId, userId: collaborator.id }).onDuplicateKeyUpdate({
    set: { templateId },
  });
  return { id: collaborator.id, name: collaborator.name, email: collaborator.email } as const;
}

export async function removeCoolpcCategoryRecrawlPresetTemplateCollaborator(userId: number, templateId: number, collaboratorUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const template = await getRecrawlPresetTemplateForOwner(userId, templateId);
  if (!canManageRecrawlPresetTemplateCollaborators(template.userId === userId)) throw new Error("只有範本擁有者可以管理協作者");
  await db.delete(coolpcCategoryRecrawlPresetTemplateCollaborators).where(and(
    eq(coolpcCategoryRecrawlPresetTemplateCollaborators.templateId, templateId),
    eq(coolpcCategoryRecrawlPresetTemplateCollaborators.userId, collaboratorUserId),
  ));
  return { success: true } as const;
}

export async function updateCoolpcCategoryRecrawlPresetTemplateCategories(userId: number, templateId: number, categoryNamesInput: string[]) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const categoryNames = normalizeRecrawlPresetCategoryNames(categoryNamesInput);
  if (!categoryNames.length) throw new Error("請至少選擇一個分類");
  const [template] = await db.select().from(coolpcCategoryRecrawlPresetTemplates).where(and(
    eq(coolpcCategoryRecrawlPresetTemplates.id, templateId),
    eq(coolpcCategoryRecrawlPresetTemplates.active, true),
  )).limit(1);
  if (!template) throw new Error("找不到有效的團隊範本");
  const isOwner = template.userId === userId;
  const [collaboration] = isOwner ? [null] : await db.select({ id: coolpcCategoryRecrawlPresetTemplateCollaborators.id }).from(coolpcCategoryRecrawlPresetTemplateCollaborators)
    .where(and(
      eq(coolpcCategoryRecrawlPresetTemplateCollaborators.templateId, templateId),
      eq(coolpcCategoryRecrawlPresetTemplateCollaborators.userId, userId),
    )).limit(1);
  if (!canMaintainRecrawlPresetTemplate(template.collaborationMode, isOwner, Boolean(collaboration))) throw new Error("此團隊範本為只讀，或你沒有共同維護權限");
  await db.update(coolpcCategoryRecrawlPresets).set({ categoryNames: JSON.stringify(categoryNames), updatedAt: new Date() }).where(and(
    eq(coolpcCategoryRecrawlPresets.id, template.presetId),
    eq(coolpcCategoryRecrawlPresets.userId, template.userId),
  ));
  await db.update(coolpcCategoryRecrawlPresetTemplates).set({ updatedAt: new Date() }).where(eq(coolpcCategoryRecrawlPresetTemplates.id, templateId));
  return { success: true, categoryNames } as const;
}

export async function getCoolpcCategoryRecrawlPresetTemplateByToken(token: string) {
  const source = await getRecrawlPresetTemplateSource(token);
  if (!source) return null;
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const categoryNames = parseRecrawlPresetCategoryNames(source.preset.categoryNames);
  const [[owner], estimate] = await Promise.all([
    db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, source.template.userId)).limit(1),
    getRecrawlPresetTemplateEstimate(categoryNames),
  ]);
  const updatedAt = new Date(source.template.updatedAt).getTime() >= new Date(source.preset.updatedAt).getTime()
    ? source.template.updatedAt
    : source.preset.updatedAt;
  return {
    name: source.preset.name,
    categoryNames,
    pinned: source.preset.pinned,
    ownerName: owner?.name?.trim() || owner?.email || "未知擁有者",
    collaborationMode: source.template.collaborationMode,
    estimateMs: estimate.estimateMs,
    estimateSampleSize: estimate.estimateSampleSize,
    updatedAt,
  };
}

/** Copies an active team template into the caller's account without linking later edits or history. */
export async function copyCoolpcCategoryRecrawlPresetTemplate(userId: number, token: string) {
  const source = await getRecrawlPresetTemplateSource(token);
  if (!source) throw new Error("分享連結已撤銷、失效或不存在");
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const existing = await db.select({ name: coolpcCategoryRecrawlPresets.name, sortOrder: coolpcCategoryRecrawlPresets.sortOrder })
    .from(coolpcCategoryRecrawlPresets).where(eq(coolpcCategoryRecrawlPresets.userId, userId));
  const name = nextImportedPresetName(source.preset.name, new Set(existing.map(preset => preset.name)));
  const sortOrder = Math.max(0, ...existing.map(preset => preset.sortOrder)) + 1;
  await db.insert(coolpcCategoryRecrawlPresets).values({
    userId,
    name,
    categoryNames: source.preset.categoryNames,
    pinned: false,
    sortOrder,
  });
  return { name, categoryNames: parseRecrawlPresetCategoryNames(source.preset.categoryNames) } as const;
}

export async function applyCoolpcCategoryRecrawlPreset(userId: number, id: number) {
  const preset = await getCoolpcCategoryRecrawlPresetForUser(userId, id);
  if (!preset) throw new Error("找不到可套用的常用清單");
  const categoryNames = parseRecrawlPresetCategoryNames(preset.categoryNames);
  await recordCoolpcCategoryRecrawlPresetHistory({ userId, presetId: preset.id, action: "applied", categoryNames });
  return { id: preset.id, name: preset.name, categoryNames };
}

export async function listCoolpcCategoryRecrawlReminders(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [reminders, summary, estimates, recentCategoryJobs] = await Promise.all([
    db.select().from(coolpcCategoryRecrawlReminders).where(and(
      eq(coolpcCategoryRecrawlReminders.userId, userId),
      eq(coolpcCategoryRecrawlReminders.active, true),
    )).orderBy(desc(coolpcCategoryRecrawlReminders.updatedAt)),
    getSinyaCoverageSummary(),
    getCrawlerRefreshEstimates(),
    db.select({
      categoryName: crawlerJobs.categoryName,
      status: crawlerJobs.status,
      startedAt: crawlerJobs.startedAt,
      finishedAt: crawlerJobs.finishedAt,
    }).from(crawlerJobs).where(and(
      eq(crawlerJobs.scope, "category"),
      isNotNull(crawlerJobs.categoryName),
    )).orderBy(desc(crawlerJobs.requestedAt), desc(crawlerJobs.id)).limit(200),
  ]);
  const categories = new Map(summary?.categories.map(category => [category.category, category]) ?? []);
  const latestJobs = new Map<string, typeof recentCategoryJobs[number]>();
  recentCategoryJobs.forEach(job => {
    if (job.categoryName && !latestJobs.has(job.categoryName)) latestJobs.set(job.categoryName, job);
  });
  return reminders.map(reminder => {
    const current = categories.get(reminder.categoryName);
    const currentRunId = summary?.run.id ?? null;
    const hasGap = (current?.sinyaUnlisted ?? 0) > 0;
    const latestJob = latestJobs.get(reminder.categoryName) ?? null;
    const durationMs = latestJob?.startedAt && latestJob.finishedAt
      ? Math.max(0, new Date(latestJob.finishedAt).getTime() - new Date(latestJob.startedAt).getTime())
      : null;
    return {
      id: reminder.id,
      categoryName: reminder.categoryName,
      lastNotifiedRunId: reminder.lastNotifiedRunId,
      currentRunId,
      sinyaUnlisted: current?.sinyaUnlisted ?? 0,
      isDue: Boolean(hasGap && currentRunId && (!reminder.lastNotifiedRunId || currentRunId > reminder.lastNotifiedRunId)),
      estimateMs: estimates.category.estimateMs,
      estimateSampleSize: estimates.category.sampleSize,
      latestJob: latestJob ? {
        status: latestJob.status,
        startedAt: latestJob.startedAt,
        finishedAt: latestJob.finishedAt,
        durationMs,
      } : null,
      updatedAt: reminder.updatedAt,
    };
  });
}

export async function saveCoolpcCategoryRecrawlReminder(input: CoolpcRecrawlReminderInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const summary = await getSinyaCoverageSummary();
  await db.insert(coolpcCategoryRecrawlReminders).values({
    userId: input.userId,
    categoryName: input.categoryName,
    active: true,
    lastNotifiedRunId: summary?.run.id ?? null,
  }).onDuplicateKeyUpdate({ set: {
    active: true,
    lastNotifiedRunId: summary?.run.id ?? null,
  } });
  return { success: true } as const;
}

export async function setCoolpcCategoryRecrawlReminderActive(userId: number, id: number, active: boolean) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.update(coolpcCategoryRecrawlReminders).set({ active }).where(and(
    eq(coolpcCategoryRecrawlReminders.id, id),
    eq(coolpcCategoryRecrawlReminders.userId, userId),
  ));
  return { success: true } as const;
}

export async function acknowledgeCoolpcCategoryRecrawlReminder(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const summary = await getSinyaCoverageSummary();
  await db.update(coolpcCategoryRecrawlReminders).set({ lastNotifiedRunId: summary?.run.id ?? null }).where(and(
    eq(coolpcCategoryRecrawlReminders.id, id),
    eq(coolpcCategoryRecrawlReminders.userId, userId),
  ));
  return { success: true } as const;
}

/** Queue a crawler task for the persistent cloud worker without stacking full refreshes. */
export async function enqueueCrawlerJob(input: CrawlerJobInput): Promise<EnqueueCrawlerJobResult> {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");

  // A full four-platform job is costly and can take a while to complete. The
  // homepage update control may be clicked repeatedly, so reuse an in-flight
  // full refresh instead of accumulating identical work in the worker queue.
  if (input.scope === "full") {
    const [activeJob] = await db.select({ id: crawlerJobs.id, status: crawlerJobs.status })
      .from(crawlerJobs)
      .where(and(
        eq(crawlerJobs.scope, "full"),
        inArray(crawlerJobs.status, ["queued", "running"]),
      ))
      .orderBy(desc(crawlerJobs.requestedAt), desc(crawlerJobs.id))
      .limit(1);

    if (activeJob) {
      return { id: activeJob.id, created: false, status: activeJob.status };
    }
  }

  const result = await db.insert(crawlerJobs).values({
    scope: input.scope,
    trigger: input.trigger,
    status: "queued",
    categoryId: input.categoryId ?? null,
    categoryName: input.categoryName ?? null,
    requestedByOpenId: input.requestedByOpenId ?? null,
  });
  return { id: Number(result[0]?.insertId ?? 0), created: true, status: "queued" };
}

export function partitionCategoryRecrawlNames(categoryNames: string[], activeCategoryNames: ReadonlySet<string>) {
  const requestedCategoryNames = Array.from(new Set(categoryNames.map(name => name.trim()).filter(Boolean))).slice(0, 12);
  return {
    requestedCategoryNames,
    createdCategoryNames: requestedCategoryNames.filter(name => !activeCategoryNames.has(name)),
    existingCategoryNames: requestedCategoryNames.filter(name => activeCategoryNames.has(name)),
  };
}

export function createCategoryRecrawlJobValues(categoryNames: string[], requestedByOpenId?: string | null) {
  return categoryNames.map(categoryName => ({
    scope: "category" as const,
    trigger: "manual" as const,
    status: "queued" as const,
    categoryName,
    requestedByOpenId: requestedByOpenId ?? null,
  }));
}

export function collectExistingCategoryJobIds(
  activeJobs: Array<{ id: number | string; categoryName: string | null }>,
  requestedCategoryNames: string[],
) {
  const requested = new Set(requestedCategoryNames);
  return activeJobs
    .filter(job => job.categoryName !== null && requested.has(job.categoryName))
    .map(job => Number(job.id))
    .filter(id => Number.isInteger(id) && id > 0);
}

/** Queue several distinct category refreshes without letting identical active jobs pile up. */
export async function enqueueCrawlerCategoryJobs(input: { categoryNames: string[]; requestedByOpenId?: string | null }): Promise<EnqueueCrawlerCategoryJobsResult> {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const normalized = partitionCategoryRecrawlNames(input.categoryNames, new Set());
  if (!normalized.requestedCategoryNames.length) throw new Error("請至少選擇一個分類");

  const activeJobs = await db.select({ id: crawlerJobs.id, categoryName: crawlerJobs.categoryName }).from(crawlerJobs)
    .where(and(
      eq(crawlerJobs.scope, "category"),
      inArray(crawlerJobs.status, ["queued", "running"]),
      inArray(crawlerJobs.categoryName, normalized.requestedCategoryNames),
    ));
  const activeNames = new Set(activeJobs.map(job => job.categoryName).filter((name): name is string => Boolean(name)));
  const existingJobIds = collectExistingCategoryJobIds(activeJobs, normalized.requestedCategoryNames);
  const partitioned = partitionCategoryRecrawlNames(normalized.requestedCategoryNames, activeNames);
  const { createdCategoryNames } = partitioned;
  let createdJobIds: number[] = [];
  if (createdCategoryNames.length) {
    const insertResults = await Promise.all(createCategoryRecrawlJobValues(createdCategoryNames, input.requestedByOpenId)
      .map(values => db.insert(crawlerJobs).values(values)));
    createdJobIds = insertResults.map(result => Number(result[0]?.insertId ?? 0)).filter(id => id > 0);
  }
  return {
    requestedCount: partitioned.requestedCategoryNames.length,
    createdCategoryNames,
    existingCategoryNames: partitioned.existingCategoryNames,
    createdJobIds,
    existingJobIds,
  };
}

/** Derives a compact trend series from terminal category jobs, with a rolling five-job success rate. */
export function deriveCategoryRecrawlAnalytics(rows: CategoryRecrawlMetricInput[]): CategoryRecrawlAnalytics {
  const terminalRows = rows.filter(row => (row.status === "completed" || row.status === "failed") && row.categoryName && row.startedAt && row.finishedAt)
    .map(row => ({ ...row, startedMs: new Date(row.startedAt as Date | string).getTime(), finishedMs: new Date(row.finishedAt as Date | string).getTime() }))
    .filter(row => Number.isFinite(row.startedMs) && Number.isFinite(row.finishedMs) && row.finishedMs >= row.startedMs)
    .sort((left, right) => left.finishedMs - right.finishedMs)
    .slice(-24);
  const completedCount = terminalRows.filter(row => row.status === "completed").length;
  const failedCount = terminalRows.length - completedCount;
  const averageDurationMs = terminalRows.length
    ? Math.round(terminalRows.reduce((total, row) => total + row.finishedMs - row.startedMs, 0) / terminalRows.length)
    : null;

  return {
    sampleSize: terminalRows.length,
    completedCount,
    failedCount,
    successRate: terminalRows.length ? completedCount / terminalRows.length : null,
    averageDurationMs,
    points: terminalRows.map((row, index) => {
      const window = terminalRows.slice(Math.max(0, index - 4), index + 1);
      const windowCompleted = window.filter(entry => entry.status === "completed").length;
      return {
        id: row.id,
        categoryName: row.categoryName ?? "未分類",
        finishedAt: row.finishedAt as Date | string,
        durationMinutes: Math.round(((row.finishedMs - row.startedMs) / 60_000) * 10) / 10,
        rollingSuccessRate: Math.round((windowCompleted / window.length) * 1000) / 10,
        succeeded: row.status === "completed",
      };
    }),
  };
}

/** Category-only metrics stay separate from full catalog timing, preventing skewed manual-recrawl reports. */
export async function getCategoryRecrawlAnalytics(limit = 24) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const rows = await db.select({
    id: crawlerJobs.id,
    categoryName: crawlerJobs.categoryName,
    status: crawlerJobs.status,
    startedAt: crawlerJobs.startedAt,
    finishedAt: crawlerJobs.finishedAt,
  }).from(crawlerJobs).where(and(
    eq(crawlerJobs.scope, "category"),
    inArray(crawlerJobs.status, ["completed", "failed"]),
  )).orderBy(desc(crawlerJobs.finishedAt), desc(crawlerJobs.id)).limit(Math.min(48, Math.max(1, limit)));
  return deriveCategoryRecrawlAnalytics(rows);
}

/** Recent crawler work is intentionally limited to keep the monitor page fast. */
export async function listCrawlerJobs(limit = 50) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const jobs = await db.select().from(crawlerJobs)
    .orderBy(desc(crawlerJobs.requestedAt), desc(crawlerJobs.id))
    .limit(Math.min(100, Math.max(1, limit)));
  if (!jobs.length) return [];
  const reports = await db.select({
    jobId: crawlerIssueReports.jobId,
    severity: crawlerIssueReports.severity,
    issueLabel: crawlerIssueReports.issueLabel,
    issueDraftUrl: crawlerIssueReports.issueDraftUrl,
    updatedAt: crawlerIssueReports.updatedAt,
  }).from(crawlerIssueReports).where(inArray(crawlerIssueReports.jobId, jobs.map(job => job.id)));
  const reportsByJob = new Map(reports.map(report => [report.jobId, report]));
  return jobs.map(job => ({ ...job, issueReport: reportsByJob.get(job.id) ?? null }));
}

/** Monitoring events include normal completions plus warning and error alerts. */
export async function listCrawlerEvents(limit = 100) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  return db.select().from(crawlerEvents)
    .orderBy(desc(crawlerEvents.createdAt), desc(crawlerEvents.id))
    .limit(Math.min(200, Math.max(1, limit)));
}

/** Supplies the latest actionable worker errors for a failed-job Issue draft. */
export async function getCrawlerIssueContext(jobId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [job] = await db.select().from(crawlerJobs).where(eq(crawlerJobs.id, jobId)).limit(1);
  if (!job) return null;
  const events = await db.select({
    title: crawlerEvents.title,
    message: crawlerEvents.message,
    level: crawlerEvents.level,
    createdAt: crawlerEvents.createdAt,
  }).from(crawlerEvents)
    .where(and(
      eq(crawlerEvents.jobId, jobId),
      inArray(crawlerEvents.level, ["error", "warning"]),
    ))
    .orderBy(desc(crawlerEvents.createdAt), desc(crawlerEvents.id))
    .limit(5);
  return { job, events };
}

export async function upsertCrawlerIssueReport(input: CrawlerIssueReportInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.insert(crawlerIssueReports).values({
    jobId: input.jobId,
    severity: input.severity,
    issueLabel: input.issueLabel,
    issueDraftUrl: input.issueDraftUrl,
    errorSummary: input.errorSummary ?? null,
    createdByOpenId: input.createdByOpenId,
  }).onDuplicateKeyUpdate({
    set: {
      severity: input.severity,
      issueLabel: input.issueLabel,
      issueDraftUrl: input.issueDraftUrl,
      errorSummary: input.errorSummary ?? null,
      createdByOpenId: input.createdByOpenId,
    },
  });
  const [report] = await db.select().from(crawlerIssueReports)
    .where(eq(crawlerIssueReports.jobId, input.jobId)).limit(1);
  return report ?? null;
}

export async function markCrawlerEventsRead(ids: number[]) {
  const eligible = Array.from(new Set(ids)).filter(id => Number.isInteger(id) && id > 0);
  if (!eligible.length) return;
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.update(crawlerEvents).set({ readAt: new Date() }).where(inArray(crawlerEvents.id, eligible));
}

export async function getFavoriteForUser(userId: number, sourceKey: string) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  const [favorite] = await db.select().from(productFavorites)
    .where(and(eq(productFavorites.userId, userId), eq(productFavorites.sourceKey, sourceKey)))
    .limit(1);
  return favorite ?? null;
}

export async function upsertFavoriteForUser(userId: number, input: FavoriteInput) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.insert(productFavorites).values({
    userId,
    sourceKey: input.sourceKey,
    sinyaName: input.sinyaName,
    targetPrice: input.targetPrice ?? null,
    active: true,
  }).onDuplicateKeyUpdate({
    set: {
      sinyaName: input.sinyaName,
      targetPrice: input.targetPrice ?? null,
      active: true,
    },
  });
  return getFavoriteForUser(userId, input.sourceKey);
}

export async function listFavoritesForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  return db.select().from(productFavorites)
    .where(eq(productFavorites.userId, userId))
    .orderBy(desc(productFavorites.updatedAt), desc(productFavorites.id));
}

export async function setFavoriteActiveForUser(userId: number, id: number, active: boolean) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.update(productFavorites).set({ active }).where(and(
    eq(productFavorites.id, id),
    eq(productFavorites.userId, userId),
  ));
}

export async function listPriceNotificationsForUser(userId: number, limit = 100) {
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  return db.select({
    id: priceNotifications.id,
    favoriteId: priceNotifications.favoriteId,
    comparisonRunId: priceNotifications.comparisonRunId,
    type: priceNotifications.type,
    previousPrice: priceNotifications.previousPrice,
    currentPrice: priceNotifications.currentPrice,
    title: priceNotifications.title,
    message: priceNotifications.message,
    readAt: priceNotifications.readAt,
    createdAt: priceNotifications.createdAt,
    sinyaName: productFavorites.sinyaName,
    sourceKey: productFavorites.sourceKey,
  }).from(priceNotifications)
    .innerJoin(productFavorites, eq(priceNotifications.favoriteId, productFavorites.id))
    .where(eq(productFavorites.userId, userId))
    .orderBy(desc(priceNotifications.createdAt), desc(priceNotifications.id))
    .limit(Math.min(200, Math.max(1, limit)));
}

export async function markPriceNotificationsReadForUser(userId: number, ids: number[]) {
  const eligible = Array.from(new Set(ids)).filter(id => Number.isInteger(id) && id > 0);
  if (!eligible.length) return;
  const db = await getDb();
  if (!db) throw new Error("資料庫目前無法使用");
  await db.update(priceNotifications).set({ readAt: new Date() }).where(sql`
    ${priceNotifications.id} IN ${eligible} AND EXISTS (
      SELECT 1 FROM ${productFavorites}
      WHERE ${productFavorites.id} = ${priceNotifications.favoriteId}
        AND ${productFavorites.userId} = ${userId}
    )
  `);
}
