import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createBatchCategoryRequest, createRecrawlPresetImportInput, createRecrawlPresetInput, createRecrawlPresetReorderInput, formatRecrawlExecutionProgress, formatRecrawlExecutionSuccessRate, moveRecrawlPresetId, nextSelectedCategories, readRecrawlPresetDragPayload, RecrawlReminderSummary, RECRAWL_PRESET_DRAG_MIME, reorderRecrawlPresetIds, shouldShowRecrawlPresetManager, writeRecrawlPresetDragPayload } from "./CoolpcOnlyPage";

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

  it("儲存常用清單時會修剪名稱並保留全部已勾選分類", () => {
    expect(createRecrawlPresetInput("  週末高缺口  ", new Set(["鍵盤", "筆電"]))).toEqual({
      name: "週末高缺口",
      categoryNames: ["鍵盤", "筆電"],
    });
  });

  it("拖曳常用清單可將來源移至目標位置，且同一項目不會造成無意義的重排", () => {
    expect(reorderRecrawlPresetIds([11, 22, 33], 33, 11)).toEqual([33, 11, 22]);
    expect(reorderRecrawlPresetIds([11, 22, 33], 22, 22)).toEqual([11, 22, 33]);
    expect(reorderRecrawlPresetIds([11, 22, 33], 99, 11)).toEqual([11, 22, 33]);
  });

  it("DataTransfer 拖放會讀取來源清單並提交重排後的排序輸入", () => {
    const data = new Map<string, string>();
    const transfer = {
      effectAllowed: "none",
      getData: (type: string) => data.get(type) ?? "",
      setData: (type: string, value: string) => data.set(type, value),
    };

    writeRecrawlPresetDragPayload(transfer as unknown as DataTransfer, 22);
    expect(data.get(RECRAWL_PRESET_DRAG_MIME)).toBe("22");
    expect(transfer.effectAllowed).toBe("move");
    const sourceId = readRecrawlPresetDragPayload(transfer as unknown as DataTransfer);
    expect(createRecrawlPresetReorderInput(reorderRecrawlPresetIds([11, 22], sourceId ?? 0, 11))).toEqual({ ids: [22, 11] });
  });

  it("鍵盤與行動排序可上移或下移，且抵達邊界時維持原順序", () => {
    expect(moveRecrawlPresetId([11, 22, 33], 22, -1)).toEqual([22, 11, 33]);
    expect(moveRecrawlPresetId([11, 22, 33], 22, 1)).toEqual([11, 33, 22]);
    expect(moveRecrawlPresetId([11, 22], 11, -1)).toEqual([11, 22]);
  });

  it("匯入操作會將解析後的備份包裝為受控 API 輸入", () => {
    const backup = { version: 1, exportedAt: "2026-08-20T00:00:00.000Z", presets: [] };
    expect(createRecrawlPresetImportInput(backup)).toEqual({ backup });
  });

  it("即使最後一份常用清單已刪除，只要保有歷程仍會顯示管理與歷程面板", () => {
    expect(shouldShowRecrawlPresetManager(2, 0)).toBe(true);
    expect(shouldShowRecrawlPresetManager(0, 3)).toBe(true);
    expect(shouldShowRecrawlPresetManager(0, 0)).toBe(false);
  });

  it("部分完成時分開顯示處理進度與終態成功率，避免將一筆完成誤標為全部完成", () => {
    expect(formatRecrawlExecutionProgress(2, 1, 0)).toBe("處理進度 1/2（50%）");
    expect(formatRecrawlExecutionSuccessRate(1)).toBe("終態成功率 100%");
  });
});
