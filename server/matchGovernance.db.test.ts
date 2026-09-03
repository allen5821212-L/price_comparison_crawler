import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { brandAliases } from "../drizzle/schema";
import { getDb, getLatestMatchReviewQueue, getLatestMpnMatchMetrics, listActiveBrandAliases, listBrandAliasesForAdmin, setBrandAliasActive, upsertBrandAlias } from "./db";

const temporaryAlias = `__vitest_brand_alias_${process.pid}_${Date.now()}`;

afterEach(async () => {
  const db = await getDb();
  if (db) await db.delete(brandAliases).where(eq(brandAliases.alias, temporaryAlias));
});

describe("matching governance database layer", () => {
  it("persists, exports, disables and retains an administrator-managed brand alias", async () => {
    await upsertBrandAlias({ alias: ` ${temporaryAlias} `, canonicalName: "測試標準品牌", createdByOpenId: "vitest-admin" });
    const managed = await listBrandAliasesForAdmin();
    const created = managed.find(item => item.alias === temporaryAlias);
    expect(created).toMatchObject({ alias: temporaryAlias, canonicalName: "測試標準品牌", active: true, createdByOpenId: "vitest-admin" });

    const activeBeforeDisable = await listActiveBrandAliases();
    expect(activeBeforeDisable).toContainEqual({ alias: temporaryAlias, canonicalName: "測試標準品牌" });
    await setBrandAliasActive(created!.id, false);
    const activeAfterDisable = await listActiveBrandAliases();
    expect(activeAfterDisable).not.toContainEqual({ alias: temporaryAlias, canonicalName: "測試標準品牌" });
    expect((await listBrandAliasesForAdmin()).find(item => item.id === created!.id)).toMatchObject({ active: false });
  });

  it("reads latest-batch MPN metrics and safely exposes parsed review evidence arrays", async () => {
    const metrics = await getLatestMpnMatchMetrics();
    expect(metrics.total).toBeGreaterThanOrEqual(metrics.exactMpnTotal);
    expect(metrics.exactMpnRate).toBeGreaterThanOrEqual(0);
    expect(metrics.exactMpnRate).toBeLessThanOrEqual(1);
    expect(metrics.samples.every(code => typeof code === "string")).toBe(true);

    const queue = await getLatestMatchReviewQueue({ page: 1, pageSize: 10 });
    for (const item of queue.items) {
      expect(Array.isArray(item.exactMpnCodes)).toBe(true);
      expect(Array.isArray(item.hardFilterReasons)).toBe(true);
    }
  }, 20_000);
});
