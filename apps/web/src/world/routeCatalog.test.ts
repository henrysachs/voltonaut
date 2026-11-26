import { TEST_ROUTES } from "@voltonaut/engine";
import { describe, expect, it } from "vitest";

import { DEFAULT_ENVIRONMENT_SETTINGS } from "./environment.js";
import {
  routeEnvironmentSettings,
  routePresentation,
  ROUTE_CATALOG,
  type RoutePresentation,
} from "./routeCatalog.js";

const CATALOG_IDS: readonly string[] = ROUTE_CATALOG.map((entry) => entry.id);

describe("route presentation catalog (#75)", () => {
  it("offers the four presentable rides in a stable order", () => {
    expect(CATALOG_IDS).toEqual(["test-loop", "coast-loop", "alpine-pass", "night-city"]);
  });

  it("references only routes the engine actually registers", () => {
    for (const entry of ROUTE_CATALOG) {
      expect(TEST_ROUTES[entry.id]).toBeDefined();
      expect(TEST_ROUTES[entry.id]?.name).toBe(entry.title);
    }
  });

  it("keys entries by route id and keeps engine-only fixtures unlisted", () => {
    expect(routePresentation("night-city")?.description).toContain("Neon");
    expect(routePresentation("flat-loop")).toBeUndefined();
    expect(routePresentation("kom-climb")).toBeUndefined();
    expect(routePresentation("missing-route")).toBeUndefined();
  });

  it("keeps every render budget inside the docs/04 world ceiling", () => {
    for (const entry of ROUTE_CATALOG) {
      expect(entry.budget.maxDrawCalls).toBeLessThanOrEqual(150);
      expect(entry.budget.maxTriangles).toBeLessThanOrEqual(500_000);
    }
  });
});

describe("route environment defaults (#75)", () => {
  it("gives each route its own deterministic environment default", () => {
    const environments = ROUTE_CATALOG.map((entry) => entry.environment);

    expect(new Set(environments.map((environment) => environment.seed)).size).toBe(
      ROUTE_CATALOG.length,
    );
    expect(routePresentation("test-loop")?.environment).toEqual({
      seed: DEFAULT_ENVIRONMENT_SETTINGS.seed,
      startTimeS: DEFAULT_ENVIRONMENT_SETTINGS.startTimeS,
      script: DEFAULT_ENVIRONMENT_SETTINGS.script,
    });
    expect(routePresentation("night-city")?.environment.startTimeS).toBe(20 * 60 * 60);
    expect(routePresentation("alpine-pass")?.environment.script).toEqual([
      { startS: 0, weather: "cloudy" },
    ]);
  });

  it("merges URL parameters over the route default per field", () => {
    const settings = routeEnvironmentSettings(new URLSearchParams("weather=rain"), "night-city");

    expect(settings.seed).toBe(routePresentation("night-city")?.environment.seed);
    expect(settings.startTimeS).toBe(20 * 60 * 60);
    expect(settings.script).toEqual([{ startS: 0, weather: "rain" }]);

    const timeOverride = routeEnvironmentSettings(new URLSearchParams("time=07:30"), "night-city");

    expect(timeOverride.startTimeS).toBe(7 * 60 * 60 + 30 * 60);
    expect(timeOverride.script).toEqual(routePresentation("night-city")?.environment.script);
  });
});

describe("route catalog copy (#75)", () => {
  it("describes every card in German with title and copy", () => {
    for (const entry of ROUTE_CATALOG satisfies readonly RoutePresentation[]) {
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.description).toMatch(/[äöüß]/u);
    }
  });
});
