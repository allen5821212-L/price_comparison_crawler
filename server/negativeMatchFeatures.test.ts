import { describe, expect, it } from "vitest";
import { calculateNegativePenalty, extractMutuallyExclusiveFeatures } from "./negativeMatchFeatures";

describe("negative match feature extraction", () => {
  it("records only mutually exclusive hardware attributes", () => {
    expect(extractMutuallyExclusiveFeatures(
      "ASUS 白色 DDR5 Wi-Fi RTX 4060 Ti 16GB",
      "ASUS 黑色 DDR4 無Wi-Fi RTX 4060 32GB",
    )).toEqual(expect.arrayContaining([
      { sourceFeature: "color:white", targetFeature: "color:black" },
      { sourceFeature: "wifi:wifi", targetFeature: "wifi:no-wifi" },
      { sourceFeature: "ddr:ddr5", targetFeature: "ddr:ddr4" },
      { sourceFeature: "capacity:16G", targetFeature: "capacity:32G" },
      { sourceFeature: "suffix:TI", targetFeature: "suffix:none" },
    ]));
  });

  it("does not penalize the first isolated rejection", () => {
    expect(calculateNegativePenalty(1)).toBe(0);
    expect(calculateNegativePenalty(2)).toBe(0.18);
    expect(calculateNegativePenalty(20)).toBe(0.36);
  });
});
