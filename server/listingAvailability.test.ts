import { describe, expect, it } from "vitest";
import {
  buildListingAvailability,
  buildListingCategories,
  calculateListingRate,
} from "./listingAvailability";

describe("listing availability metrics", () => {
  it("calculates a rounded listing rate against the Sinya reference catalog", () => {
    expect(calculateListingRate(333, 1000)).toBe(33.3);
    expect(calculateListingRate(1, 3)).toBe(33.3);
  });

  it("handles an empty reference catalog without division errors", () => {
    expect(calculateListingRate(5, 0)).toBe(0);
  });

  it("builds platform metrics with the reference platform at 100 percent", () => {
    const summary = buildListingAvailability({
      sourceTotal: 100,
      catalogTotals: { sinya: 100, coolpc: 300, pchome: 500, momo: 600 },
      listedCounts: { sinya: 100, coolpc: 65, pchome: 40, momo: 35 },
      allPlatformsListedCount: 20,
    });

    expect(summary.platforms.find(platform => platform.key === "sinya")).toMatchObject({
      listedCount: 100,
      catalogCount: 100,
      listingRate: 100,
    });
    expect(summary.platforms.find(platform => platform.key === "coolpc")).toMatchObject({
      listedCount: 65,
      listingRate: 65,
    });
    expect(summary.allPlatformsListingRate).toBe(20);
  });

  it("preserves source categories without cross-platform listings as zero-rate rows", () => {
    const categories = buildListingCategories(
      [
        { category: "CPU", sourceCount: 10 },
        { category: "顯示卡", sourceCount: 5 },
      ],
      [{ category: "CPU", coolpcCount: 8, pchomeCount: 6, momoCount: 4 }],
    );

    expect(categories).toEqual([
      {
        category: "CPU",
        sourceCount: 10,
        coolpc: { listedCount: 8, listingRate: 80 },
        pchome: { listedCount: 6, listingRate: 60 },
        momo: { listedCount: 4, listingRate: 40 },
      },
      {
        category: "顯示卡",
        sourceCount: 5,
        coolpc: { listedCount: 0, listingRate: 0 },
        pchome: { listedCount: 0, listingRate: 0 },
        momo: { listedCount: 0, listingRate: 0 },
      },
    ]);
  });
});
