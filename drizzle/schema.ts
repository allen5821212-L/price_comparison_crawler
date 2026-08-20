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

/** 可由定期排程或管理員建立的完整／單一分類爬蟲工作。 */
export const crawlerJobs = mysqlTable(
  "crawler_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    scope: mysqlEnum("scope", ["full", "category"]).notNull(),
    trigger: mysqlEnum("trigger", ["scheduled", "manual"]).notNull(),
    status: mysqlEnum("status", ["queued", "running", "completed", "failed", "cancelled"]).default("queued").notNull(),
    categoryId: varchar("category_id", { length: 64 }),
    categoryName: varchar("category_name", { length: 512 }),
    requestedByOpenId: varchar("requested_by_open_id", { length: 64 }),
    executor: varchar("executor", { length: 128 }),
    comparisonRunId: int("comparison_run_id"),
    summary: text("summary"),
    errorMessage: text("error_message"),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  table => ({
    queueIdx: index("crawler_jobs_queue_idx").on(table.status, table.requestedAt),
    requesterIdx: index("crawler_jobs_requester_idx").on(table.requestedByOpenId, table.requestedAt),
  }),
);

/** 供管理員檢視的工作生命週期、失敗與告警事件。 */
export const crawlerEvents = mysqlTable(
  "crawler_events",
  {
    id: int("id").autoincrement().primaryKey(),
    jobId: int("job_id"),
    comparisonRunId: int("comparison_run_id"),
    level: mysqlEnum("level", ["info", "success", "warning", "error"]).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    message: text("message"),
    payload: text("payload"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    createdIdx: index("crawler_events_created_idx").on(table.createdAt),
    jobIdx: index("crawler_events_job_idx").on(table.jobId, table.createdAt),
  }),
);

/** 管理員從失敗工作開啟的 GitHub Issue 草稿，供監控頁追蹤回報脈絡。 */
export const crawlerIssueReports = mysqlTable(
  "crawler_issue_reports",
  {
    id: int("id").autoincrement().primaryKey(),
    jobId: int("job_id").notNull(),
    severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).default("medium").notNull(),
    issueLabel: mysqlEnum("issue_label", ["crawler", "data", "source"]).default("crawler").notNull(),
    issueDraftUrl: text("issue_draft_url").notNull(),
    errorSummary: text("error_summary"),
    createdByOpenId: varchar("created_by_open_id", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueJobReport: uniqueIndex("crawler_issue_reports_job_unique").on(table.jobId),
    createdIdx: index("crawler_issue_reports_created_idx").on(table.createdAt),
  }),
);

/** 管理員關注的原價屋分類缺口；每次既有更新完成後，前台依最新缺口提示手動補抓。 */
export const coolpcCategoryRecrawlReminders = mysqlTable(
  "coolpc_category_recrawl_reminders",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    categoryName: varchar("category_name", { length: 512 }).notNull(),
    active: boolean("active").default(true).notNull(),
    lastNotifiedRunId: int("last_notified_run_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueUserCategory: uniqueIndex("coolpc_recrawl_reminders_user_category_unique").on(table.userId, table.categoryName),
    userActiveIdx: index("coolpc_recrawl_reminders_user_active_idx").on(table.userId, table.active),
  }),
);

/** 管理員可重用的原價屋分類補抓清單；分類以 JSON 字串保存，並嚴格歸屬建立者帳戶。 */
export const coolpcCategoryRecrawlPresets = mysqlTable(
  "coolpc_category_recrawl_presets",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    categoryNames: text("category_names").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueUserName: uniqueIndex("coolpc_recrawl_presets_user_name_unique").on(table.userId, table.name),
    userUpdatedIdx: index("coolpc_recrawl_presets_user_updated_idx").on(table.userId, table.updatedAt),
  }),
);

/** 使用者收藏的欣亞來源商品，可選擇指定可接受價格。 */
export const productFavorites = mysqlTable(
  "product_favorites",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    sourceKey: varchar("source_key", { length: 128 }).notNull(),
    sinyaName: varchar("sinya_name", { length: 1024 }).notNull(),
    targetPrice: int("target_price"),
    lastKnownPrice: int("last_known_price"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueUserSource: uniqueIndex("product_favorites_user_source_unique").on(table.userId, table.sourceKey),
    userActiveIdx: index("product_favorites_user_active_idx").on(table.userId, table.active),
  }),
);

/** 每次收藏商品價格下降或達標時建立的站內通知。 */
export const priceNotifications = mysqlTable(
  "price_notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    favoriteId: int("favorite_id").notNull(),
    comparisonRunId: int("comparison_run_id"),
    type: mysqlEnum("type", ["price_drop", "target_reached"]).notNull(),
    previousPrice: int("previous_price"),
    currentPrice: int("current_price").notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    message: text("message"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    favoriteCreatedIdx: index("price_notifications_favorite_created_idx").on(table.favoriteId, table.createdAt),
  }),
);

export type ComparisonRun = typeof comparisonRuns.$inferSelect;
export type ComparisonProduct = typeof comparisonProducts.$inferSelect;
export type ComparisonMatch = typeof comparisonMatches.$inferSelect;
export type ComparisonPriceHistory = typeof comparisonPriceHistory.$inferSelect;
export type CrawlerJob = typeof crawlerJobs.$inferSelect;
export type CrawlerEvent = typeof crawlerEvents.$inferSelect;
export type CrawlerIssueReport = typeof crawlerIssueReports.$inferSelect;
export type CoolpcCategoryRecrawlPreset = typeof coolpcCategoryRecrawlPresets.$inferSelect;
export type ProductFavorite = typeof productFavorites.$inferSelect;
export type PriceNotification = typeof priceNotifications.$inferSelect;
