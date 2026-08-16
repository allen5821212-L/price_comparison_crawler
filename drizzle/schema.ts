import { boolean, date, decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 人工確認的跨平台商品對應。每個欣亞商品可在各平台有一筆有效確認，
 * 爬蟲會在下一次資料更新時以此為優先規則，避免自動計分覆蓋人工判斷。
 */
export const matchingFeedback = mysqlTable(
  "matching_feedback",
  {
    id: int("id").autoincrement().primaryKey(),
    sinyaName: varchar("sinya_name", { length: 512 }).notNull(),
    targetName: varchar("target_name", { length: 512 }).notNull(),
    targetId: varchar("target_id", { length: 255 }),
    sourceAlias: varchar("source_alias", { length: 255 }),
    targetAlias: varchar("target_alias", { length: 255 }),
    platform: mysqlEnum("platform", ["coolpc", "pchome", "momo"]).notNull(),
    createdByOpenId: varchar("created_by_open_id", { length: 64 }).notNull(),
    active: boolean("active").default(true).notNull(),
    hitCount: int("hit_count").default(0).notNull(),
    lastHitAt: timestamp("last_hit_at"),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueSourcePlatform: uniqueIndex("matching_feedback_source_platform_unique").on(
      table.sinyaName,
      table.platform,
    ),
  }),
);

export type MatchingFeedback = typeof matchingFeedback.$inferSelect;
export type InsertMatchingFeedback = typeof matchingFeedback.$inferInsert;

/**
 * 每次四平台爬蟲的執行生命週期與彙總數據。
 * 只有 completed 的最新一筆會提供給公開比價 API，避免失敗中的爬蟲覆蓋使用者目前看到的資料。
 */
export const comparisonRuns = mysqlTable(
  "comparison_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    status: mysqlEnum("status", ["running", "completed", "failed"]).default("running").notNull(),
    sinyaTotal: int("sinya_total").default(0).notNull(),
    coolpcTotal: int("coolpc_total").default(0).notNull(),
    pchomeTotal: int("pchome_total").default(0).notNull(),
    momoTotal: int("momo_total").default(0).notNull(),
    matchedTotal: int("matched_total").default(0).notNull(),
    sinyaCheaper: int("sinya_cheaper").default(0).notNull(),
    coolpcCheaper: int("coolpc_cheaper").default(0).notNull(),
    pchomeCheaper: int("pchome_cheaper").default(0).notNull(),
    momoCheaper: int("momo_cheaper").default(0).notNull(),
    samePrice: int("same_price").default(0).notNull(),
    avgPriceDiff: decimal("avg_price_diff", { precision: 12, scale: 2 }).default("0").notNull(),
    sinyaCategories: text("sinya_categories"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  table => ({
    statusFinishedIdx: index("comparison_runs_status_finished_idx").on(table.status, table.finishedAt),
  }),
);

/** Current catalog records observed by the latest successful crawl. */
export const comparisonProducts = mysqlTable(
  "comparison_products",
  {
    id: int("id").autoincrement().primaryKey(),
    platform: mysqlEnum("platform", ["sinya", "coolpc", "pchome", "momo"]).notNull(),
    externalId: varchar("external_id", { length: 255 }).notNull(),
    name: varchar("name", { length: 1024 }).notNull(),
    subtitle: text("subtitle"),
    price: int("price").notNull(),
    originalPrice: int("original_price"),
    url: text("url"),
    image: text("image"),
    category: varchar("category", { length: 512 }),
    lastSeenRunId: int("last_seen_run_id").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniquePlatformExternal: uniqueIndex("comparison_products_platform_external_unique").on(table.platform, table.externalId),
    currentCatalogIdx: index("comparison_products_current_catalog_idx").on(table.lastSeenRunId, table.platform, table.category),
  }),
);

/**
 * 已完成爬蟲的目前配對結果。payload 保留原始四平台欄位，讓前端可無損延續既有顯示契約；
 * 重要篩選欄位另行正規化，方便後續改成伺服器端篩選與分頁。
 */
export const comparisonMatches = mysqlTable(
  "comparison_matches",
  {
    id: int("id").autoincrement().primaryKey(),
    runId: int("run_id").notNull(),
    sourceKey: varchar("source_key", { length: 128 }).notNull(),
    sinyaName: varchar("sinya_name", { length: 1024 }).notNull(),
    coolpcName: varchar("coolpc_name", { length: 1024 }),
    pchomeName: varchar("pchome_name", { length: 1024 }),
    momoName: varchar("momo_name", { length: 1024 }),
    category: varchar("category", { length: 512 }),
    sinyaPrice: int("sinya_price").notNull(),
    coolpcPrice: int("coolpc_price").notNull(),
    pchomePrice: int("pchome_price"),
    momoPrice: int("momo_price"),
    priceDiff: int("price_diff").notNull(),
    cheaper: mysqlEnum("cheaper", ["sinya", "coolpc", "pchome", "momo", "tie"]).notNull(),
    score: decimal("score", { precision: 7, scale: 4 }).notNull(),
    hasSpecDiff: boolean("has_spec_diff").default(false).notNull(),
    payload: text("payload").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    uniqueRunSource: uniqueIndex("comparison_matches_run_source_unique").on(table.runId, table.sourceKey),
    currentMatchIdx: index("comparison_matches_current_match_idx").on(table.runId, table.category, table.cheaper),
    scoreIdx: index("comparison_matches_score_idx").on(table.runId, table.score),
  }),
);

/** One snapshot per product and date; every same-day crawl refreshes that day's values. */
export const comparisonPriceHistory = mysqlTable(
  "comparison_price_history",
  {
    id: int("id").autoincrement().primaryKey(),
    snapshotDate: date("snapshot_date").notNull(),
    sourceKey: varchar("source_key", { length: 128 }).notNull(),
    sinyaName: varchar("sinya_name", { length: 1024 }).notNull(),
    coolpcName: varchar("coolpc_name", { length: 1024 }),
    pchomeName: varchar("pchome_name", { length: 1024 }),
    momoName: varchar("momo_name", { length: 1024 }),
    sinyaPrice: int("sinya_price").notNull(),
    coolpcPrice: int("coolpc_price").notNull(),
    pchomePrice: int("pchome_price"),
    momoPrice: int("momo_price"),
    priceDiff: int("price_diff").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueDailySnapshot: uniqueIndex("comparison_history_daily_source_unique").on(table.snapshotDate, table.sourceKey),
    productHistoryIdx: index("comparison_history_product_idx").on(table.sourceKey, table.snapshotDate),
  }),
);

export type ComparisonRun = typeof comparisonRuns.$inferSelect;
export type ComparisonProduct = typeof comparisonProducts.$inferSelect;
export type ComparisonMatch = typeof comparisonMatches.$inferSelect;
export type ComparisonPriceHistory = typeof comparisonPriceHistory.$inferSelect;
