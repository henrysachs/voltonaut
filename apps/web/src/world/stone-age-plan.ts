import { groundPosition, seededRandom, type ChunkItem } from "./biomeSceneryShared.js";
import { PLANT_ROAD_CLEARANCE_M, type LandscapePlan } from "./landscape-plan.js";
import { greenery } from "./stone-age-greenery.js";
import {
  firstSite,
  flatEnough,
  footprints,
  lapDistanceM,
  settledOn,
  SITE_TRIES,
  type Footprints,
  type Placed,
} from "./stone-age-space.js";

export type { Placed } from "./stone-age-space.js";

export interface RockHouse extends Placed {
  readonly domeRadiusM: number;
  readonly heightM: number;
}

export interface Volcano extends Placed {
  readonly baseRadiusM: number;
  readonly heightM: number;
}

/** One of several identical parts of a decor item: a frond or a lava stream. */
export interface Part<T> extends ChunkItem {
  readonly owner: Readonly<T>;
  readonly index: number;
}

/**
 * Beyond the dome rim the entrance tunnel reaches out to its mouth corners (stoneAgeScenery.ts);
 * its floor sits HOUSE_FLOOR_SINK_M into the ground.
 */
const HOUSE_FOOT_BEYOND_DOME_M = 0.8;
const HOUSE_FLOOR_SINK_M = 0.1;

/** The dome sits 0.3 m into the ground (stoneAgeScenery.ts). */
const DOME_SINK_M = 0.3;

/** Ground under the dome centre must stay below the dome's middle, with this much to spare. */
const DOME_MIDDLE_MARGIN_M = 0.1;

function houseMaxReliefM(house: Readonly<RockHouse>): number {
  return house.heightM / 2 - DOME_SINK_M - DOME_MIDDLE_MARGIN_M;
}

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

function rockHouses(
  plan: Readonly<LandscapePlan>,
  space: Footprints,
  random: () => number,
): readonly RockHouse[] {
  const houses: RockHouse[] = [];

  for (const { fromM, toM } of SETTLEMENTS) {
    for (let distanceM = fromM; distanceM < toM; distanceM += 38) {
      const house = firstSite(SITE_TRIES, () => {
        const candidate = rockHouseAt(plan, distanceM, random);
        const footM = candidate.domeRadiusM + HOUSE_FOOT_BEYOND_DOME_M;

        return space.fits(candidate.position, candidate.radiusM) &&
          flatEnough(plan, candidate.position, footM, houseMaxReliefM(candidate))
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

/** Tail tip to snout of a statue at scale 1, from its centre; the footprint covers it. */
const STATUE_REACH_M = 7.8;

/** Outer edge of the four legs at scale 1, from the statue centre (stoneAgeLandmarks.ts). */
const STATUE_FOOT_M = 1.9;

/** At scale 1, below the middle of a 2.1 m leg. */
const STATUE_MAX_RELIEF_M = 0.8;

function dinoStatues(
  plan: Readonly<LandscapePlan>,
  space: Footprints,
  random: () => number,
): readonly Placed[] {
  const statues: Placed[] = [];

  for (let distanceM = 260; distanceM < plan.route.lengthM; distanceM += 640) {
    const side = statues.length % 2 === 0 ? 1 : -1;

    const statue = firstSite(SITE_TRIES, () => {
      const scale = 0.9 + random() * 0.7;
      const radiusM = STATUE_REACH_M * scale;
      const routeDistanceM = lapDistanceM(plan, distanceM + random() * 80);
      const lateralM = side * (PLANT_ROAD_CLEARANCE_M + radiusM + 5 + random() * 14);

      const position = settledOn(plan, groundPosition(plan, routeDistanceM, lateralM), {
        radiusM: STATUE_FOOT_M * scale,
        sinkM: 0,
      });

      // Local +X is the snout; a yaw of −heading shows the profile to the passing rider.
      const rotationRad = -plan.route.headingRad(routeDistanceM) + (random() - 0.5) * 0.8;
      const candidate = { routeDistanceM, position, radiusM, rotationRad, shade: random(), scale };

      return space.fits(position, radiusM) &&
        flatEnough(plan, position, STATUE_FOOT_M * scale, STATUE_MAX_RELIEF_M * scale)
        ? candidate
        : undefined;
    });

    if (statue === undefined) continue;

    space.claim(statue);
    statues.push(statue);
  }

  return statues;
}

/** Volcanoes beyond both ends of the valley, beside the climb and inside the loop. */
const VOLCANO_SITES: readonly {
  readonly distanceM: number;
  readonly lateralM: number;
  readonly baseRadiusM: number;
  readonly heightM: number;
}[] = [
  { distanceM: 0, lateralM: -370, baseRadiusM: 190, heightM: 220 },
  { distanceM: 2300, lateralM: -400, baseRadiusM: 200, heightM: 230 },
  { distanceM: 4530, lateralM: -380, baseRadiusM: 210, heightM: 260 },
  { distanceM: 5900, lateralM: 360, baseRadiusM: 240, heightM: 280 },
];

function volcanoes(plan: Readonly<LandscapePlan>, space: Footprints): readonly Volcano[] {
  const result: Volcano[] = [];

  for (const [index, site] of VOLCANO_SITES.entries()) {
    const routeDistanceM = lapDistanceM(plan, site.distanceM);
    const sinkM = site.heightM * 0.12;

    // Sunk so the cone still meets the ground on its lower side.
    const ground = settledOn(plan, groundPosition(plan, routeDistanceM, site.lateralM), {
      radiusM: site.baseRadiusM,
      sinkM,
    });

    const volcano: Volcano = {
      routeDistanceM,
      position: { ...ground, y: ground.y - sinkM },
      radiusM: site.baseRadiusM,
      rotationRad: index * 1.3,
      shade: index / VOLCANO_SITES.length,
      scale: 1,
      baseRadiusM: site.baseRadiusM,
      heightM: site.heightM,
    };

    if (!space.fits(volcano.position, volcano.radiusM)) continue;

    space.claim(volcano);
    result.push(volcano);
  }

  return result;
}

export function partsOf<T extends ChunkItem>(
  owners: readonly T[],
  count: number,
): readonly Part<T>[] {
  return owners.flatMap((owner) =>
    Array.from({ length: count }, (_, index) => ({
      routeDistanceM: owner.routeDistanceM,
      owner,
      index,
    })),
  );
}

/** Everything the stone age valley places, each item clear of the road and of the others. */
export interface StoneAgeDecor {
  readonly volcanoes: readonly Volcano[];
  readonly houses: readonly RockHouse[];
  readonly statues: readonly Placed[];
  readonly palms: readonly Placed[];
  readonly ferns: readonly Placed[];
  readonly boulders: readonly Placed[];
}

/**
 * Seeded stone age layout (spec E10-16). Volcanoes claim their ground first, then houses and
 * statues; plants from the forest plan fill the rest.
 */
export function planStoneAge(plan: Readonly<LandscapePlan>): StoneAgeDecor {
  const space = footprints(plan);
  const random = seededRandom(15);
  const fire = volcanoes(plan, space);
  const houses = rockHouses(plan, space, random);
  const statues = dinoStatues(plan, space, random);

  return { volcanoes: fire, houses, statues, ...greenery(plan, space) };
}
