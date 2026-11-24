import * as THREE from "three";

import { planBillboards } from "./billboard-plan.js";
import { createBillboards } from "./billboards.js";
import { createLandscapePlan } from "./landscape-plan.js";
import { disposeObject } from "./resources.js";
import type { RenderSystem } from "./scheduler.js";
import { createScenery } from "./scenery.js";
import { createLake, createTerrain } from "./terrain.js";

export function createLandscapeSystem(): RenderSystem {
  const root = new THREE.Group();

  return {
    id: "landscape",
    order: 15,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This system installs its owned static meshes into the Three scene.
    init(context) {
      const plan = createLandscapePlan(context.route);

      root.add(
        createTerrain(plan),
        createLake(plan),
        createScenery(plan),
        createBillboards(planBillboards(plan)),
      );
      context.scene.add(root);
    },
    update() {},
    setQuality() {},
    dispose() {
      disposeObject(root);
    },
  };
}
