import {
  createWorld,
  regionTourWorld,
  type CenterlinePoint,
  type RouteData,
} from "@voltonaut/engine";

import { renderWorldOf } from "../render-world.js";

/** A flat 1.2 km ring of 10 m chords, small enough to build a two-region world in a test. */
function ring(id: string, scenery: string): RouteData {
  const count = 120;
  const radiusM = 10 / (2 * Math.sin(Math.PI / count));

  const centerline: readonly CenterlinePoint[] = Array.from({ length: count + 1 }, (_, index) => {
    const angleRad = (2 * Math.PI * (index % count)) / count;

    return { x: radiusM * Math.cos(angleRad), z: radiusM * Math.sin(angleRad) };
  });

  const lengthM = centerline
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum +
        Math.hypot(point.x - (centerline[index]?.x ?? 0), point.z - (centerline[index]?.z ?? 0)),
      0,
    );

  return {
    id,
    name: id,
    lengthM,
    loop: true,
    centerline,
    profileSamples: [
      { distanceM: 0, elevationM: 20 },
      { distanceM: lengthM, elevationM: 20 },
    ],
    segments: [],
    scenery,
  };
}

/** Woods and night city, 1.6 km apart, joined by a tour (ADR-033 step 3 in miniature). */
export const PAIR = renderWorldOf(
  createWorld(
    regionTourWorld({
      id: "pair",
      name: "Pair",
      revision: "1",
      tourId: "pair-tour",
      tourName: "Pair tour",
      chordM: 10,
      regions: [
        {
          id: "woods",
          name: "Woods",
          scenery: "mixed",
          loop: ring("w", "mixed"),
          offset: { x: 0, z: 0 },
        },
        {
          id: "city",
          name: "City",
          scenery: "night-city",
          loop: ring("c", "night-city"),
          offset: { x: 1600, z: 0 },
        },
      ],
    }),
  ),
);
