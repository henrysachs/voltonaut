import type { EngineRoute, WorldPos } from "@voltonaut/engine";

/** Distance between the road ribbon's support points along the route. */
export const ROAD_SAMPLE_SPACING_M = 4;

/** Width of the widest road layer, the shoulder band (±4 m around the centerline). */
export const SHOULDER_WIDTH_M = 8;

/** Height of the asphalt ribbon above the route profile; the shoulder sits 0.02 m lower. */
export const ROAD_LIFT_M = 0.025;

export interface RoadSample {
  readonly left: WorldPos;
  readonly right: WorldPos;
}

/** Route distances of the ribbon support points: first and last coincide with the route ends. */
export function roadSampleDistances(route: Pick<EngineRoute, "lengthM">): readonly number[] {
  const count = Math.ceil(route.lengthM / ROAD_SAMPLE_SPACING_M);

  return Array.from({ length: count + 1 }, (_, index) => (index / count) * route.lengthM);
}

/** Centerline support points of the drawn road with the route profile height. */
export function roadCenterSamples(route: EngineRoute): readonly WorldPos[] {
  return roadSampleDistances(route).map((distanceM) => route.worldPos(distanceM));
}

/** Left and right ribbon edges at every support point, lifted by ROAD_LIFT_M. */
export function sampleRoad(route: EngineRoute, widthM: number, offsetM = 0): readonly RoadSample[] {
  return roadSampleDistances(route).map((distanceM) => {
    const position = route.worldPos(distanceM);
    const heading = route.headingRad(distanceM);

    const edge = (lateralM: number): WorldPos => ({
      x: position.x - Math.sin(heading) * lateralM,
      y: position.y + ROAD_LIFT_M,
      z: position.z + Math.cos(heading) * lateralM,
    });

    return { left: edge(offsetM - widthM / 2), right: edge(offsetM + widthM / 2) };
  });
}
