/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D and Color are mutable scene resources; these layers own the instances they write. */
import type { WorldPos } from "@voltonaut/engine";
import * as THREE from "three";

import {
  chunkedMeshes,
  groundPosition,
  routeBounds,
  seededRandom,
  type ChunkLayer,
  type ChunkItem,
} from "./biomeSceneryShared.js";
import { CARRIED, DressingGroup, STANDS, WATER } from "./dressing-group.js";
import { settledHeightAt } from "./heightfield.js";
import { lakeRadius } from "./lake-plan.js";
import { PLANT_LAKE_CLEARANCE, type LandscapePlan } from "./landscape-plan.js";

interface Palm extends ChunkItem {
  readonly position: WorldPos;
  readonly heightM: number;
  readonly rotationRad: number;
  readonly shade: number;
}

interface Frond extends ChunkItem {
  readonly palm: Readonly<Palm>;
  readonly index: number;
}

const PALM_FRONDS = 6;

/** Trunk radius at its foot, where the palm meets the sand. */
const PALM_FOOT_RADIUS_M = 0.62;

/** A palm leans up to this far either way, pivoting at half its height. */
const PALM_MAX_LEAN_RAD = 0.025;

function palmLeanRad(shade: number): number {
  return 2 * PALM_MAX_LEAN_RAD * (shade - 0.5);
}

/** Tower radius at its foot. */
const LIGHTHOUSE_FOOT_RADIUS_M = 2.1;

/** Ground height a round foot rests on without floating on the downhill side (#138). */
function footHeight(
  plan: Readonly<LandscapePlan>,
  ground: Readonly<WorldPos>,
  radiusM: number,
): number {
  return settledHeightAt(plan.terrain, ground.x, ground.z, { radiusM, sinkM: 0 });
}

function palmsAlong(plan: Readonly<LandscapePlan>, random: () => number): readonly Palm[] {
  const palms: Palm[] = [];

  for (let distanceM = 0; distanceM < plan.route.lengthM; distanceM += 35) {
    for (const side of [-1, 1]) {
      const alongM = Math.min(plan.route.lengthM - 0.01, distanceM + random() * 20);
      const ground = groundPosition(plan, alongM, side * (13 + random() * 46));
      const heightM = 6 + random() * 4;
      const rotationRad = random() * Math.PI * 2;
      const shade = random();

      if (lakeRadius(plan.lake, ground) < PLANT_LAKE_CLEARANCE) continue;

      palms.push({
        routeDistanceM: alongM,
        // The lean swings the foot off the ground point; the foot settles over that reach too.
        position: {
          ...ground,
          y: footHeight(
            plan,
            ground,
            PALM_FOOT_RADIUS_M + (heightM / 2) * Math.sin(Math.abs(palmLeanRad(shade))),
          ),
        },
        heightM,
        rotationRad,
        shade,
      });
    }
  }

  return palms;
}

function palmFronds(palms: readonly Palm[]): readonly Frond[] {
  const fronds: Frond[] = [];

  for (const palm of palms) {
    for (let index = 0; index < PALM_FRONDS; index += 1) {
      fronds.push({ routeDistanceM: palm.routeDistanceM, palm, index });
    }
  }

  return fronds;
}

function palmTrunkLayer(palms: readonly Palm[]): ChunkLayer<Palm> {
  return {
    geometry: new THREE.CylinderGeometry(0.42, PALM_FOOT_RADIUS_M, 1, 6),
    material: new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1, flatShading: true }),
    items: palms,
    transform(palm: Readonly<Palm>, object: Readonly<THREE.Object3D>) {
      object.position.set(palm.position.x, palm.position.y + palm.heightM / 2, palm.position.z);
      object.rotation.set(0, palm.rotationRad, palmLeanRad(palm.shade));
      object.scale.set(1, palm.heightM, 1);
    },
    tint(palm: Readonly<Palm>, color: Readonly<THREE.Color>) {
      color.setHSL(0.08, 0.35, 0.32 + palm.shade * 0.12);
    },
  };
}

function palmFrondLayer(palms: readonly Palm[]): ChunkLayer<Frond> {
  return {
    geometry: new THREE.ConeGeometry(0.55, 3.2, 5),
    material: new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 1, flatShading: true }),
    items: palmFronds(palms),
    transform(frond: Readonly<Frond>, object: Readonly<THREE.Object3D>) {
      const yawRad = frond.palm.rotationRad + (frond.index / PALM_FRONDS) * Math.PI * 2;

      object.position.set(
        frond.palm.position.x,
        frond.palm.position.y + frond.palm.heightM - 0.3,
        frond.palm.position.z,
      );
      object.rotation.set(0, yawRad, 0);
      object.rotateX(1.15);
      object.scale.set(1 + frond.palm.shade * 0.4, 1, 1 + frond.palm.shade * 0.4);
    },
    tint(frond: Readonly<Frond>, color: Readonly<THREE.Color>) {
      color.setHSL(0.29 + frond.palm.shade * 0.05, 0.45, 0.3 + frond.palm.shade * 0.2);
    },
  };
}

function createSea(plan: Readonly<LandscapePlan>): THREE.Mesh {
  const { centerX, centerZ, minY } = routeBounds(plan);

  const sea = new THREE.Mesh(
    new THREE.CircleGeometry(3200, 48),
    new THREE.MeshStandardMaterial({ color: 0x2e7fa8, roughness: 0.35, metalness: 0.1 }),
  );

  sea.name = "biome-sea";
  sea.rotation.x = -Math.PI / 2;
  // Keep the sea below the lowest dune relief so it never floods the palm band.
  sea.position.set(centerX, minY - 8, centerZ);
  sea.receiveShadow = true;

  return sea;
}

function createLighthouse(plan: Readonly<LandscapePlan>): DressingGroup {
  const ground = groundPosition(plan, Math.min(1600, plan.route.lengthM / 2), -320);
  const position = { ...ground, y: footHeight(plan, ground, LIGHTHOUSE_FOOT_RADIUS_M) };
  const root = new DressingGroup();

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, LIGHTHOUSE_FOOT_RADIUS_M, 18, 10),
    new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 }),
  );

  const gallery = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 1.9, 1.2, 10),
    new THREE.MeshStandardMaterial({ color: 0xb8412f, roughness: 0.8 }),
  );

  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1.6, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
  );

  tower.position.set(position.x, position.y + 9, position.z);
  gallery.position.set(position.x, position.y + 18.4, position.z);
  lantern.position.set(position.x, position.y + 19.8, position.z);
  tower.castShadow = true;
  gallery.castShadow = true;

  root.name = "biome-lighthouse";
  root.place(STANDS, tower);
  root.place(CARRIED, gallery, lantern);

  return root;
}

/** Coast: sea to the horizon, sand palette terrain, palms and one lighthouse. */
export function createCoastScenery(plan: Readonly<LandscapePlan>): DressingGroup {
  const root = new DressingGroup();
  const palms = palmsAlong(plan, seededRandom(7));

  root.name = "biome-coast";
  root.place(WATER, createSea(plan));
  root.add(createLighthouse(plan));
  root.place(STANDS, ...chunkedMeshes(palmTrunkLayer(palms)));
  root.place(CARRIED, ...chunkedMeshes(palmFrondLayer(palms)));

  return root;
}
