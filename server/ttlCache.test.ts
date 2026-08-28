import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "./ttlCache";

describe("TtlCache", () => {
  it("reuses a fresh value, then refreshes it after the TTL expires", async () => {
    const cache = new TtlCache<number>(60_000);
    const loader = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await expect(cache.get(loader, 100)).resolves.toMatchObject({ value: 1, cache: { hit: false, ageMs: 0, expiresAt: 60_100 } });
    await expect(cache.get(loader, 120)).resolves.toMatchObject({ value: 1, cache: { hit: true, ageMs: 20, expiresAt: 60_100 } });
    await expect(cache.get(loader, 60_100)).resolves.toMatchObject({ value: 2, cache: { hit: false, ageMs: 0, expiresAt: 120_100 } });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
