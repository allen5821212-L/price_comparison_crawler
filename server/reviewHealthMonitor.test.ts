import { describe, expect, it } from "vitest";
import { createHealthIncidentKey, findPersistentDegradations } from "./reviewHealthMonitor";

const degradedCheck = { id: "weekly-quality", label: "週品質報表", status: "degraded" as const, durationMs: 250, message: "資料庫暫時無法使用" };

describe("持續降級健康監控", () => {
  it("alerts only after an uninterrupted degradation reaches the configured threshold", () => {
    const startedAt = new Date("2026-08-28T00:00:00.000Z");
    expect(findPersistentDegradations([degradedCheck], [{ checkId: degradedCheck.id, status: "degraded", observedAt: startedAt }], 15, new Date("2026-08-28T00:14:59.000Z"))).toEqual([]);
    expect(findPersistentDegradations([degradedCheck], [{ checkId: degradedCheck.id, status: "degraded", observedAt: startedAt }], 15, new Date("2026-08-28T00:15:00.000Z"))).toEqual([{ checkId: "weekly-quality", startedAt, durationMinutes: 15 }]);
  });

  it("resets the incident when a healthy event occurs before a later degradation", () => {
    const history = [
      { checkId: "weekly-quality", status: "degraded" as const, observedAt: "2026-08-28T00:00:00.000Z" },
      { checkId: "weekly-quality", status: "healthy" as const, observedAt: "2026-08-28T00:10:00.000Z" },
      { checkId: "weekly-quality", status: "degraded" as const, observedAt: "2026-08-28T00:20:00.000Z" },
    ];
    expect(findPersistentDegradations([degradedCheck], history, 15, new Date("2026-08-28T00:30:00.000Z"))).toEqual([]);
    const degradations = findPersistentDegradations([degradedCheck], history, 15, new Date("2026-08-28T00:35:00.000Z"));
    expect(degradations).toMatchObject([{ checkId: "weekly-quality", durationMinutes: 15 }]);
    expect(createHealthIncidentKey(degradations[0]!.checkId, degradations[0]!.startedAt)).toBe("weekly-quality:2026-08-28T00:20:00.000Z");
  });
});
