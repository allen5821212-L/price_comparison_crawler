import { describe, expect, it } from "vitest";
import { normalizeRecrawlPresetCategoryNames, normalizeRecrawlPresetOrder, parseRecrawlPresetCategoryNames, parseRecrawlPresetJobIds } from "./db";

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
});
