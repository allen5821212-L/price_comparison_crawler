import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  comparisonMatches,
  comparisonPriceHistory,
  comparisonProducts,
  comparisonRuns,
  InsertUser,
  matchingFeedback,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';

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

/** Searches only the active platform catalog needed by the manual-match dialog. */
export async function searchDynamicProducts(input: {
  platform: "coolpc" | "pchome" | "momo";
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
      or(like(comparisonProducts.name, pattern), like(comparisonProducts.subtitle, pattern))!,
    ))
    .orderBy(asc(comparisonProducts.name))
    .limit(Math.min(50, Math.max(1, input.limit ?? 50)));

  return rows.map(mapDynamicProduct);
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
  const [run] = await db.select().from(comparisonRuns)
    .orderBy(desc(comparisonRuns.id)).limit(1);
  return run ?? null;
}
