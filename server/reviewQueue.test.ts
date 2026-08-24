import { describe, expect, it } from "vitest";
import { buildMatchReviewItem, calculatePriceSpread, createReviewFingerprint, filterAndSortReviewItems, summarizeReviewItems } from "./reviewQueue";

describe("待審核配對佇列", () => {
  it("calculates the relative spread from usable platform prices", () => {
    expect(calculatePriceSpread([1000, 1500, null, 0])).toBe(0.5);
    expect(calculatePriceSpread([1000])).toBe(0);
  });

  it("queues a match with explicit specification differences as critical", () => {
    const item = buildMatchReviewItem({
      id: 1, sourceKey: "sinya_1", sinyaName: "ASUS B850M-A", category: "主機板", sinyaPrice: 4990,
      coolpcName: "ASUS B850M-A WIFI", coolpcPrice: 5090, pchomeName: null, pchomePrice: null, momoName: null, momoPrice: null,
      score: "0.96", hasSpecDiff: true,
    });

    expect(item).toMatchObject({ severity: "critical", riskScore: 85, hasSpecDiff: true });
    expect(item?.reasons).toContain("已偵測到型號或規格差異");
  });

  it("queues low-confidence or abnormal-price matches, then ranks the highest risk first", () => {
    const rows = [
      { id: 1, sourceKey: "a", sinyaName: "Low confidence", category: "CPU", sinyaPrice: 3000, coolpcName: "Candidate A", coolpcPrice: 3050, pchomeName: null, pchomePrice: null, momoName: null, momoPrice: null, score: 0.7, hasSpecDiff: false },
      { id: 2, sourceKey: "b", sinyaName: "Large price spread", category: "GPU", sinyaPrice: 10000, coolpcName: "Candidate B", coolpcPrice: 22000, pchomeName: null, pchomePrice: null, momoName: null, momoPrice: null, score: 0.97, hasSpecDiff: false },
      { id: 3, sourceKey: "c", sinyaName: "Safe match", category: "SSD", sinyaPrice: 2000, coolpcName: "Candidate C", coolpcPrice: 2050, pchomeName: null, pchomePrice: null, momoName: null, momoPrice: null, score: 0.98, hasSpecDiff: false },
    ];

    const items = filterAndSortReviewItems(rows);
    expect(items.map(item => item.sourceKey)).toEqual(["b", "a"]);
    expect(items[0]).toMatchObject({ severity: "critical", priceSpread: 1.2 });
    expect(items[1]).toMatchObject({ severity: "medium" });
  });

  it("hides only the previously skipped candidate fingerprint and requeues changed candidates", () => {
    const source = { id: 8, sourceKey: "sinya_8", sinyaName: "GPU", category: "顯示卡", sinyaPrice: 12000, coolpcName: "GPU A", coolpcPrice: 20000, pchomeName: null, pchomePrice: null, momoName: null, momoPrice: null, score: 0.97, hasSpecDiff: false };
    const skipped = createReviewFingerprint(source);

    expect(filterAndSortReviewItems([source], { skippedFingerprints: new Set([skipped]) })).toEqual([]);
    expect(filterAndSortReviewItems([{ ...source, coolpcName: "GPU B" }], { skippedFingerprints: new Set([skipped]) })).toHaveLength(1);
  });

  it("summarizes all pending items while separating high-risk work", () => {
    const critical = buildMatchReviewItem({ id: 1, sourceKey: "a", sinyaName: "Spec diff", category: null, sinyaPrice: 1000, coolpcName: "Different spec", coolpcPrice: 1000, pchomeName: null, pchomePrice: null, momoName: null, momoPrice: null, score: 0.95, hasSpecDiff: true });
    const high = buildMatchReviewItem({ id: 2, sourceKey: "b", sinyaName: "Low confidence", category: null, sinyaPrice: 1000, coolpcName: "Candidate", coolpcPrice: 1000, pchomeName: null, pchomePrice: null, momoName: null, momoPrice: null, score: 0.4, hasSpecDiff: false });
    const medium = buildMatchReviewItem({ id: 3, sourceKey: "c", sinyaName: "Moderate confidence", category: null, sinyaPrice: 1000, coolpcName: "Candidate", coolpcPrice: 1000, pchomeName: null, pchomePrice: null, momoName: null, momoPrice: null, score: 0.7, hasSpecDiff: false });

    expect(summarizeReviewItems([critical!, high!, medium!])).toEqual({ total: 3, mediumTotal: 1, highTotal: 1, criticalTotal: 1, highRiskTotal: 2 });
  });
});
