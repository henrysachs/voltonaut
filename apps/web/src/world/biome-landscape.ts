import type { Biome } from "./biome.js";
import {
  createAlpineScenery,
  createCoastScenery,
  createNightCityScenery,
  createStoneAgeScenery,
} from "./biomeScenery.js";
import { planBillboards } from "./billboard-plan.js";
import { createBillboards } from "./billboards.js";
import type { DressingGroup } from "./dressing-group.js";
import type { LandscapePlan } from "./landscape-plan.js";
import { createScenery } from "./scenery.js";
import { createVineyardScenery } from "./vineyardScenery.js";
import { createLake } from "./lake.js";

type BiomeDressing = (plan: LandscapePlan) => readonly DressingGroup[];

const DRESSING: Readonly<Record<Biome["kind"], BiomeDressing>> = {
  forest: (plan) => [
    createLake(plan),
    createScenery(plan),
    createBillboards(planBillboards(plan).billboards),
  ],
  coast: (plan) => [createLake(plan), createCoastScenery(plan)],
  alpine: (plan) => [createAlpineScenery(plan)],
  "night-city": (plan) => [createNightCityScenery(plan)],
  vineyard: (plan) => [createVineyardScenery(plan)],
  "stone-age": (plan) => [createStoneAgeScenery(plan)],
};

/** Lake, plants and props of one biome (#75) on top of the shared world terrain. */
export function biomeObjects(biome: Biome, plan: LandscapePlan): readonly DressingGroup[] {
  return DRESSING[biome.kind](plan);
}
