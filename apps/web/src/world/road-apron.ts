import type { EngineRoute, WorldPos } from "@voltonaut/engine";

import { bandSurfaceAt, createBandIndex } from "./road-band.js";
import type { RoadSample } from "./road-plan.js";

/** Mitered inside corners overlap; the apron stays below the higher neighbour (#138). */
export const ROAD_APRON_DROP_M = 0.3;

/** Half width of the apron, the same as the shoulder band. */
const APRON_HALF_WIDTH_M = 4;

/** Mitered lateral direction at support point index of count, scaled so the offset holds 4 m. */
function apronOffsetNormal(route: EngineRoute, index: number, count: number): WorldPos {
  const stepM = route.lengthM / count;
  const distanceM = index * stepM;
  const firstBeforeM = route.loop ? route.lengthM - stepM / 2 : stepM / 2;
  const lastAfterM = route.loop ? stepM / 2 : route.lengthM - stepM / 2;
  const beforeHeadingRad = route.headingRad(index === 0 ? firstBeforeM : distanceM - stepM / 2);
  const afterHeadingRad = route.headingRad(index === count ? lastAfterM : distanceM + stepM / 2);
  const afterNormalX = -Math.sin(afterHeadingRad);
  const afterNormalZ = Math.cos(afterHeadingRad);
  const normalX = -Math.sin(beforeHeadingRad) + afterNormalX;
  const normalZ = Math.cos(beforeHeadingRad) + afterNormalZ;
  const denominator = normalX * afterNormalX + normalZ * afterNormalZ;

  return denominator === 0
    ? { x: afterNormalX, y: 0, z: afterNormalZ }
    : { x: normalX / denominator, y: 0, z: normalZ / denominator };
}

/**
 * Edges of the alpine road apron (#138): a narrow mitered ribbon every ≤ 2 m that keeps both
 * shoulders on ground where a lower hairpin leg holds the raster down. Each edge point stays
 * 0.3 m under its own road and under any band drawn above it; at a sharp corner the mitered
 * point can lie under the band of the other side.
 */
export function apronSamples(route: EngineRoute): readonly RoadSample[] {
  const count = Math.ceil(route.lengthM / 2);
  const band = createBandIndex([route]);

  return Array.from({ length: count + 1 }, (_, index): RoadSample => {
    const normal = apronOffsetNormal(route, index, count);
    const position = route.worldPos((index * route.lengthM) / count);

    const edge = (lateralM: number): WorldPos => {
      const x = position.x + normal.x * lateralM;
      const z = position.z + normal.z * lateralM;
      const topM = Math.min(position.y, bandSurfaceAt(band, x, z));

      return { x, y: topM - ROAD_APRON_DROP_M, z };
    };

    return { left: edge(-APRON_HALF_WIDTH_M), right: edge(APRON_HALF_WIDTH_M) };
  });
}
