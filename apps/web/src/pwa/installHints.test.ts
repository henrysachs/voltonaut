import { describe, expect, it } from "vitest";

import { detectPlatform, INSTALL_HINTS } from "./installHints.js";

describe("detectPlatform", () => {
  it("detects iOS, iPadOS, Android and desktop", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("desktop");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 15; Pixel)", 5)).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)", 0)).toBe("desktop");
  });

  it("documents the Web Bluetooth limits for every platform", () => {
    expect(INSTALL_HINTS.map((hint) => hint.platform).toSorted()).toEqual([
      "android",
      "desktop",
      "ios",
    ]);

    const ios = INSTALL_HINTS.find((hint) => hint.platform === "ios");

    expect(ios?.bluetooth).toContain("kein");
    expect(ios?.bluetooth).toContain("Sim-Modus");
  });
});
