export type ReviewHealthCheck = {
  id: string;
  label: string;
  status: "healthy" | "degraded";
  durationMs: number;
  message: string | null;
};

export function summarizeReviewHealth(checks: ReviewHealthCheck[]) {
  return {
    status: checks.every(check => check.status === "healthy") ? "healthy" as const : "degraded" as const,
    checks,
  };
}

export async function measureReviewHealthCheck(id: string, label: string, probe: () => Promise<void>): Promise<ReviewHealthCheck> {
  const startedAt = Date.now();
  try {
    await probe();
    return { id, label, status: "healthy", durationMs: Date.now() - startedAt, message: null };
  } catch (error) {
    return {
      id,
      label,
      status: "degraded",
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "健康檢查失敗",
    };
  }
}
