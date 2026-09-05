# 第二批資料存取與授權收斂優化報告

本報告記錄相對於第一批檢查點 `fd0102ae` 的第二批四項指定優化。變更僅涵蓋價格歷史按需讀取、審核佇列 SQL 下推、已完成批次資料保留，以及指定營運端點的授權收斂；前台資料來源仍以**最新 `status='completed'` 的 comparison run**為準。

## 變更總覽

| 項目 | 結果 | API／使用者可見行為 |
| --- | --- | --- |
| 1. 單品價格歷史 | 完成 | 對話框先載入最新快照商品選單，選定商品後才請求 7–90 日、預設 30 日的單品歷史。|
| 2. 審核佇列 SQL 下推 | 完成 | 資料庫完成篩選、排序與分頁；摘要改為獨立 `COUNT/GROUP BY` 聚合。|
| 3. 30 批 completed 資料保留 | 完成 | completed run 寫入完成後，`comparison_matches` 與過期 `comparison_products` 均以每批 5,000 筆清理。|
| 4. 授權收斂 | 完成 | 指定 coverage／gap、規則與別名端點已受管理員或 loopback 限制；公開同步狀態僅保留生命週期欄位。|

## 實際修改檔案與目前行號

| 檔案 | 目前行號 | 變更用途 |
| --- | ---: | --- |
| `server/db.ts` | 857–1009、1618–1690 | SQL 審核佇列與摘要、單品價格歷史、窄化公開 status。|
| `server/routers.ts` | 127–128、156–157、371–397 | 新舊 history 契約替換、管理員程序收斂。|
| `client/src/components/PriceHistoryDialog.tsx` | 37–76 | 商品選單與按需單品歷史查詢。|
| `drizzle/schema.ts` | 343–378 | 審核實體欄位與兩個查詢索引。|
| `drizzle/0022_calm_bedlam.sql` | 1–34 | Drizzle 生成的欄位／索引／最近 30 批回填 migration。|
| `drizzle/meta/_journal.json`、`drizzle/meta/0022_snapshot.json` | 生成檔 | 由 Drizzle migration generation 自動更新；未手改 meta。|
| `crawler/dynamic_store.py` | 99–175、332–465 | 寫入 review 實體欄位與 5,000 筆批次保留清理。|
| `crawler/test_price_notification_dispatch.py` | 新增 retention 測試 | 驗證清理保留最近 completed run 並處理 `NULL last_seen_run_id`。|
| `server/_core/index.ts` | 43–53 | `GET /api/matching-rules` 在讀取資料前採 loopback-only 拒絕。|
| `client/src/pages/CoolpcCoveragePage.tsx` | 44–53 | coverage 與 unlisted query 僅在管理員角色時啟用。|
| `client/src/pages/CoolpcOnlyPage.tsx` | 162–186 | coverage／gap／reminder／preset query 均加管理員 gate，token query 保留並合併既有條件。|
| `server/matchRules.test.ts` | 357–364 等 | 更新 history／授權／status 的路由契約測試。|
| `client/src/components/PriceHistoryDialog.test.tsx` | 全檔新增 | 驗證未選商品前 history query disabled、選取後才 enabled。|
| `client/src/pages/CoolpcAdminQueryGating.test.tsx` | 全檔新增 | 以完整頁面渲染驗證匿名使用者的 7 支敏感 query 全為 disabled。|
| `todo-qr7awk8p.md` | 140–150 | 第二批工作與驗收完成紀錄。|

## 1. 單品價格歷史與輕量商品選單

舊版 `comparison.history` 讀取全站歷史，再在 Node 端按日期分組。現在改為公開的 `comparison.historyProducts` 與 `comparison.historyForProduct`；對話框初始開啟仍會依 `initialProduct` 自動選取相同商品，而在使用者尚未選擇商品時，單品歷史 query 不會發送。

> 搜尋 `server/` 與 `client/` 的 TypeScript／TSX 原始檔後，**找不到目標** `getDynamicPriceHistory` 與 `comparison.history` 的殘留呼叫；新 history 端點僅由對話框與契約測試使用。

**資料層：`server/db.ts:1618–1653`**

改動前（舊全站掃描）
```ts
export async function getDynamicPriceHistory() {
  const rows = await db.select({
    snapshotDate: comparisonPriceHistory.snapshotDate,
    sourceKey: comparisonPriceHistory.sourceKey,
    sinyaName: comparisonPriceHistory.sinyaName,
  }).from(comparisonPriceHistory)
    .orderBy(comparisonPriceHistory.snapshotDate, comparisonPriceHistory.sourceKey);
  const days = new Map<string, { date: string; matched: unknown[] }>();
```

改動後（最新快照商品選單與 sourceKey/date 下推）
```ts
export async function listLatestPriceHistoryProducts() {
  return db.select({ sourceKey: comparisonPriceHistory.sourceKey, sinyaName: comparisonPriceHistory.sinyaName })
    .from(comparisonPriceHistory)
    .where(sql`${comparisonPriceHistory.snapshotDate} = (SELECT MAX(snapshot_date) FROM comparison_price_history)`)
    .groupBy(comparisonPriceHistory.sourceKey, comparisonPriceHistory.sinyaName);
}
export async function getPriceHistoryForProduct(input: { sourceKey: string; days: number }) {
  return db.select({ snapshotDate: comparisonPriceHistory.snapshotDate, sinyaName: comparisonPriceHistory.sinyaName })
    .from(comparisonPriceHistory).where(and(eq(comparisonPriceHistory.sourceKey, input.sourceKey),
      sql`${comparisonPriceHistory.snapshotDate} >= CURDATE() - INTERVAL ${input.days} DAY`));
}
```

**契約與前端：`server/routers.ts:371–377`、`PriceHistoryDialog.tsx:37–58`**

改動前（單一全站端點）
```ts
/** Database-backed history replaces price_history.json. */
history: publicProcedure.query(async () => getDynamicPriceHistory()),
```

改動後（輸入限制與按需讀取）
```ts
historyProducts: publicProcedure.query(async () => listLatestPriceHistoryProducts()),
historyForProduct: publicProcedure.input(z.object({
  sourceKey: z.string().min(1).max(128),
  days: z.number().int().min(7).max(90).default(30),
})).query(async ({ input }) => getPriceHistoryForProduct(input)),

const productHistoryQuery = trpc.comparison.historyForProduct.useQuery(
  { sourceKey: selectedSourceKey ?? "", days: 30 },
  { enabled: open && Boolean(selectedSourceKey) },
);
```

## 2. 審核摘要聚合與佇列 SQL 下推

審核關鍵欄位於 crawler 寫入時實體化為 `reviewable`、severity、risk score、fingerprint 與三個平台旗標。佇列以 SQL 做 completed run、reviewable、已略過／已解決、severity、platform、搜尋條件與排序分頁；指派及管理員資料只依本頁的 `(sourceKey, fingerprint)` 集合讀取。payload 僅限當頁列資料再解析，以保留既有顯示項目。

**資料層：`server/db.ts:882–941`**

改動前（全批 match、全表 skip／assignment 在 Node 過濾）
```ts
const rows = await db.select({ /* match payload fields */ })
  .from(comparisonMatches).where(eq(comparisonMatches.runId, run.id));
const reviewRows = rows.map(row => ({ ...row, ...parseReviewMatchSignals(row.payload) }));
const [skippedRows, assignmentRows, assignees] = await Promise.all([
  db.select({ fingerprint: matchReviewSkips.fingerprint }).from(matchReviewSkips),
  db.select().from(matchReviewAssignments),
  db.select({ id: users.id, name: users.name }).from(users),
]);
```

改動後（SQL 篩選、排序、頁面邊界）
```ts
const where = and(...conditions)!;
const [totalRows, summaryRows] = await Promise.all([
  db.select({ total: sql<number>`COUNT(*)` }).from(comparisonMatches).where(where),
  db.select({ severity: comparisonMatches.reviewSeverity, total: sql<number>`COUNT(*)` })
    .from(comparisonMatches).where(where).groupBy(comparisonMatches.reviewSeverity),
]);
const rows = await db.select({ /* existing display fields plus reviewFingerprint */ })
  .from(comparisonMatches).where(where)
  .orderBy(desc(comparisonMatches.reviewRiskScore), asc(comparisonMatches.score), asc(comparisonMatches.sinyaName))
  .limit(pageSize).offset((page - 1) * pageSize);
```

**摘要：`server/db.ts:983–1009`**

改動前
```ts
export async function getLatestMatchReviewSummary() {
  const queue = await getLatestMatchReviewQueue({ page: 1, pageSize: 10 });
  return { run: queue.run, ...queue.summary };
}
```

改動後
```ts
const rows = await db.select({ severity: comparisonMatches.reviewSeverity, total: sql<number>`COUNT(*)` })
  .from(comparisonMatches).where(and(
    eq(comparisonMatches.runId, run.id), eq(comparisonMatches.reviewable, true),
    sql`NOT EXISTS (SELECT 1 FROM ${matchReviewSkips} WHERE ${matchReviewSkips.fingerprint} = ${comparisonMatches.reviewFingerprint})`,
    sql`NOT EXISTS (SELECT 1 FROM ${matchReviewAssignments} WHERE ${matchReviewAssignments.sourceKey} = ${comparisonMatches.sourceKey} AND ${matchReviewAssignments.fingerprint} = ${comparisonMatches.reviewFingerprint} AND ${matchReviewAssignments.status} = 'resolved')`,
  )).groupBy(comparisonMatches.reviewSeverity);
```

**實體欄位與寫入：`drizzle/schema.ts:343–378`、`crawler/dynamic_store.py:141–175`**

改動前
```ts
hasSpecDiff: boolean("has_spec_diff").default(false).notNull(),
payload: text("payload").notNull(),
createdAt: timestamp("created_at").defaultNow().notNull(),
```

改動後
```ts
reviewable: boolean("reviewable").default(false).notNull(),
reviewSeverity: mysqlEnum("review_severity", ["medium", "high", "critical"]),
reviewRiskScore: int("review_risk_score"), reviewFingerprint: varchar("review_fingerprint", { length: 64 }),
reviewHasCoolpc: boolean("review_has_coolpc").default(false).notNull(),
reviewQueueIdx: index("comparison_matches_review_queue_idx")
  .on(table.runId, table.reviewable, table.reviewSeverity, table.reviewRiskScore, table.score),
```

資料庫的欄位與兩個索引已實際存在。最近 30 個 completed run 共驗證到 **38,751** 筆 match，其中 **21,904** 筆 `reviewable`，且 `reviewable_without_fingerprint = 0`。migration 的價差判斷使用 `ROUND(..., 3)`，與 crawler `_review_metadata()` 的三位小數判斷保持一致。

## 3. 已完成批次資料保留策略

清理僅在 run 寫入完畢、標記為 `completed` 之後執行，並位於成功交易提交前。保留清單依 `finished_at DESC, id DESC` 取最近 30 個 completed run；每個 DELETE 都以 `LIMIT %s` 和固定 `batch_size=5000` 的迴圈執行，並顯式納入 `last_seen_run_id IS NULL` 的遺留商品。

**保留實作：`crawler/dynamic_store.py:332–361、441–466`**

改動前（完成後無 match／catalog 保留清理）
```py
cursor.execute("DELETE FROM comparison_price_history WHERE snapshot_date < %s", (snapshot_date - timedelta(days=90),))
cursor.execute("UPDATE comparison_runs SET status='completed', ... WHERE id=%s", (..., run_id))
connection.commit()
return run_id
```

改動後（5000 筆 bounded DELETE）
```py
def _delete_in_batches(cursor: Any, statement: str, batch_size: int = 5000) -> int:
    total_deleted = 0
    while True:
        cursor.execute(statement, (batch_size,))
        deleted = max(0, int(cursor.rowcount or 0))
        total_deleted += deleted
        if deleted < batch_size: return total_deleted

deleted_products = _delete_in_batches(cursor, f"""
    DELETE FROM comparison_products
    WHERE last_seen_run_id IS NULL OR last_seen_run_id NOT IN ({retained_runs})
    LIMIT %s
""")
```

## 4. 公開端點收斂與前端管理員閘門

`comparison.status` 維持公開，但資料層以明確 select 只返回 `id`、`status`、`startedAt`、`finishedAt`，不再帶出 totals、價格指標或錯誤訊息。`comparison.refreshEstimates` 維持公開。coverage／gap 四端點與 tRPC 規則／別名匯出皆改為 `adminProcedure`；REST 規則 GET 會在任何資料查詢之前檢查 socket 是否為 loopback。

**公開 status 與 router：`server/db.ts:1672–1690`、`server/routers.ts:371–397`**

改動前
```ts
const [latestRun] = await db.select().from(comparisonRuns)
  .orderBy(desc(comparisonRuns.id)).limit(1);
coolpcCoverage: publicProcedure.query(async () => getCoolpcCoverageSummary()),
sinyaCoverage: publicProcedure.query(async () => getSinyaCoverageSummary()),
```

改動後
```ts
const statusFields = { id: comparisonRuns.id, status: comparisonRuns.status,
  startedAt: comparisonRuns.startedAt, finishedAt: comparisonRuns.finishedAt };
const [latestRun] = await db.select(statusFields).from(comparisonRuns)
  .orderBy(desc(comparisonRuns.id)).limit(1);
coolpcCoverage: adminProcedure.query(async () => getCoolpcCoverageSummary()),
coolpcUnlisted: adminProcedure.input(/* existing pagination input */).query(/* unchanged data helper */),
sinyaCoverage: adminProcedure.query(async () => getSinyaCoverageSummary()),
sinyaUnlisted: adminProcedure.input(/* existing pagination input */).query(/* unchanged data helper */),
```

**REST 規則匯出：`server/_core/index.ts:43–52`**

改動前
```ts
app.get("/api/matching-rules", async (_req, res) => {
  try {
    const [rules, negativeFeatures, brandAliases] = await Promise.all([...]);
    res.json({ rules, negativeFeatures, brandAliases });
```

改動後
```ts
app.get("/api/matching-rules", async (req, res) => {
  const remoteAddress = req.socket.remoteAddress || "";
  const isLoopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress.endsWith("127.0.0.1");
  if (!isLoopback) return res.status(403).json({ error: "crawler endpoint is loopback-only" });
  try {
    const [rules, negativeFeatures, brandAliases] = await Promise.all([...]);
```

**前端閘門：`CoolpcCoveragePage.tsx:48–53`、`CoolpcOnlyPage.tsx:177–186`**

改動前
```tsx
const coverageQuery = trpc.comparison.coolpcCoverage.useQuery();
const unlistedQuery = trpc.comparison.coolpcUnlisted.useQuery({ category, page, pageSize: 25 });
const remindersQuery = trpc.crawler.coolpcRecrawlReminders.useQuery(undefined, { refetchInterval: 60_000 });
const sharedTemplateQuery = trpc.crawler.coolpcRecrawlPresetTemplateByToken.useQuery({ token }, { enabled: Boolean(token) });
```

改動後
```tsx
const coverageQuery = trpc.comparison.coolpcCoverage.useQuery(undefined, { enabled: user?.role === "admin" });
const unlistedQuery = trpc.comparison.coolpcUnlisted.useQuery({ category, page, pageSize: 25 }, { enabled: user?.role === "admin" });
const remindersQuery = trpc.crawler.coolpcRecrawlReminders.useQuery(undefined, { enabled: user?.role === "admin", refetchInterval: 60_000 });
const sharedTemplateQuery = trpc.crawler.coolpcRecrawlPresetTemplateByToken.useQuery(
  { token: sharedTemplateToken ?? "invalid" }, { enabled: user?.role === "admin" && Boolean(sharedTemplateToken) },
);
```

## 驗證結果

| 驗證 | 結果 |
| --- | --- |
| `pnpm test` | **41 test files、135 tests passed**。|
| `python -m pytest crawler/`（排除三支需 server 的 E2E 與單獨 acceptance） | **收集 25 items，25 passed**。|
| `python crawler/test_acceptance.py; echo "exit=$?"` | A 組 **14 PASS / 0 FAIL**、B 組 **9 PASS / 0 FAIL**、`exit=0`。|
| `pnpm build` | 成功完成 Vite 與伺服器 bundle。僅有既有 chunk size 建議，非建置失敗。|
| `pnpm check` | `tsc --noEmit` 成功。|
| 匿名 protected tRPC HTTP | `comparison.coolpcCoverage`、`coolpcUnlisted`、`sinyaCoverage`、`sinyaUnlisted` 均回傳 **HTTP 403 / FORBIDDEN**。|
| 匿名外部 REST 規則匯出 | 外部預覽網域 `GET /api/matching-rules` 回傳 **HTTP 403**；本機 crawler 路徑回傳 **HTTP 200**。|
| 匿名頁面網路驗收 | 用獨立 Chromium profile 載入 `/coverage`、`/coolpc-only`。兩頁均保留既有 `Sign in to continue` 提示；網路紀錄只見 `auth.me` bootstrap，**找不到目標**八支受保護的 coverage／gap／reminder／preset tRPC 請求。|
| 管理員頁面實測 | 已登入管理員載入 `/coverage` 與 `/coolpc-only`，兩頁皆顯示既有上架率、缺口、常用清單／執行歷程資料，未執行任何寫入操作。|

## 測試基礎設施修正說明

新增的 `CoolpcAdminQueryGating.test.tsx` 首次執行曾因 Vitest mock 提升順序、`DashboardLayout` 預設匯出與完整頁面所建立的 crawler mutation 替身未列全而失敗。此失敗屬於**本批新增測試的 mock 基礎設施**，並非產品程式或既有測試迴歸；修正僅限該測試的 mock 定義，沒有為了通過測試修改產品邏輯或放寬斷言。修正後該測試 2/2 通過，並包含於完整 135 項 Vitest 回歸中。

## 範圍與結論

所有指定目標均已找到並處理，**沒有找不到目標而被靜默略過的項目**。未變更 matcher 輸出、公開比價的 latest-completed invariant、套件版本、介面樣式或任何範圍外程式。migration 由 Drizzle 生成，資料庫已驗證欄位／索引／回填指紋完整性；不需要也不應對已升級資料庫重複套用完整 DDL migration。
