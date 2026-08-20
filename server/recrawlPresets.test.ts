import { describe, expect, it } from "vitest";
import { deriveRecrawlPresetExecutionSummary, normalizeRecrawlPresetCategoryNames, normalizeRecrawlPresetOrder, parseRecrawlPresetBackup, parseRecrawlPresetCategoryNames, parseRecrawlPresetJobIds, RECRAWL_PRESET_BACKUP_VERSION } from "./db";

describe("常用分類補抓清單資料", () => {
  it("正規化分類、排除重複與空白，並限制最多十二個分類", () => {
    const names = [" 鍵盤 ", "筆電", "鍵盤", "", ...Array.from({ length: 20 }, (_, index) => `分類-${index}`)];
    const result = normalizeRecrawlPresetCategoryNames(names);
    expect(result).toEqual(["鍵盤", "筆電", "分類-0", "分類-1", "分類-2", "分類-3", "分類-4", "分類-5", "分類-6", "分類-7", "分類-8", "分類-9"]);
  });

  it("僅接受字串陣列 JSON，避免損壞或非預期儲存資料進入套用流程", () => {
    expect(parseRecrawlPresetCategoryNames('["鍵盤", "筆電", "鍵盤"]')).toEqual(["鍵盤", "筆電"]);
    expect(parseRecrawlPresetCategoryNames('{"category":"鍵盤"}')).toEqual([]);
    expect(parseRecrawlPresetCategoryNames('["鍵盤", 42]')).toEqual([]);
    expect(parseRecrawlPresetCategoryNames("not-json")).toEqual([]);
  });

  it("僅保留有效且不重複的排序識別與工作編號，避免跨帳戶或損壞歷程誤用", () => {
    expect(normalizeRecrawlPresetOrder([3, 1, 3, 0, -4, 2.5, 2])).toEqual([3, 1, 2]);
    expect(parseRecrawlPresetJobIds("[9, 9, 0, -2, 12]")).toEqual([9, 12]);
    expect(parseRecrawlPresetJobIds('{"job":9}')).toEqual([]);
  });

  it("只接受版本正確、名稱唯一且分類有效的可攜備份資料", () => {
    const backup = parseRecrawlPresetBackup({
      version: RECRAWL_PRESET_BACKUP_VERSION,
      exportedAt: "2026-08-20T00:00:00.000Z",
      presets: [
        { name: "  高缺口  ", categoryNames: ["鍵盤", "筆電", "鍵盤"], pinned: true, sortOrder: 2 },
        { name: "高缺口", categoryNames: ["網通"], pinned: false, sortOrder: 3 },
        { name: "錯誤", categoryNames: [42], pinned: false, sortOrder: 4 },
      ],
    });
    expect(backup?.presets).toEqual([{ name: "高缺口", categoryNames: ["鍵盤", "筆電"], pinned: true, sortOrder: 2 }]);
    expect(parseRecrawlPresetBackup({ version: 99, exportedAt: "x", presets: [] })).toBeNull();
  });

  it("從實際分類工作推導完成率、整體耗時與失敗摘要", () => {
    const summary = deriveRecrawlPresetExecutionSummary([
      { id: 1, categoryName: "鍵盤", status: "completed", startedAt: "2026-08-20T00:00:00.000Z", finishedAt: "2026-08-20T00:10:00.000Z", errorMessage: null, summary: null },
      { id: 2, categoryName: "筆電", status: "failed", startedAt: "2026-08-20T00:01:00.000Z", finishedAt: "2026-08-20T00:12:00.000Z", errorMessage: "來源逾時", summary: null },
      { id: 3, categoryName: "網通", status: "queued", startedAt: null, finishedAt: null, errorMessage: null, summary: null },
    ]);
    expect(summary).toMatchObject({ total: 3, completedCount: 1, failedCount: 1, pendingCount: 1, completionRate: 0.5, durationMs: 12 * 60_000 });
    expect(summary.failures).toEqual([{ categoryName: "筆電", message: "來源逾時" }]);
  });
});
