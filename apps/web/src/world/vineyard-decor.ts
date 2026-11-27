import { heightAt, settledHeightAt } from "./heightfield.js";
import { offsetPosition } from "./lake-plan.js";
import type { LandscapePlan } from "./landscape-plan.js";
import { seededRandom } from "./biomeSceneryShared.js";
import { standsOnSlope } from "./vineyard-footing.js";
import {
  CYPRESS_CLEARANCE_M,
  freeOfRoads,
  HOUSE_CLEARANCE_M,
  HOUSE_DEPTH_M,
  HOUSE_HEIGHT_M,
  HOUSE_WIDTH_M,
  vineChords,
  vineyardSite,
  type VineyardSite,
  type Cypress,
  type StoneHouse,
  type VineyardPlan,
} from "./vineyard-plan.js";

const CYPRESS_STEP_M = 28;
const HOUSE_STEP_M = 520;

interface Direction {
  readonly x: number;
  readonly z: number;
}

function cypressAt(
  plan: VineyardSite,
  random: () => number,
  x: number,
  z: number,
): Cypress | undefined {
  const heightM = 9 + random() * 5;
  const radiusM = 0.9 + random() * 0.4;

  const cypress = {
    // The cone's base ring must reach the ground on its downhill side too.
    position: { x, y: settledHeightAt(plan.terrain, x, z, { radiusM, sinkM: 0 }), z },
    heightM,
    radiusM,
    shade: random(),
  };

  return freeOfRoads(plan, x, z, CYPRESS_CLEARANCE_M + cypress.radiusM) ? cypress : undefined;
}

function cypressesAlong(plan: VineyardSite, random: () => number): readonly Cypress[] {
  const cypresses: Cypress[] = [];

  for (let distanceM = 0; distanceM < plan.route.lengthM; distanceM += CYPRESS_STEP_M) {
    for (const side of [-1, 1]) {
      const spot = offsetPosition(
        plan.route,
        distanceM + random() * 12,
        side * (12 + random() * 3),
      );

      const planted = random() < 0.3 ? cypressAt(plan, random, spot.x, spot.z) : undefined;

      if (planted !== undefined) cypresses.push(planted);
    }
  }

  return cypresses;
}

/** Ground points under the four corners and the centre of a house footprint. */
function footprint(x: number, z: number, yawRad: number): readonly Direction[] {
  const halfW = HOUSE_WIDTH_M / 2;
  const halfD = HOUSE_DEPTH_M / 2;
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);

  const corners: readonly Direction[] = [
    { x: 0, z: 0 },
    { x: halfW, z: halfD },
    { x: halfW, z: -halfD },
    { x: -halfW, z: halfD },
    { x: -halfW, z: -halfD },
  ];

  return corners.map((corner) => ({
    x: x + corner.x * cos + corner.z * sin,
    z: z - corner.x * sin + corner.z * cos,
  }));
}

function housesAlong(plan: VineyardSite, random: () => number): readonly StoneHouse[] {
  const houses: StoneHouse[] = [];

  for (let distanceM = 120; distanceM < plan.route.lengthM; distanceM += HOUSE_STEP_M) {
    const alongM = distanceM + random() * 160;
    const side = random() < 0.5 ? -1 : 1;
    const lateralM = side * (28 + random() * 22);
    const spot = offsetPosition(plan.route, alongM, lateralM);
    const yawRad = -plan.route.headingRad(alongM);
    const corners = footprint(spot.x, spot.z, yawRad);
    const shade = random();

    if (corners.every((corner) => freeOfRoads(plan, corner.x, corner.z, HOUSE_CLEARANCE_M))) {
      const lowestM = Math.min(
        ...corners.map((corner) => heightAt(plan.terrain, corner.x, corner.z)),
      );

      if (standsOnSlope(heightAt(plan.terrain, spot.x, spot.z), lowestM, HOUSE_HEIGHT_M)) {
        houses.push({ position: { x: spot.x, y: lowestM, z: spot.z }, yawRad, shade });
      }
    }
  }

  return houses;
}

/** The vineyard decor of a region along its home path; every part avoids all roads of the world. */
export function planVineyard(landscape: Readonly<LandscapePlan>, seed = 146): VineyardPlan {
  const plan = vineyardSite(landscape);
  const random = seededRandom(seed);
  const houses = housesAlong(plan, random);

  const houseCypresses = houses.flatMap((house) =>
    [-1, 1].flatMap((side) => {
      const cypress = cypressAt(
        plan,
        random,
        house.position.x + Math.sin(house.yawRad) * side * 6,
        house.position.z + Math.cos(house.yawRad) * side * 6,
      );

      return cypress === undefined ? [] : [cypress];
    }),
  );

  return {
    chords: vineChords(plan, random),
    cypresses: [...cypressesAlong(plan, random), ...houseCypresses],
    houses,
  };
}
