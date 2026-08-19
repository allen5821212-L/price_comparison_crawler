import { describe, expect, it } from "vitest";
import {
  buildFailureDiagnosticsMarkdown,
  buildGitHubIssueDraftUrl,
  buildGitHubIssueLoginUrl,
} from "../client/src/lib/githubIssueDraft";

const input = {
  jobId: 42,
  scope: "category" as const,
  categoryName: "CPU 中央處理器",
  origin: "https://pricecomp-cr-mlsxyggu.manus.space",
  reportedAt: new Date("2026-08-19T00:00:00.000Z"),
};

describe("GitHub Issue draft diagnostics", () => {
  it("formats a structured Markdown report with the failed job monitor link", () => {
    const markdown = buildFailureDiagnosticsMarkdown(input);

    expect(markdown).toContain("## 價格比對器｜更新失敗診斷資訊");
    expect(markdown).toContain("- **工作編號**：`#42`");
    expect(markdown).toContain("- **更新範圍**：分類更新：CPU 中央處理器");
    expect(markdown).toContain("[開啟工作 #42 的爬蟲監控日誌](https://pricecomp-cr-mlsxyggu.manus.space/crawler?job=42)");
  });

  it("keeps the Issue title and Markdown body prefilled through the GitHub login return URL", () => {
    const draftUrl = buildGitHubIssueDraftUrl(input);
    const draft = new URL(draftUrl);
    const login = new URL(buildGitHubIssueLoginUrl(input));

    expect(draft.origin + draft.pathname).toBe("https://github.com/allen5821212-L/price-comparison-crawler-issues/issues/new");
    expect(draft.searchParams.get("title")).toBe("[價格比對器] 更新失敗：分類更新：CPU 中央處理器（工作 #42）");
    expect(draft.searchParams.get("body")).toContain("### 監控日誌");
    expect(login.origin + login.pathname).toBe("https://github.com/login");
    expect(login.searchParams.get("return_to")).toBe(draftUrl);
  });
});
