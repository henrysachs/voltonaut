import { groundPosition } from "./biomeSceneryShared.js";
import { heightAt } from "./heightfield.js";
import type { LandscapePlan } from "./landscape-plan.js";
import {
  firstSite,
  flatEnough,
  lapDistanceM,
  settledOn,
  type Footprints,
  type Placed,
} from "./stone-age-space.js";

export interface RockHouse extends Placed {
  readonly domeRadiusM: number;
  readonly heightM: number;
}

/** The dome sits this far into the ground. */
export const DOME_SINK_M = 0.3;

/** Arch radius of the half-cylinder entrance tunnel. */
export const ENTRANCE_RADIUS_M = 1.25;

/** How far the entrance tunnel reaches out of the dome rim towards the road. */
const ENTRANCE_REACH_M = 0.5;

/** Share of the dome radius where the tunnel starts; the dome is still taller than the arch there. */
export const ENTRANCE_START = 0.6;

/** The tunnel floor and the lower edge of the doorway sit this far into the ground. */
export const HOUSE_FLOOR_SINK_M = 0.1;

/** Height of the dark doorway and how far it stands proud of the tunnel mouth. */
export const DOOR_HEIGHT_M = 1;
export const DOOR_PROUD_M = 0.02;

export function entranceLengthM(house: Readonly<RockHouse>): number {
  return house.domeRadiusM * (1 - ENTRANCE_START) + ENTRANCE_REACH_M;
}

/** Distance from the dome centre to the middle of the entrance tunnel. */
export function entranceMiddleM(house: Readonly<RockHouse>): number {
  return house.domeRadiusM * ENTRANCE_START + entranceLengthM(house) / 2;
}

/** Distance from the dome centre to the doorway on the tunnel mouth. */
export function doorwayM(house: Readonly<RockHouse>): number {
  return house.domeRadiusM * ENTRANCE_START + entranceLengthM(house) + DOOR_PROUD_M;
}

/** Beyond the dome rim the foot reaches the corners of the tunnel mouth (at most R + 0.71 m). */
const HOUSE_FOOT_BEYOND_DOME_M = 0.8;

/** Ground under the dome centre must stay below the dome's middle, with this much to spare. */
const DOME_MIDDLE_MARGIN_M = 0.1;

function houseMaxReliefM(house: Readonly<RockHouse>): number {
  return house.heightM / 2 - DOME_SINK_M - DOME_MIDDLE_MARGIN_M;
}

/**
 * Ground above the tunnel floor allowed under the tunnel middle and under the doorway: below the
 * arch middle (0.625 m) and below a third of the doorway, so neither disappears into the hill.
 */
const TUNNEL_MAX_RISE_M = 0.5;
const DOORWAY_MAX_RISE_M = 0.3;

/**
 * Whether the entrance stays out of the hill. Settling keeps the tunnel floor on the ground at the
 * mouth, but a dome on a slope may still face its door uphill into the terrain.
 */
function entranceClear(plan: Readonly<LandscapePlan>, house: Readonly<RockHouse>): boolean {
  const floorM = house.position.y - HOUSE_FLOOR_SINK_M;
  // The door at local +Z: a yaw of rotationRad turns it towards (sin, cos).
  const towardX = Math.sin(house.rotationRad);
  const towardZ = Math.cos(house.rotationRad);

  function riseM(alongM: number): number {
    const x = house.position.x + towardX * alongM;
    const z = house.position.z + towardZ * alongM;

    return heightAt(plan.terrain, x, z) - floorM;
  }

  return (
    riseM(entranceMiddleM(house)) <= TUNNEL_MAX_RISE_M &&
    riseM(doorwayM(house)) <= DOORWAY_MAX_RISE_M
  );
}

/** A house also needs an entrance out of the hill, so it tries more sites than a statue. */
const HOUSE_SITE_TRIES = 6;

/** Village across the lap line and a hamlet on the plateau above the Steinbruch. */
const SETTLEMENTS: readonly { readonly fromM: number; readonly toM: number }[] = [
  { fromM: -360, toM: 440 },
  { fromM: 3380, toM: 3820 },
];

function rockHouseAt(
  plan: Readonly<LandscapePlan>,
  distanceM: number,
  random: () => number,
): RockHouse {
  const side = random() < 0.5 ? -1 : 1;
  const domeRadiusM = 3.2 + random() * 2.6;
  const routeDistanceM = lapDistanceM(plan, distanceM + random() * 14);

  const position = settledOn(
    plan,
    groundPosition(plan, routeDistanceM, side * (15 + random() * 24)),
    {
      radiusM: domeRadiusM + HOUSE_FOOT_BEYOND_DOME_M,
      sinkM: HOUSE_FLOOR_SINK_M,
    },
  );

  const road = plan.route.worldPos(routeDistanceM);
  const shade = random();

  return {
    routeDistanceM,
    position,
    radiusM: domeRadiusM + 1.2,
    // The door at local +Z looks at the road.
    rotationRad: Math.atan2(road.x - position.x, road.z - position.z),
    shade,
    scale: 1,
    domeRadiusM,
    heightM: domeRadiusM * (0.75 + shade * 0.2),
  };
}

export function rockHouses(
  plan: Readonly<LandscapePlan>,
  space: Footprints,
  random: () => number,
): readonly RockHouse[] {
  const houses: RockHouse[] = [];

  for (const { fromM, toM } of SETTLEMENTS) {
    for (let distanceM = fromM; distanceM < toM; distanceM += 38) {
      const house = firstSite(HOUSE_SITE_TRIES, () => {
        const candidate = rockHouseAt(plan, distanceM, random);
        const footM = candidate.domeRadiusM + HOUSE_FOOT_BEYOND_DOME_M;

        return space.fits(candidate.position, candidate.radiusM) &&
          flatEnough(plan, candidate.position, footM, houseMaxReliefM(candidate)) &&
          entranceClear(plan, candidate)
          ? candidate
          : undefined;
      });

      if (house === undefined) continue;

      space.claim(house);
      houses.push(house);
    }
  }

  return houses;
}
