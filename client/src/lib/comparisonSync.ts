/** Returns a completed batch ID only when it is newer than the one already rendered. */
export function getCompletedRunIdToRefresh(
  observedRunId: number | null,
  run: { id: number; status: string } | null | undefined,
) {
  if (!run || run.status !== "completed") return null;
  if (observedRunId === null || observedRunId === run.id) return null;
  return run.id;
}
