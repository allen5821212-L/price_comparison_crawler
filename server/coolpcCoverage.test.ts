import { describe, expect, it } from "vitest";
import { deriveCoolpcCoverage } from "./db";

describe("CoolPC listing coverage", () => {
  it("counts only accepted CoolPC matches and preserves unmatched Sinya products by category", () => {
    const coverage = deriveCoolpcCoverage([
      { externalId: "1", name: "CPU A", category: "CPU", price: 100, url: null, image: null },
      { externalId: "2", name: "CPU B", category: "CPU", price: 200, url: null, image: null },
      { externalId: "3", name: "RAM A", category: "RAM", price: 300, url: null, image: null },
    ], new Set(["CPU A"]));

    expect(coverage).toMatchObject({
      sinyaTotal: 3,
      coolpcListed: 1,
      coolpcUnlisted: 2,
      coverageRate: 1 / 3,
    });
    expect(coverage.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "CPU", sinyaTotal: 2, coolpcListed: 1, coolpcUnlisted: 1, coverageRate: 0.5 }),
      expect.objectContaining({ category: "RAM", sinyaTotal: 1, coolpcListed: 0, coolpcUnlisted: 1, coverageRate: 0 }),
    ]));
  });
});
