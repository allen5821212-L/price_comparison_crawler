import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoverageQueryErrorPanel, isLowCoverage, LOW_COVERAGE_THRESHOLD } from "./CoolpcCoveragePage";

describe("CoolpcCoveragePage query failures", () => {
  it("renders the coverage-summary error and retry action", () => {
    const html = renderToStaticMarkup(<CoverageQueryErrorPanel title="無法載入上架覆蓋率" error={new Error("資料庫暫時無法連線")} fallback="請稍後再試" onRetry={vi.fn()} />);
    expect(html).toContain("無法載入上架覆蓋率");
    expect(html).toContain("資料庫暫時無法連線");
    expect(html).toContain("重新嘗試");
  });

  it("renders the unmatched-list fallback error and retry action", () => {
    const html = renderToStaticMarkup(<CoverageQueryErrorPanel title="無法載入未上架商品清單" error={null} fallback="請稍後重新嘗試。" onRetry={vi.fn()} />);
    expect(html).toContain("無法載入未上架商品清單");
    expect(html).toContain("請稍後重新嘗試。");
    expect(html).toContain("重新嘗試");
  });
});

describe("CoolPC coverage warning threshold", () => {
  it("only flags categories below 50 percent", () => {
    expect(LOW_COVERAGE_THRESHOLD).toBe(0.5);
    expect(isLowCoverage(0.499)).toBe(true);
    expect(isLowCoverage(0.5)).toBe(false);
    expect(isLowCoverage(0.9)).toBe(false);
  });
});
