import { describe, expect, it } from "vitest";
import { persistSidebarWidth, readSidebarWidth } from "./DashboardLayout";

describe("DashboardLayout sidebar storage fallback", () => {
  it("uses the default width when storage is unavailable or invalid", () => {
    expect(readSidebarWidth({ getItem: () => { throw new Error("storage denied"); }, setItem: () => undefined })).toBe(280);
    expect(readSidebarWidth({ getItem: () => "1000", setItem: () => undefined })).toBe(280);
  });

  it("does not interrupt rendering when persisting the width is blocked", () => {
    expect(() => persistSidebarWidth(320, { getItem: () => null, setItem: () => { throw new Error("storage denied"); } })).not.toThrow();
  });
});
