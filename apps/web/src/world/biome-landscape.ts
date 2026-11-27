import type * as THREE from "three";

import type { Biome } from "./biome.js";
import { createAlpineScenery, createCoastScenery, createNightCityScenery } from "./biomeScenery.js";
import { planBillboards } from "./billboard-plan.js";
import { createBillboards } from "./billboards.js";
import type { LandscapePlan } from "./landscape-plan.js";
import { createScenery } from "./scenery.js";
import { createLake } from "./lake.js";

type BiomeDressing = (plan: LandscapePlan) => readonly THREE.Object3D[];

const DRESSING: Readonly<Record<Biome["kind"], BiomeDressing>> = {
  forest: (plan) => [
    createLake(plan),
    createScenery(plan),
    createBillboards(planBillboards(plan).billboards),
  ],
  coast: (plan) => [createLake(plan), createCoastScenery(plan)],
  alpine: (plan) => [createAlpineScenery(plan)],
  "night-city": (plan) => [createNightCityScenery(plan)],
};

/** Lake, plants and props of one biome (#75) on top of the shared world terrain. */
export function biomeObjects(biome: Biome, plan: LandscapePlan): readonly THREE.Object3D[] {
  return DRESSING[biome.kind](plan);
}
