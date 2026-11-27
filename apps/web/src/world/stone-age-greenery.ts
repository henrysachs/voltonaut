import type { Foot } from "./heightfield.js";
import type { LandscapePlan, Plant } from "./landscape-plan.js";
import { flatEnough, settledOn, type Footprints, type Placed } from "./stone-age-space.js";

export interface Greenery {
  readonly palms: readonly Placed[];
  readonly ferns: readonly Placed[];
  readonly boulders: readonly Placed[];
}

/** Horizontal reach of the fronds from the stem at scale 1. */
const PALM_REACH_M = 3.8;
const FERN_REACH_M = 2.1;

/** Foot radius at scale 1: the palm trunk and the rim of a fern frond base (stoneAgeScenery.ts). */
const PALM_FOOT_M = 0.45;
const FERN_FOOT_M = 0.31;

/**
 * At scale 1, how far a fern's fronds reach out over the ground they could sink into, and how
 * much the ground may rise there: a frond's middle stands 0.43 m above the stem.
 */
const FERN_GROUND_REACH_M = 0.95;
const FERN_MAX_RELIEF_M = 0.4;

/** A boulder's lowest corners lie this share of its radius off its centre and below the ground. */
const BOULDER_FOOT_SHARE = 0.55;
const BOULDER_SINK_SHARE = 0.3;

function plantDecor(
  plan: Readonly<LandscapePlan>,
  plant: Readonly<Plant>,
  reachM: number,
  scale: number,
  foot: Readonly<Foot>,
): Placed {
  return {
    routeDistanceM: plant.routeDistanceM,
    position: settledOn(plan, plant.position, foot),
    radiusM: reachM * scale,
    rotationRad: plant.rotationRad,
    shade: plant.shade,
    scale,
  };
}

/** The forest plan's corridor-checked trees become palms and ferns, its rocks boulders. */
export function greenery(plan: Readonly<LandscapePlan>, space: Footprints): Greenery {
  const palms: Placed[] = [];
  const ferns: Placed[] = [];
  const boulders: Placed[] = [];

  for (const tree of plan.trees) {
    const palm = tree.shade > 0.55;
    const scale = 0.8 + tree.shade * 0.5;
    const foot = { radiusM: (palm ? PALM_FOOT_M : FERN_FOOT_M) * scale, sinkM: 0 };
    const item = plantDecor(plan, tree, palm ? PALM_REACH_M : FERN_REACH_M, scale, foot);

    if (!space.fits(item.position, item.radiusM)) continue;

    if (palm) palms.push(item);
    else if (
      flatEnough(plan, item.position, FERN_GROUND_REACH_M * scale, FERN_MAX_RELIEF_M * scale)
    )
      ferns.push(item);
  }

  for (const rock of plan.rocks) {
    const item = plantDecor(plan, rock, rock.radiusM, 1, {
      radiusM: rock.radiusM * BOULDER_FOOT_SHARE,
      sinkM: rock.radiusM * BOULDER_SINK_SHARE,
    });

    if (space.fits(item.position, item.radiusM)) boulders.push(item);
  }

  return { palms, ferns, boulders };
}
