import { describe, expect, it } from "vitest";
import type * as THREE from "three";

import { DEFAULT_WHEEL_SPEC, frameSpecFor } from "./bikeSpecs.js";
import { RiderOnBike } from "./rider.js";
import { buildRiderMeshes } from "./riderBuild.js";
import { createRiderMaterials } from "./riderMaterials.js";
import { RiderRig } from "./riderRig.js";
import type { RiderMesh } from "./riderSkin.js";
import {
  DEFAULT_RIDER_KIT,
  GLASSES_SPECS,
  HELMET_SPECS,
  JERSEY_SPECS,
  SHOE_SPECS,
  type RiderKit,
} from "./riderSpecs.js";

const WHEEL_CIRC_M = 2.105;

/** docs/04 §11: rider share of the "Eigener Fahrer + Rad" budget. */
const RIDER_TRIANGLES = 20_500;
const RIDER_MESHES = 7;

function triangles(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three meshes are mutable library objects only inspected here.
  meshes: readonly Readonly<RiderMesh>[],
): number {
  let count = 0;

  for (const mesh of meshes) count += (mesh.geometry.index?.count ?? 0) / 3;

  return count;
}

function namesOf(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three objects are mutable library objects, only their names are read.
  objects: readonly Readonly<THREE.Object3D>[],
): string[] {
  const names: string[] = [];

  for (const object of objects) names.push(object.name);

  return names;
}

function withKit(kit: Partial<RiderKit>): RiderKit {
  return { ...DEFAULT_RIDER_KIT, ...kit };
}

const SLOT_KITS: readonly (readonly RiderKit[])[] = [
  JERSEY_SPECS.map((jersey) => withKit({ jersey })),
  HELMET_SPECS.map((helmet) => withKit({ helmet })),
  SHOE_SPECS.map((shoes) => withKit({ shoes })),
  GLASSES_SPECS.map((glasses) => withKit({ glasses })),
];

interface KitLoad {
  readonly triangles: number;
  readonly meshes: number;
}

/** Triangles of the heaviest kit: the base plus the largest extra of every slot (they add up). */
function heaviestKit(): KitLoad {
  const bind = new RiderOnBike(WHEEL_CIRC_M).joints();
  const rig = new RiderRig(bind);
  const materials = createRiderMaterials();

  const build = (kit: Readonly<RiderKit>): readonly RiderMesh[] =>
    buildRiderMeshes(bind, rig, kit, (key) => materials[key]);

  const base = triangles(build(DEFAULT_RIDER_KIT));
  let heaviest = base;
  let meshes = 0;

  for (const kits of SLOT_KITS) {
    let extra = 0;

    for (const kit of kits) {
      const built = build(kit);

      extra = Math.max(extra, triangles(built) - base);
      meshes = Math.max(meshes, built.length);
    }

    heaviest += extra;
  }

  return { triangles: heaviest, meshes };
}

describe("rider kit", () => {
  it("rebuilds only on a kit change, frees the old geometry and keeps the skeleton", () => {
    const rider = new RiderOnBike(WHEEL_CIRC_M);
    const old = rider.meshes();
    const { skeleton } = rider.rig;
    const disposed = new Set<string>();

    for (const mesh of old) {
      mesh.geometry.addEventListener("dispose", () => {
        disposed.add(mesh.name);
      });
    }

    rider.bike.setVariant(frameSpecFor("procedural://bike/frame/aero"), DEFAULT_WHEEL_SPEC);
    expect(rider.setKit(DEFAULT_RIDER_KIT)).toBe(false);
    expect(rider.meshes()).toEqual(old);
    expect(rider.setKit(withKit({ helmet: HELMET_SPECS[1] }))).toBe(true);
    expect(disposed.size).toBe(old.length);
    expect(rider.meshes()[0]?.skeleton).toBe(skeleton);
  });

  it("stays within the rider triangle and mesh budget for the heaviest kit of every slot", () => {
    const heaviest = heaviestKit();

    expect(heaviest.triangles).toBeLessThanOrEqual(RIDER_TRIANGLES);
    expect(heaviest.meshes).toBeLessThanOrEqual(RIDER_MESHES);
  });

  it("puts glasses and the aero visor on the lens mesh only when the kit has them", () => {
    const rider = new RiderOnBike(WHEEL_CIRC_M);
    const lens = (): boolean => namesOf(rider.meshes()).includes("rider-lens");

    expect(lens()).toBe(false);
    rider.setKit(withKit({ glasses: GLASSES_SPECS[2] }));
    expect(lens()).toBe(true);
    rider.setKit(withKit({ helmet: HELMET_SPECS[1] }));
    expect(lens()).toBe(true);
  });
});
