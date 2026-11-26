import { createRoute, type EngineRoute } from "@voltonaut/engine";

interface PointXz {
  readonly x: number;
  readonly z: number;
}

/** Test-only road along a polyline with a constant grade, for corridor and clearance tests. */
export function polylineRoad(
  id: string,
  centerline: readonly PointXz[],
  startYM: number,
  gradePct: number,
): EngineRoute {
  let lengthM = 0;

  for (const [index, point] of centerline.entries()) {
    const next = centerline[index + 1];

    if (next !== undefined) lengthM += Math.hypot(next.x - point.x, next.z - point.z);
  }

  return createRoute({
    id,
    name: id,
    lengthM,
    loop: false,
    centerline,
    profileSamples: [
      { distanceM: 0, elevationM: startYM },
      { distanceM: lengthM, elevationM: startYM + (lengthM * gradePct) / 100 },
    ],
    segments: [],
    scenery: "test",
  });
}

/**
 * A hairpin: 200 m out along +x, a half circle of radiusM, 200 m back. The legs run
 * 2·radiusM apart; the far leg is higher by the grade times the way round.
 */
export function hairpinRoad(radiusM: number, gradePct: number): EngineRoute {
  const turn = Array.from({ length: 33 }, (_, index) => {
    const angle = -Math.PI / 2 + (index / 32) * Math.PI;

    return { x: 200 + radiusM * Math.cos(angle), z: radiusM + radiusM * Math.sin(angle) };
  });

  return polylineRoad(
    "hairpin",
    [{ x: 0, z: 0 }, ...turn, { x: 0, z: 2 * radiusM }],
    100,
    gradePct,
  );
}
