import type { EngineRoute, WorldPos } from "@voltonaut/engine";

import type { ItemBox } from "./cell-grid.js";

export interface Lake {
  readonly center: WorldPos;
  readonly headingRad: number;
  readonly alongRadiusM: number;
  readonly acrossRadiusM: number;
  readonly waterYM: number;
}

export interface PointXz {
  readonly x: number;
  readonly z: number;
}

/** Elliptic radius: 1 on the waterline ellipse, 1.18 at the sandy shore, 1.65 at the basin rim. */
export const LAKE_SHORE_RADIUS = 1.18;

const LAKE_RIM_RADIUS = 1.65;

/** Lateral offset of a route position; negative is left of the travel direction. */
export function offsetPosition(route: EngineRoute, distanceM: number, lateralM: number): WorldPos {
  const position = route.worldPos(distanceM);
  const heading = route.headingRad(distanceM);

  return {
    x: position.x - Math.sin(heading) * lateralM,
    y: position.y,
    z: position.z + Math.cos(heading) * lateralM,
  };
}

/**
 * The lake left of the start straight, 1.4 m below the road at 110 m. Biomes without a lake
 * (alpine pass, night city, #75) keep a 1 m stand-in pond that carves no basin.
 */
export function planLake(route: EngineRoute, withLake = true): Lake {
  return {
    center: offsetPosition(route, 110, -58),
    headingRad: route.headingRad(110),
    alongRadiusM: withLake ? 148 : 1,
    acrossRadiusM: withLake ? 44 : 1,
    waterYM: route.worldPos(110).y - 1.4,
  };
}

export function lakeRadius(lake: Lake, position: PointXz): number {
  const dx = position.x - lake.center.x;
  const dz = position.z - lake.center.z;
  const alongM = dx * Math.cos(lake.headingRad) + dz * Math.sin(lake.headingRad);
  const acrossM = -dx * Math.sin(lake.headingRad) + dz * Math.cos(lake.headingRad);

  return Math.hypot(alongM / lake.alongRadiusM, acrossM / lake.acrossRadiusM);
}

/** Blends the natural ground into the lake basin; road corridors flatten afterwards. */
export function withLakeBasin(lake: Lake, position: PointXz, groundYM: number): number {
  const radius = lakeRadius(lake, position);

  if (radius >= LAKE_RIM_RADIUS) return groundYM;

  const basinYM = lake.waterYM - 2 + 2.2 * Math.min(radius, LAKE_SHORE_RADIUS) ** 4;

  const shoreBlend = Math.max(
    0,
    (radius - LAKE_SHORE_RADIUS) / (LAKE_RIM_RADIUS - LAKE_SHORE_RADIUS),
  );

  return basinYM * (1 - shoreBlend) + groundYM * shoreBlend;
}

/** Axis-aligned XZ box around the basin rim. */
export function lakeBounds(lake: Lake): ItemBox {
  const extentM = Math.max(lake.alongRadiusM, lake.acrossRadiusM) * LAKE_RIM_RADIUS;

  return {
    minX: lake.center.x - extentM,
    minZ: lake.center.z - extentM,
    maxX: lake.center.x + extentM,
    maxZ: lake.center.z + extentM,
  };
}
