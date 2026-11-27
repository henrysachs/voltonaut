import { COAST_LOOP } from "../../elevation/data/coast-loop.js";
import { NIGHT_CITY } from "../../elevation/data/night-city.js";
import { TEST_LOOP } from "../../elevation/data/test-loop.js";
import { VINEYARD_INTERVALS } from "../../elevation/data/vineyard-intervals.js";
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
      offset: { x: 4800, z: -1800 },
    },
    {
      id: "night-city",
      name: "Nachtstadt",
      scenery: "night-city",
      loop: NIGHT_CITY,
      offset: { x: 3800, z: 3300 },
    },
  ],
});

/**
 * Revision 2 (#146): the vineyard region sits between forest and coast, so the tour rides
 * forest → vineyard → coast → night city → forest. The coast moves east to keep 1.8 km between
 * all loops; revision 1 keeps its geometry and stays replayable.
 */
export const VOLTONAUT_WORLD_REVISION_2: WorldData = regionTourWorld({
  id: "voltonaut",
  name: "Voltonaut",
  revision: "2",
  tourId: "voltonaut-tour",
  tourName: "Voltonaut-Tour",
  chordM: 10,
  matchGrades: true,
  regions: [
    {
      id: "forest",
      name: "Wald und See",
      scenery: "mixed",
      loop: TEST_LOOP,
      offset: { x: 0, z: 0 },
    },
    {
      id: "vineyard",
      name: "Weinberge",
      scenery: "vineyard",
      loop: VINEYARD_INTERVALS,
      offset: { x: 2200, z: -5200 },
      pathName: "Weinberg-Intervalle",
      keepSegments: true,
    },
    {
      id: "coast",
      name: "Küste",
      scenery: "coast",
      loop: COAST_LOOP,
      offset: { x: 7000, z: -2400 },
    },
    {
      id: "night-city",
      name: "Nachtstadt",
      scenery: "night-city",
      loop: NIGHT_CITY,
      offset: { x: 3800, z: 3300 },
    },
  ],
});
