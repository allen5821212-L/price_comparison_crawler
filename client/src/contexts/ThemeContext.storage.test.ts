import { describe, expect, it } from "vitest";
import { persistTheme, readStoredTheme } from "./ThemeContext";

describe("ThemeContext storage fallback", () => {
  it("uses the supplied default when storage is unavailable or invalid", () => {
    const denied = { getItem: () => { throw new Error("storage denied"); }, setItem: () => undefined };
    const invalid = { getItem: () => "system", setItem: () => undefined };

    expect(readStoredTheme("dark", denied)).toBe("dark");
    expect(readStoredTheme("light", invalid)).toBe("light");
  });

  it("does not throw when theme persistence is blocked", () => {
    expect(() => persistTheme("dark", { getItem: () => null, setItem: () => { throw new Error("storage denied"); } })).not.toThrow();
  });
});
