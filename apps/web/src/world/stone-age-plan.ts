import type { WorldPos } from "@voltonaut/engine";

import {
  groundPosition,
  routeClearanceM,
  routeCorridorSamples,
  seededRandom,
  type ChunkItem,
} from "./biomeSceneryShared.js";
import { PLANT_ROAD_CLEARANCE_M, type LandscapePlan, type Plant } from "./landscape-plan.js";

/** Road samples every 2 m overestimate the clearance by at most 0.08 m from 7 m on. */
const ROAD_SAMPLE_STEP_M = 2;
const SAMPLING_SLACK_M = 0.1;

/** Decor with a horizontal footprint circle that stays clear of the road and of other decor. */
export interface Placed extends ChunkItem {
  readonly position: WorldPos;
  readonly radiusM: number;
  readonly rotationRad: number;
  readonly shade: number;
  readonly scale: number;
}

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

interface Footprints {
  readonly fits: (position: Readonly<WorldPos>, radiusM: number) => boolean;
  readonly claim: (item: Readonly<Placed>) => void;
}

/** Road clearance plus the discs of the volcanoes, houses and statues placed so far. */
function footprints(plan: Readonly<LandscapePlan>): Footprints {
  const road = routeCorridorSamples(plan.route, ROAD_SAMPLE_STEP_M);
  const claimed: Placed[] = [];

  return {
    fits(position, radiusM) {
      const reachM = PLANT_ROAD_CLEARANCE_M + radiusM + SAMPLING_SLACK_M;

      return (
        routeClearanceM(position, road) >= reachM &&
        claimed.every(
          (other) =>
            Math.hypot(position.x - other.position.x, position.z - other.position.z) >=
            radiusM + other.radiusM,
        )
      );
    },
    claim(item) {
      claimed.push(item);
    },
  };
}

/** Distance on the lap for a possibly negative or overlong offset from the start line. */
function lapDistanceM(plan: Readonly<LandscapePlan>, distanceM: number): number {
  const lengthM = plan.route.lengthM;

  return Math.min(lengthM - 0.01, ((distanceM % lengthM) + lengthM) % lengthM);
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
  const position = groundPosition(plan, routeDistanceM, side * (15 + random() * 24));
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
      const house = rockHouseAt(plan, distanceM, random);

      if (!space.fits(house.position, house.radiusM)) continue;

      space.claim(house);
      houses.push(house);
    }
  }

  return houses;
}

/** Tail tip to snout of a statue at scale 1, from its centre; the footprint covers it. */
const STATUE_REACH_M = 7.8;

function dinoStatues(
  plan: Readonly<LandscapePlan>,
  space: Footprints,
  random: () => number,
): readonly Placed[] {
  const statues: Placed[] = [];

  for (let distanceM = 260; distanceM < plan.route.lengthM; distanceM += 640) {
    const side = statues.length % 2 === 0 ? 1 : -1;
    const scale = 0.9 + random() * 0.7;
    const radiusM = STATUE_REACH_M * scale;
    const routeDistanceM = lapDistanceM(plan, distanceM + random() * 80);
    const lateralM = side * (PLANT_ROAD_CLEARANCE_M + radiusM + 5 + random() * 14);
    const position = groundPosition(plan, routeDistanceM, lateralM);
    // Local +X is the snout; a yaw of −heading shows the profile to the passing rider.
    const rotationRad = -plan.route.headingRad(routeDistanceM) + (random() - 0.5) * 0.8;
    const statue = { routeDistanceM, position, radiusM, rotationRad, shade: random(), scale };

    if (!space.fits(position, radiusM)) continue;

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
    const ground = groundPosition(plan, routeDistanceM, site.lateralM);

    const volcano: Volcano = {
      routeDistanceM,
      // Sunk so the cone still meets the ground on its lower side.
      position: { ...ground, y: ground.y - site.heightM * 0.12 },
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

interface Greenery {
  readonly palms: readonly Placed[];
  readonly ferns: readonly Placed[];
  readonly boulders: readonly Placed[];
}

/** Horizontal reach of the fronds from the stem at scale 1. */
const PALM_REACH_M = 3.8;
const FERN_REACH_M = 2.1;

function plantDecor(plant: Readonly<Plant>, reachM: number, scale: number): Placed {
  return {
    routeDistanceM: plant.routeDistanceM,
    position: plant.position,
    radiusM: reachM * scale,
    rotationRad: plant.rotationRad,
    shade: plant.shade,
    scale,
  };
}

/** The forest plan's corridor-checked trees become palms and ferns, its rocks boulders. */
function greenery(plan: Readonly<LandscapePlan>, space: Footprints): Greenery {
  const palms: Placed[] = [];
  const ferns: Placed[] = [];
  const boulders: Placed[] = [];

  for (const tree of plan.trees) {
    const palm = tree.shade > 0.55;
    const item = plantDecor(tree, palm ? PALM_REACH_M : FERN_REACH_M, 0.8 + tree.shade * 0.5);

    if (space.fits(item.position, item.radiusM)) (palm ? palms : ferns).push(item);
  }

  for (const rock of plan.rocks) {
    const item = plantDecor(rock, rock.radiusM, 1);

    if (space.fits(item.position, item.radiusM)) boulders.push(item);
  }

  return { palms, ferns, boulders };
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
