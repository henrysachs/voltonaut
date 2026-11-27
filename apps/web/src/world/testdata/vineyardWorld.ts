import { planVineyard } from "../vineyard-decor.js";
import type { VineyardPlan } from "../vineyard-plan.js";
import type { LandscapePlan } from "../landscape-plan.js";
import { resolveRenderWorld, type RenderWorld } from "../render-world.js";
import { planWorldLandscape } from "../world-landscape.js";

/** Path whose world is voltonaut revision 2, the newest world with the vineyard region. */
export const VINEYARD_PATH_ID = "voltonaut-vineyard";

export interface VineyardFixture {
  readonly world: RenderWorld;
  readonly plans: readonly LandscapePlan[];
  readonly plan: LandscapePlan;
  readonly vineyard: VineyardPlan;
}

export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new RangeError("test data is missing");

  return value;
}

/** The vineyard region of voltonaut revision 2 as the landscape draws it. */
export function vineyardFixture(): VineyardFixture {
  const world = resolveRenderWorld(VINEYARD_PATH_ID);
  const plans = planWorldLandscape(world).landscape.plans;
  const index = world.regions.findIndex((region) => region.id === "vineyard");
  const plan = required(plans[index]);

  return { world, plans, plan, vineyard: planVineyard(plan) };
}
