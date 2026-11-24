import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { classifyRequest, shellCacheName, SKIP_WAITING_MESSAGE } from "./cachePolicy.js";
import { SKIP_WAITING } from "./register.js";

const ORIGIN = "https://app.example";

describe("classifyRequest", () => {
  it("serves the shell for same-origin navigations including query strings", () => {
    expect(classifyRequest("GET", `${ORIGIN}/`, ORIGIN, "navigate")).toBe("navigation");
    expect(classifyRequest("GET", `${ORIGIN}/?sim=1`, ORIGIN, "navigate")).toBe("navigation");
    expect(classifyRequest("GET", `${ORIGIN}/index.html`, ORIGIN, "navigate")).toBe("navigation");
  });

  it("serves hashed assets, icons and the manifest from the cache", () => {
    for (const path of ["/assets/ride-abc.js", "/icons/icon-192.png", "/manifest.webmanifest"]) {
      expect(classifyRequest("GET", `${ORIGIN}${path}`, ORIGIN, "no-cors")).toBe("static");
    }
  });

  it("never touches auth, Strava and debug navigations", () => {
    for (const path of ["/strava/finish", "/strava/bridge", "/debug/ble.html", "/v1/auth/start"]) {
      expect(classifyRequest("GET", `${ORIGIN}${path}?code=secret`, ORIGIN, "navigate")).toBe(
        "network",
      );
    }
  });

  it("never touches other origins such as the API", () => {
    expect(classifyRequest("GET", "https://api.example/v1/rides", ORIGIN, "cors")).toBe("network");
    expect(classifyRequest("GET", "https://api.example/assets/x.js", ORIGIN, "no-cors")).toBe(
      "network",
    );
  });

  it("never touches non-GET requests or same-origin data paths", () => {
    expect(classifyRequest("POST", `${ORIGIN}/assets/x.js`, ORIGIN, "cors")).toBe("network");
    expect(classifyRequest("GET", `${ORIGIN}/v1/rides`, ORIGIN, "cors")).toBe("network");
    expect(classifyRequest("GET", `${ORIGIN}/assets/x.js?token=abc`, ORIGIN, "cors")).toBe(
      "network",
    );
  });

  it("namespaces caches by release version", () => {
    expect(shellCacheName("abc")).toBe("voltonaut-shell-abc");
  });

  it("uses the same skip-waiting message in the page and the worker bundle", () => {
    const worker = readFileSync(new URL("./serviceWorker.ts", import.meta.url), "utf8");

    expect(SKIP_WAITING).toBe(SKIP_WAITING_MESSAGE);
    expect(worker).toContain(`"${SKIP_WAITING_MESSAGE}"`);
  });
});
