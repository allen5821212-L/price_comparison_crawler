import { describe, expect, it } from "vitest";
import { shouldVirtualizeList } from "./listRendering";

describe("list rendering policy", () => {
  it("keeps server-paginated product and review lists out of virtualization", () => {
    expect(shouldVirtualizeList(1_236, 20)).toBe(false);
    expect(shouldVirtualizeList(500, 25)).toBe(false);
  });

  it("requires virtualization when an unbounded result page exceeds the threshold", () => {
    expect(shouldVirtualizeList(101, 101)).toBe(true);
  });
});
