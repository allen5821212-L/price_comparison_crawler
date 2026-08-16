import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  listActiveMatchingFeedback: vi.fn(),
  listMatchingFeedbackForAdmin: vi.fn(),
  setMatchingFeedbackActive: vi.fn(),
  upsertMatchingFeedback: vi.fn(),
}));

vi.mock("./db", () => dbMocks);

import { appRouter } from "./routers";

function createAdminContext(): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 1,
      openId: "owner-open-id",
      name: "Owner",
      email: null,
      loginMethod: "manus",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("matchRules router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports only the active rules supplied by the persistence layer", async () => {
    dbMocks.listActiveMatchingFeedback.mockResolvedValue([
      { sinyaName: "ASUS B850-G", targetName: "ROG B850-G", targetId: "coolpc_1", platform: "coolpc" },
    ]);

    const caller = appRouter.createCaller(createAdminContext());
    await expect(caller.matchRules.listForCrawler()).resolves.toEqual([
      { sinyaName: "ASUS B850-G", targetName: "ROG B850-G", targetId: "coolpc_1", platform: "coolpc" },
    ]);
  });

  it("stores an administrator-confirmed mapping with the caller identity", async () => {
    dbMocks.upsertMatchingFeedback.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.matchRules.confirm({
      sinyaName: "ASUS B850-G",
      targetName: "ROG B850-G",
      targetId: "coolpc_1",
      platform: "coolpc",
    })).resolves.toEqual({ success: true, sourceAlias: "B850-G", targetAlias: "B850-G" });

    expect(dbMocks.upsertMatchingFeedback).toHaveBeenCalledWith({
      sinyaName: "ASUS B850-G",
      targetName: "ROG B850-G",
      targetId: "coolpc_1",
      platform: "coolpc",
      sourceAlias: "B850-G",
      targetAlias: "B850-G",
      createdByOpenId: "owner-open-id",
    });
  });

  it("returns active and inactive rules with management usage fields for administrators", async () => {
    const rules = [{ id: 7, sinyaName: "ASUS B850-G", targetName: "ROG B850-G", platform: "coolpc", active: false, hitCount: 3, lastHitAt: null }];
    dbMocks.listMatchingFeedbackForAdmin.mockResolvedValue(rules);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.matchRules.listForAdmin()).resolves.toEqual(rules);
  });

  it("updates a rule activation state through the administrator procedure", async () => {
    dbMocks.setMatchingFeedbackActive.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createAdminContext());

    await expect(caller.matchRules.setActive({ id: 7, active: false })).resolves.toEqual({ success: true });
    expect(dbMocks.setMatchingFeedbackActive).toHaveBeenCalledWith(7, false);
  });
});
