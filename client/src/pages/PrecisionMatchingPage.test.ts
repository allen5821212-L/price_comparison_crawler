import { describe, expect, it } from "vitest";
import { buildPreciseMatchInput, rulesForSource } from "./PrecisionMatchingPage";

describe("精準品項修正", () => {
  it("creates a platform-specific manual rule payload without changing the selected target ID", () => {
    expect(buildPreciseMatchInput("ASUS B850M-A", "pchome", "pchome_12345", "ASUS B850M-A WIFI")).toEqual({
      sinyaName: "ASUS B850M-A",
      platform: "pchome",
      targetId: "pchome_12345",
      targetName: "ASUS B850M-A WIFI",
    });
  });

  it("shows only active corrections for the selected source product", () => {
    const rules = [
      { sinyaName: "ASUS B850M-A", targetName: "Correct target", targetId: "coolpc_a", platform: "coolpc" as const, active: true, hitCount: 2 },
      { sinyaName: "ASUS B850M-A", targetName: "Old target", targetId: "coolpc_b", platform: "coolpc" as const, active: false, hitCount: 0 },
      { sinyaName: "Other product", targetName: "Other target", targetId: "momo_a", platform: "momo" as const, active: true, hitCount: 1 },
    ];

    expect(rulesForSource(rules, "ASUS B850M-A")).toEqual([rules[0]]);
  });
});
