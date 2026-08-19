export type FailureIssueDraftInput = {
  jobId: number;
  scope: "full" | "category";
  categoryName?: string | null;
  origin: string;
  reportedAt: Date;
};

export const GITHUB_ISSUES_NEW_URL = "https://github.com/allen5821212-L/price-comparison-crawler-issues/issues/new";

function scopeLabel(input: FailureIssueDraftInput): string {
  return input.scope === "full"
    ? "完整四平台更新"
    : `分類更新：${input.categoryName ?? "未記錄分類"}`;
}

export function buildFailureDiagnosticsMarkdown(input: FailureIssueDraftInput): string {
  const updateScope = scopeLabel(input);
  const monitorUrl = `${input.origin}/crawler?job=${input.jobId}`;
  return [
    "## 價格比對器｜更新失敗診斷資訊",
    "",
    "### 工作資訊",
    `- **工作編號**：\`#${input.jobId}\``,
    `- **更新範圍**：${updateScope}`,
    "- **工作狀態**：`failed`",
    `- **回報時間**：${input.reportedAt.toLocaleString("zh-TW")}`,
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
  });
  return `${GITHUB_ISSUES_NEW_URL}?${params.toString()}`;
}

export function buildGitHubIssueLoginUrl(input: FailureIssueDraftInput): string {
  return `https://github.com/login?return_to=${encodeURIComponent(buildGitHubIssueDraftUrl(input))}`;
}
