import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  parseEnvironmentSettings,
  type EnvironmentSettings,
} from "./environment.js";

/** Per-route ceiling the render diagnostics must stay under (docs/04 §11). */
export interface RenderBudget {
  readonly maxDrawCalls: number;
  readonly maxTriangles: number;
}

/** Presentation of one selectable route: identity, mood defaults and budget. */
export interface RoutePresentation {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly environment: EnvironmentSettings;
  readonly budget: RenderBudget;
}

/** Docs/04-world-3d.md §11: ≤ 150 draw calls, ≤ 500 k triangles. */
const STANDARD_BUDGET: RenderBudget = { maxDrawCalls: 150, maxTriangles: 500_000 };

function environment(
  seed: number,
  startTimeS: number,
  weather: EnvironmentSettings["script"][number]["weather"],
): EnvironmentSettings {
  return { seed, startTimeS, script: [{ startS: 0, weather }] };
}

/**
 * Presentable routes (#75). The engine registry also carries the test fixtures
 * flat-loop and kom-climb and the region loops of the voltonaut world; the menu
 * only offers the curated rides below, and these cards are the Strecke tab's
 * source of truth.
 */
export const ROUTE_CATALOG: readonly RoutePresentation[] = [
  {
    id: "test-loop",
    title: "Test Loop",
    description: "Wald, See und Hügel – der bewährte Voltonaut-Rundkurs.",
    environment: environment(42, 12 * 60 * 60, "clear"),
    budget: STANDARD_BUDGET,
  },
  {
    id: "coast-loop",
    title: "Coast Loop",
    description: "Sand, Palmen und ein Leuchtturm am 8-km-Küstenweg.",
    environment: environment(7, 10 * 60 * 60, "clear"),
    budget: STANDARD_BUDGET,
  },
  {
    id: "alpine-pass",
    title: "Alpine Pass",
    description: "12 km Anstieg mit Serpentinen, 840 Höhenmetern und getrennter Abfahrt.",
    environment: environment(11, 9 * 60 * 60, "cloudy"),
    budget: STANDARD_BUDGET,
  },
  {
    id: "night-city",
    title: "Night City",
    description: "6 km flache nächtliche Runde durch Neonschilder und Laternen.",
    environment: environment(23, 20 * 60 * 60, "clear"),
    budget: STANDARD_BUDGET,
  },
  {
    id: "voltonaut-tour",
    title: "Voltonaut-Tour",
    description:
      "28 km durch die Welt Voltonaut: Wald und See, Weinberge, Küste und Nachtstadt ohne Ladepause.",
    environment: environment(31, 12 * 60 * 60, "clear"),
    budget: STANDARD_BUDGET,
  },
  {
    id: "voltonaut-vineyard",
    title: "Weinberg-Intervalle",
    description:
      "Neun kurze Rampen mit 3 bis 7 Prozent über 12 km Weinberge, dazwischen Abfahrten – im warmen Abendlicht.",
    environment: environment(37, 17 * 60 * 60 + 30 * 60, "clear"),
    budget: STANDARD_BUDGET,
  },
];

/** Catalog entry by route id; undefined for engine-only test fixtures. */
export function routePresentation(routeId: string): RoutePresentation | undefined {
  return ROUTE_CATALOG.find((entry) => entry.id === routeId);
}

const DEFAULT_ROUTE_ID = "test-loop";

/** Route URL parameter (#75); unknown ids keep the default ride. */
export function resolveRouteId(value: string | null): string {
  if (value !== null && routePresentation(value) !== undefined) return value;

  return DEFAULT_ROUTE_ID;
}

/** URL environment parameters over the route's catalog default (#75). */
export function routeEnvironmentSettings(
  query: Readonly<URLSearchParams>,
  routeId: string,
): EnvironmentSettings {
  const base = routePresentation(routeId)?.environment ?? DEFAULT_ENVIRONMENT_SETTINGS;

  return parseEnvironmentSettings(query, base);
}
