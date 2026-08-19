export type FailureIssueDraftInput = {
  jobId: number;
  scope: "full" | "category";
  categoryName?: string | null;
  origin: string;
  reportedAt: Date;
  severity?: "low" | "medium" | "high" | "critical";
  issueLabel?: "crawler" | "data" | "source";
  errorSummary?: Array<{ title: string; message?: string | null; createdAt?: Date | string | null }>;
};

export const GITHUB_ISSUES_NEW_URL = "https://github.com/allen5821212-L/price-comparison-crawler-issues/issues/new";

function scopeLabel(input: FailureIssueDraftInput): string {
  return input.scope === "full"
    ? "完整四平台更新"
    : `分類更新：${input.categoryName ?? "未記錄分類"}`;
}

const severityLabels = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "緊急",
} as const;

const issueLabelNames = {
  crawler: "爬蟲執行器",
  data: "資料／比對結果",
  source: "來源網站",
} as const;

export function buildFailureDiagnosticsMarkdown(input: FailureIssueDraftInput): string {
  const updateScope = scopeLabel(input);
  const monitorUrl = `${input.origin}/crawler?job=${input.jobId}`;
  const severity = input.severity ?? "medium";
  const issueLabel = input.issueLabel ?? "crawler";
  const eventLines = input.errorSummary?.length
    ? input.errorSummary.map(event => `- **${event.title}**${event.message ? `：${event.message}` : ""}${event.createdAt ? `（${new Date(event.createdAt).toLocaleString("zh-TW")}）` : ""}`)
    : ["- 尚未取得額外錯誤事件；請開啟監控日誌查看工作詳細紀錄。"];
  return [
    "## 價格比對器｜更新失敗診斷資訊",
    "",
    "### 工作資訊",
    `- **工作編號**：\`#${input.jobId}\``,
    `- **更新範圍**：${updateScope}`,
    "- **工作狀態**：`failed`",
    `- **嚴重程度**：${severityLabels[severity]}（\`severity:${severity}\`）`,
    `- **回報分類**：${issueLabelNames[issueLabel]}（\`${issueLabel}\`）`,
    `- **回報時間**：${input.reportedAt.toLocaleString("zh-TW")}`,
    "",
    "### 最新錯誤摘要",
    ...eventLines,
    "",
    "### 監控日誌",
    `- [開啟工作 #${input.jobId} 的爬蟲監控日誌](${monitorUrl})`,
    "",
    "### 回報時請附上",
    "- 上方工作資訊與相關事件日誌。",
    "- 觸發更新前選擇的分類或操作步驟。",
  ].join("\n");
}

export function buildGitHubIssueDraftUrl(input: FailureIssueDraftInput): string {
  const updateScope = scopeLabel(input);
  const title = `[價格比對器] 更新失敗：${updateScope}（工作 #${input.jobId}）`;
  const params = new URLSearchParams({
    title,
    body: buildFailureDiagnosticsMarkdown(input),
    labels: ["bug", input.issueLabel ?? "crawler", `severity:${input.severity ?? "medium"}`].join(","),
  });
  return `${GITHUB_ISSUES_NEW_URL}?${params.toString()}`;
}

export function buildGitHubIssueLoginUrl(input: FailureIssueDraftInput): string {
  return `https://github.com/login?return_to=${encodeURIComponent(buildGitHubIssueDraftUrl(input))}`;
}
