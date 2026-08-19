import { describe, expect, it } from "vitest";
import { deriveCoolpcCoverage, deriveSinyaCoverage } from "./db";

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

describe("Sinya listing coverage", () => {
  it("reports CoolPC products without an accepted Sinya match by CoolPC category", () => {
    const coverage = deriveSinyaCoverage([
      { externalId: "1", name: "GPU A", category: "顯示卡", price: 100, url: null, image: null },
      { externalId: "2", name: "GPU B", category: "顯示卡", price: 200, url: null, image: null },
      { externalId: "3", name: "PSU A", category: "電源", price: 300, url: null, image: null },
    ], new Set(["GPU A"]));
    expect(coverage).toMatchObject({ coolpcTotal: 3, sinyaListed: 1, sinyaUnlisted: 2, coverageRate: 1 / 3 });
    expect(coverage.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "顯示卡", coolpcTotal: 2, sinyaListed: 1, sinyaUnlisted: 1, coverageRate: 0.5 }),
      expect.objectContaining({ category: "電源", coolpcTotal: 1, sinyaListed: 0, sinyaUnlisted: 1, coverageRate: 0 }),
    ]));
  });
});
