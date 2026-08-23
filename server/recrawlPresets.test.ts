import { describe, expect, it } from "vitest";
import { buildRecrawlPresetImportPreview, canManageRecrawlPresetTemplateCollaborators, canMaintainRecrawlPresetTemplate, deriveRecrawlPresetExecutionSummary, deriveRecrawlPresetTemplateEstimate, getRecrawlPresetHistoryStatus, normalizeRecrawlPresetCategoryNames, normalizeRecrawlPresetOrder, parseRecrawlPresetBackup, parseRecrawlPresetCategoryNames, parseRecrawlPresetJobIds, RECRAWL_PRESET_BACKUP_VERSION } from "./db";

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

  it("在匯入前將備份正確分類為新增、內容相同與同名衝突", () => {
    const preview = buildRecrawlPresetImportPreview({
      version: RECRAWL_PRESET_BACKUP_VERSION,
      exportedAt: "2026-08-21T00:00:00.000Z",
      presets: [
        { name: "相同", categoryNames: ["鍵盤"], pinned: false, sortOrder: 1 },
        { name: "衝突", categoryNames: ["筆電"], pinned: true, sortOrder: 2 },
        { name: "新增", categoryNames: ["網通"], pinned: false, sortOrder: 3 },
      ],
    }, [
      { id: 1, name: "相同", categoryNames: ["鍵盤"], pinned: false, sortOrder: 1 },
      { id: 2, name: "衝突", categoryNames: ["舊分類"], pinned: false, sortOrder: 2 },
    ]);
    expect(preview.counts).toEqual({ new: 1, unchanged: 1, conflict: 1 });
    expect(preview.items.map(item => [item.name, item.kind])).toEqual([["相同", "unchanged"], ["衝突", "conflict"], ["新增", "new"]]);
  });

  it("依工作終態與待處理狀態提供成功、失敗與執行中歷程篩選分類", () => {
    const success = deriveRecrawlPresetExecutionSummary([{ id: 1, categoryName: "鍵盤", status: "completed", startedAt: null, finishedAt: null, errorMessage: null, summary: null }]);
    const failed = deriveRecrawlPresetExecutionSummary([{ id: 2, categoryName: "筆電", status: "failed", startedAt: null, finishedAt: null, errorMessage: "失敗", summary: null }]);
    const running = deriveRecrawlPresetExecutionSummary([{ id: 3, categoryName: "網通", status: "running", startedAt: null, finishedAt: null, errorMessage: null, summary: null }]);
    expect(getRecrawlPresetHistoryStatus({ execution: success })).toBe("success");
    expect(getRecrawlPresetHistoryStatus({ execution: failed })).toBe("failed");
    expect(getRecrawlPresetHistoryStatus({ execution: running })).toBe("running");
  });

  it("只允許擁有者或共同維護模式下的具名協作者更新團隊範本", () => {
    expect(canMaintainRecrawlPresetTemplate("read_only", true, false)).toBe(true);
    expect(canMaintainRecrawlPresetTemplate("read_only", false, true)).toBe(false);
    expect(canMaintainRecrawlPresetTemplate("collaborative", false, true)).toBe(true);
    expect(canMaintainRecrawlPresetTemplate("collaborative", false, false)).toBe(false);
  });

  it("僅範本擁有者可切換模式或加入與移除協作者，且未授權者無法管理名單", () => {
    expect(canManageRecrawlPresetTemplateCollaborators(true)).toBe(true);
    expect(canManageRecrawlPresetTemplateCollaborators(false)).toBe(false);
    expect(canMaintainRecrawlPresetTemplate("read_only", false, true)).toBe(false);
    expect(canMaintainRecrawlPresetTemplate("collaborative", false, true)).toBe(true);
    expect(canMaintainRecrawlPresetTemplate("collaborative", false, false)).toBe(false);
  });

  it("以真實分類工作樣本推導範本總耗時，且缺少樣本時不臆測", () => {
    expect(deriveRecrawlPresetTemplateEstimate(3, 12 * 60_000, 8)).toEqual({ estimateMs: 36 * 60_000, estimateSampleSize: 8 });
    expect(deriveRecrawlPresetTemplateEstimate(3, null, 0)).toEqual({ estimateMs: null, estimateSampleSize: 0 });
  });
});
