import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CrawlerIssueReportLink } from "./CrawlerMonitor";

describe("CrawlerMonitor Issue report link", () => {
  it("renders the persisted severity, label, and clickable Issue draft URL", () => {
    const html = renderToStaticMarkup(<CrawlerIssueReportLink issueReport={{
      severity: "high",
      issueLabel: "source",
      issueDraftUrl: "https://github.com/allen5821212-L/price-comparison-crawler-issues/issues/new?title=test",
    }} />);
    expect(html).toContain("source · high");
    expect(html).toContain("已建立 Issue 草稿");
    expect(html).toContain("https://github.com/allen5821212-L/price-comparison-crawler-issues/issues/new?title=test");
  });
});
