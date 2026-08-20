import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createBatchCategoryRequest, nextSelectedCategories, RecrawlReminderSummary } from "./CoolpcOnlyPage";

describe("CoolpcOnlyPage recrawl reminder summary", () => {
  it("顯示由歷史分類工作推導的 ETA 與最近成功結果", () => {
    const html = renderToStaticMarkup(<RecrawlReminderSummary reminder={{
      estimateMs: 82 * 60_000,
      estimateSampleSize: 3,
      latestJob: {
        status: "completed",
        startedAt: new Date("2026-08-20T00:00:00.000Z"),
        finishedAt: new Date("2026-08-20T01:22:00.000Z"),
        durationMs: 82 * 60_000,
      },
    }} />);

    expect(html).toContain("預估補抓時間：1 小時 22 分（依 3 筆分類工作）");
    expect(html).toContain("最近補抓：已完成 · 耗時 1 小時 22 分");
  });

  it("尚無歷史分類工作時維持清楚的空狀態", () => {
    const html = renderToStaticMarkup(<RecrawlReminderSummary reminder={{ estimateMs: null, estimateSampleSize: 0, latestJob: null }} />);
    expect(html).toContain("累積更多分類補抓紀錄後提供");
    expect(html).toContain("最近補抓：尚無分類補抓紀錄");
  });
});

describe("CoolpcOnlyPage category selection", () => {
  it("可累積與取消勾選，並遵守批次上限", () => {
    let selected = nextSelectedCategories(new Set(), "鍵盤", true, 2);
    selected = nextSelectedCategories(selected, "筆電", true, 2);
    expect(Array.from(selected)).toEqual(["鍵盤", "筆電"]);

    expect(Array.from(nextSelectedCategories(selected, "網通", true, 2))).toEqual(["鍵盤", "筆電"]);
    expect(Array.from(nextSelectedCategories(selected, "鍵盤", false, 2))).toEqual(["筆電"]);
  });

  it("批次送出會將全部已勾選分類作為 categoryNames 輸入", () => {
    const selected = new Set(["鍵盤+鼠｜搖桿｜桌+椅", "筆電｜平板｜穿戴配件"]);
    expect(createBatchCategoryRequest(selected)).toEqual({
      categoryNames: ["鍵盤+鼠｜搖桿｜桌+椅", "筆電｜平板｜穿戴配件"],
    });
  });
});
