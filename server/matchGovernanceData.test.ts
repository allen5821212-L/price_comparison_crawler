import { describe, expect, it } from "vitest";
import { buildMpnMatchMetrics, normalizeBrandAliasInput, parseReviewMatchSignals } from "./db";

describe("matching governance data helpers", () => {
  it("normalizes administrator-maintained alias values before persistence", () => {
    expect(normalizeBrandAliasInput({ alias: "  COOLER MASTER ", canonicalName: " 酷碼 " })).toEqual({ alias: "COOLER MASTER", canonicalName: "酷碼" });
  });

  it("parses hard-filter evidence and exact MPN codes defensively from a match payload", () => {
    expect(parseReviewMatchSignals('{"hard_filter_reasons":["R0品牌衝突",4],"exact_mpn":["V3607VJ0031K210H",false]}')).toEqual({ hardFilterReasons: ["R0品牌衝突"], exactMpnCodes: ["V3607VJ0031K210H"] });
    expect(parseReviewMatchSignals("not-json")).toEqual({ hardFilterReasons: [], exactMpnCodes: [] });
  });

  it("calculates exact-MPN match rate from all latest-batch payloads without counting malformed rows", () => {
    expect(buildMpnMatchMetrics([
      '{"exact_mpn":["V3607VJ0031K210H"]}',
      '{"exact_mpn":[]}',
      "invalid",
      '{"exact_mpn":["V3607VJ0031K210H","B850MPLUS"]}',
    ])).toEqual({ total: 4, exactMpnTotal: 2, exactMpnRate: 0.5, samples: ["V3607VJ0031K210H", "B850MPLUS"] });
  });
});
