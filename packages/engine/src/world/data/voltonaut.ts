import { COAST_LOOP } from "../../elevation/data/coast-loop.js";
import { NIGHT_CITY } from "../../elevation/data/night-city.js";
import { TEST_LOOP } from "../../elevation/data/test-loop.js";
import { regionTourWorld } from "../build/regionTour.js";
import type { WorldData } from "../types.js";

/**
 * The first connected world (ADR-033 step 3, #171): forest, coast and night city as regions,
 * joined by transition roads into the Voltonaut tour. Region loops keep their shipped shapes;
 * the alpine pass joins once its turnarounds are curves instead of 90° kinks.
 */
export const VOLTONAUT_WORLD: WorldData = regionTourWorld({
  id: "voltonaut",
  name: "Voltonaut",
  revision: "1",
  tourId: "voltonaut-tour",
  tourName: "Voltonaut-Tour",
  chordM: 10,
  regions: [
    {
      id: "forest",
      name: "Wald und See",
      scenery: "mixed",
      loop: TEST_LOOP,
      offset: { x: 0, z: 0 },
    },
    {
      id: "coast",
      name: "Küste",
      scenery: "coast",
      loop: COAST_LOOP,
      offset: { x: 7000, z: -3000 },
    },
    {
      id: "night-city",
      name: "Nachtstadt",
      scenery: "night-city",
      loop: NIGHT_CITY,
      offset: { x: 6500, z: 4500 },
    },
  ],
});
