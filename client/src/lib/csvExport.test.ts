import { describe, expect, it } from "vitest";
import { toCsv } from "./csvExport";

describe("CSV export", () => {
  it("adds a UTF-8 BOM and escapes quoted values", () => {
    expect(toCsv([["分類", "商品名稱"], ["主機板", "測試 \"品名\""]])).toBe("\uFEFF\"分類\",\"商品名稱\"\r\n\"主機板\",\"測試 \"\"品名\"\"\"");
  });
});
