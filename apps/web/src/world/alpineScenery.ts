/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D and Color are mutable scene resources; these layers own the instances they write. */
import type { WorldPos } from "@voltonaut/engine";
import * as THREE from "three";

import {
  chunkedMeshes,
  groundPosition,
  routeClearanceM,
  routeCorridorSamples,
  seededRandom,
  CHUNK_M,
  type ChunkLayer,
  type ChunkItem,
} from "./biomeSceneryShared.js";
import { DressingGroup, STANDS } from "./dressing-group.js";
import { settledHeightAt, type Foot } from "./heightfield.js";
import type { LandscapePlan, Plant } from "./landscape-plan.js";

const MAX_CHUNKS_PER_LAYER = 70;

/** Rock centres sit this fraction of the rock's height above their ground point. */
const ROCK_LIFT = 0.35;

/**
 * IcosahedronGeometry(1, 0) rests on its two lowest vertices, 0.851 below its centre and 0.526 off
 * its axis; rounded so the foot reaches no less far and sinks no deeper than the drawn rock.
 */
const ROCK_FOOT_DROP = 0.85;
const ROCK_FOOT_REACH = 0.53;

/** Pine cones sit this far into the ground they stand on. */
const PINE_SINK_M = 0.1;

interface AlpineRock extends ChunkItem {
  readonly position: WorldPos;
  readonly radiusM: number;
  readonly heightM: number;
  readonly rotationRad: number;
  readonly shade: number;
}

interface AlpineFlora {
  readonly rocks: readonly AlpineRock[];
  readonly pines: readonly Plant[];
}

/** A rock or pine on the steep flanks sinks until its foot meets the downhill ground too (#138). */
function settled(plan: Readonly<LandscapePlan>, ground: Readonly<WorldPos>, foot: Foot): WorldPos {
  return { ...ground, y: settledHeightAt(plan.terrain, ground.x, ground.z, foot) };
}

/** Size of a rock and its ground point, settled so its lowest corners touch the slope. */
function rockBody(
  plan: Readonly<LandscapePlan>,
  ground: Readonly<WorldPos>,
  shade: number,
): Pick<AlpineRock, "position" | "radiusM" | "heightM"> {
  const radiusM = 0.6 + shade * 2.4;
  const heightM = 0.6 + shade * 1.8;
  const sinkM = heightM * (ROCK_FOOT_DROP - ROCK_LIFT);

  return {
    radiusM,
    heightM,
    position: settled(plan, ground, { radiusM: radiusM * ROCK_FOOT_REACH, sinkM }),
  };
}

function alpineFlora(plan: Readonly<LandscapePlan>, random: () => number): AlpineFlora {
  const rocks: AlpineRock[] = [];
  const pines: Plant[] = [];
  const roadSamples = routeCorridorSamples(plan.route);

  for (let distanceM = 0; distanceM < plan.route.lengthM; distanceM += 30) {
    for (const side of [-1, 1]) {
      const alongM = Math.min(plan.route.lengthM - 0.01, distanceM + random() * 18);
      const lateralM = side * (12 + random() * 110);
      const shade = random();
      const pineShade = random();
      const rockPosition = groundPosition(plan, alongM, lateralM);

      if (routeClearanceM(rockPosition, roadSamples) >= 8) {
        rocks.push({
          routeDistanceM: alongM,
          ...rockBody(plan, rockPosition, shade),
          rotationRad: random() * Math.PI * 2,
          // Far-placed rocks read as snow fields; near ones as bare rock.
          shade: Math.abs(lateralM) > 90 ? 0.75 + shade * 0.25 : shade * 0.5,
        });
      }

      if (pineShade > 0.45) {
        const pinePosition = groundPosition(plan, alongM, side * (25 + random() * 145));

        if (routeClearanceM(pinePosition, roadSamples) >= 8) {
          const radiusM = 1.4 + pineShade;

          pines.push({
            roadIndex: 0,
            routeDistanceM: alongM,
            position: settled(plan, pinePosition, { radiusM, sinkM: PINE_SINK_M }),
            radiusM,
            heightM: 5 + pineShade * 6,
            rotationRad: random() * Math.PI * 2,
            shade: pineShade,
          });
        }
      }
    }
  }

  return { rocks, pines };
}

function rockLayer(rocks: readonly AlpineRock[]): ChunkLayer<AlpineRock> {
  return {
    geometry: new THREE.IcosahedronGeometry(1, 0),
    material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
    items: rocks,
    transform(rock: Readonly<AlpineRock>, object: Readonly<THREE.Object3D>) {
      object.position.set(
        rock.position.x,
        rock.position.y + rock.heightM * ROCK_LIFT,
        rock.position.z,
      );
      object.rotation.set(0, rock.rotationRad, 0);
      object.scale.set(rock.radiusM, rock.heightM, rock.radiusM);
    },
    tint(rock: Readonly<AlpineRock>, color: Readonly<THREE.Color>) {
      color.setHSL(0.58, 0.04, 0.28 + rock.shade * 0.62);
    },
  };
}

function pineLayer(pines: readonly Plant[]): ChunkLayer<Plant> {
  return {
    geometry: new THREE.ConeGeometry(1, 1, 7),
    material: new THREE.MeshStandardMaterial({ color: 0x24402e, roughness: 1, flatShading: true }),
    items: pines,
    transform(pine: Readonly<Plant>, object: Readonly<THREE.Object3D>) {
      object.position.set(
        pine.position.x,
        pine.position.y + pine.heightM * 0.5 - PINE_SINK_M,
        pine.position.z,
      );
      object.rotation.set(0, pine.rotationRad, 0);
      object.scale.set(pine.radiusM, pine.heightM, pine.radiusM);
    },
    tint(pine: Readonly<Plant>, color: Readonly<THREE.Color>) {
      color.setHSL(0.35, 0.3, 0.16 + pine.shade * 0.1);
    },
  };
}

/** Alpine: rock and snow in one instanced layer, sparse dark pines above. */
export function createAlpineScenery(plan: Readonly<LandscapePlan>): DressingGroup {
  const root = new DressingGroup();
  const flora = alpineFlora(plan, seededRandom(11));

  const chunkSizeM = Math.max(
    CHUNK_M,
    Math.ceil(plan.route.lengthM / (CHUNK_M * MAX_CHUNKS_PER_LAYER)) * CHUNK_M,
  );

  root.name = "biome-alpine";
  root.place(
    STANDS,
    ...chunkedMeshes(rockLayer(flora.rocks), chunkSizeM),
    ...chunkedMeshes(pineLayer(flora.pines), chunkSizeM),
  );

  return root;
}
