/**
 * Server-side pagination is intentionally retained for the two product lists.
 * Current page limits (20 review items and 25 comparison items) stay below the
 * 100-row virtualization threshold, avoiding keyboard/focus complexity without
 * rendering an unbounded DOM. This helper keeps that policy explicit and testable.
 */
export function shouldVirtualizeList(itemCount: number, pageSize: number, threshold = 100): boolean {
  return itemCount > threshold && pageSize > threshold;
}
