import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const databaseIt = process.env.DATABASE_URL ? it : it.skip;

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "review-quality-test-admin",
      email: "admin@example.com",
      name: "Review Quality Test Admin",
      loginMethod: "test",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("comparison.weeklyQualityReport tRPC integration", () => {
  databaseIt("returns a report shape for an authenticated administrator after server restart", async () => {
    const report = await appRouter.createCaller(createAdminContext()).comparison.weeklyQualityReport();

    expect(report).toMatchObject({
      startDate: expect.any(String),
      endDate: expect.any(String),
      summary: expect.objectContaining({ totalMatches: expect.any(Number), autoQualityRate: expect.any(Number) }),
    });
    expect(report.days).toEqual(expect.any(Array));
    expect(report.riskSources).toEqual(expect.any(Array));
  }, 15_000);

  databaseIt("returns health and latency information for the review dashboard dependencies", async () => {
    const health = await appRouter.createCaller(createAdminContext()).comparison.reviewHealth();

    expect(health).toMatchObject({ checkedAt: expect.any(String), status: expect.stringMatching(/healthy|degraded/) });
    expect(health.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "review-queue", durationMs: expect.any(Number) }),
      expect.objectContaining({ id: "review-activity", durationMs: expect.any(Number) }),
      expect.objectContaining({ id: "weekly-quality", durationMs: expect.any(Number) }),
    ]));
  }, 15_000);
});
