import { describe, expect, it } from "vitest";
import { formatCategoryListingMetricLabel } from "./listingMetric";

describe("分類上架率呈現", () => {
  it("以明確分隔的品數與百分比呈現正確分類比例", () => {
    expect(formatCategoryListingMetricLabel("原價屋", 7, 87.5)).toBe("原價屋：已上架 7 項；上架率 87.5%");
  });

  it("防止異常輸入在輔助標籤中顯示超過 100% 的比例", () => {
    expect(formatCategoryListingMetricLabel("momo", 0, 125)).toBe("momo：已上架 0 項；上架率 100%");
  });
});
