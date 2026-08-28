import type { ReviewHealthCheck } from "./reviewHealth";

export type ReviewHealthHistoryEvent = {
  checkId: string;
  status: "healthy" | "degraded";
  observedAt: Date | string;
};

export type PersistentDegradation = {
  checkId: string;
  startedAt: Date;
  durationMinutes: number;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * A degraded check becomes actionable only when every later event remains degraded
 * and the first unresolved degraded event is older than the configured threshold.
 */
export function findPersistentDegradations(
  checks: ReviewHealthCheck[],
  history: ReviewHealthHistoryEvent[],
  thresholdMinutes: number,
  now = new Date(),
): PersistentDegradation[] {
  return checks
    .filter(check => check.status === "degraded")
    .flatMap(check => {
      const events = history
        .filter(event => event.checkId === check.id)
        .map(event => ({ ...event, observedAt: asDate(event.observedAt) }))
        .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
      let startedAt: Date | null = null;
      for (const event of events) {
        if (event.status === "healthy") startedAt = null;
        else if (!startedAt) startedAt = event.observedAt;
      }
      if (!startedAt) return [];
      const durationMinutes = Math.floor((now.getTime() - startedAt.getTime()) / 60_000);
      return durationMinutes >= thresholdMinutes ? [{ checkId: check.id, startedAt, durationMinutes }] : [];
    });
}

export function createHealthIncidentKey(checkId: string, startedAt: Date): string {
  return `${checkId}:${startedAt.toISOString()}`;
}
