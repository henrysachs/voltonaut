import type { WorldPos } from "@voltonaut/engine";

import { routeClearanceM, routeCorridorSamples, type ChunkItem } from "./biomeSceneryShared.js";
import { heightAt, settledHeightAt, type Foot } from "./heightfield.js";
import { PLANT_ROAD_CLEARANCE_M, type LandscapePlan } from "./landscape-plan.js";

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

export interface Footprints {
  readonly fits: (position: Readonly<WorldPos>, radiusM: number) => boolean;
  readonly claim: (item: Readonly<Placed>) => void;
}

/** Road clearance plus the discs of the volcanoes, houses and statues placed so far. */
export function footprints(plan: Readonly<LandscapePlan>): Footprints {
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
export function lapDistanceM(plan: Readonly<LandscapePlan>, distanceM: number): number {
  const lengthM = plan.route.lengthM;

  return Math.min(lengthM - 0.01, ((distanceM % lengthM) + lengthM) % lengthM);
}

/**
 * The position lowered until a round base, sunk foot.sinkM, meets the drawn terrain under its whole
 * rim (dressing-ground.test.ts). On flat ground it keeps the height under its centre.
 */
export function settledOn(
  plan: Readonly<LandscapePlan>,
  position: Readonly<WorldPos>,
  foot: Readonly<Foot>,
): WorldPos {
  return { ...position, y: settledHeightAt(plan.terrain, position.x, position.z, foot) };
}

const RELIEF_SAMPLES = 16;

/**
 * Whether the drawn terrain rises and falls by at most maxReliefM over the circle around position.
 * Settling lowers a prop onto the low side of a slope; on steeper ground the high side would climb
 * past the middle of a low part (dressing-ground.test.ts), so such sites stay empty.
 */
export function flatEnough(
  plan: Readonly<LandscapePlan>,
  position: Readonly<WorldPos>,
  radiusM: number,
  maxReliefM: number,
): boolean {
  let lowM = heightAt(plan.terrain, position.x, position.z);
  let highM = lowM;

  for (let index = 0; index < RELIEF_SAMPLES; index += 1) {
    const angleRad = (index / RELIEF_SAMPLES) * Math.PI * 2;

    const groundM = heightAt(
      plan.terrain,
      position.x + Math.cos(angleRad) * radiusM,
      position.z + Math.sin(angleRad) * radiusM,
    );

    lowM = Math.min(lowM, groundM);
    highM = Math.max(highM, groundM);
  }

  return highM - lowM <= maxReliefM;
}

/** Seeded sites a house or statue tries before its slot stays empty. */
export const SITE_TRIES = 4;

/** The first site `pick` accepts within `tries` seeded attempts. */
export function firstSite<T>(tries: number, pick: () => T | undefined): T | undefined {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const site = pick();

    if (site !== undefined) return site;
  }

  return undefined;
}
