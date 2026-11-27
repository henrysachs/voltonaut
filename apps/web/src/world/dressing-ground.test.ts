/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's scene graph objects are mutable by contract; these probes build and read them. */
import { createRoute, TEST_LOOP, WORLDS } from "@voltonaut/engine";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { DressingGroup, STANDS, WATER } from "./dressing-group.js";
import { heightAt } from "./heightfield.js";
import { createLandscapePlan } from "./landscape-plan.js";
import { createLake } from "./lake.js";
import {
  FLOAT_TOLERANCE_M,
  groundReport,
  worldReport,
  type GroundReport,
} from "./testdata/groundReport.js";

/** Count and first offenders: a full list of thousands would drown the failure message. */
interface Offenders {
  readonly count: number;
  readonly first: readonly string[];
}

function offenders(found: readonly string[]): Offenders {
  return { count: found.length, first: found.slice(0, 5) };
}

const none: Offenders = { count: 0, first: [] };

describe.each(WORLDS.map((world) => [world.id, world] as const))(
  "dressing of world %s on its drawn terrain",
  (_id, world) => {
    it("places every drawable with a footing and brings no light", () => {
      const report = worldReport(world);

      expect(report.standing).toBeGreaterThan(0);
      expect(report.unplaced).toEqual([]);
      expect(report.lights).toEqual([]);
    });

    it(`rests every standing base on the terrain within ${FLOAT_TOLERANCE_M} m`, () => {
      expect(offenders(worldReport(world).floating)).toEqual(none);
    });

    it("buries no standing part past its own midpoint", () => {
      expect(offenders(worldReport(world).swallowed)).toEqual(none);
    });

    it("stands nothing in a lake or the sea", () => {
      expect(offenders(worldReport(world).wet)).toEqual(none);
    });
  },
);

const probePlan = createLandscapePlan(createRoute(TEST_LOOP));
const probeGround = TEST_LOOP.centerline[0] ?? { x: 0, z: 0 };

/** A 2 m post whose base sits `liftM` above the drawn terrain at (x, z). */
function post(liftM: number, x = probeGround.x, z = probeGround.z): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 0.2));

  mesh.position.set(x, heightAt(probePlan.terrain, x, z) + 1 + liftM, z);

  return mesh;
}

/** One standing post beside the test loop lake, as the invariant reports it. */
function postReport(mesh: THREE.Mesh): GroundReport {
  const group = new DressingGroup();

  group.place(STANDS, mesh);
  group.add(createLake(probePlan));

  return groundReport([group], probePlan.terrain);
}

describe("the ground invariant itself", () => {
  it("accepts a post on the ground and flags one 6 cm above it", () => {
    expect(postReport(post(0)).floating).toEqual([]);
    expect(postReport(post(0.06)).floating).toHaveLength(1);
  });

  it("flags a post buried past its midpoint", () => {
    expect(postReport(post(-1.1)).swallowed).toHaveLength(1);
  });

  it("flags a post in the lake and none on the dry start straight", () => {
    const { center, waterYM } = probePlan.lake;

    expect(waterYM).toBeGreaterThan(heightAt(probePlan.terrain, center.x, center.z));
    expect(heightAt(probePlan.terrain, probeGround.x, probeGround.z)).toBeGreaterThan(waterYM);
    expect(postReport(post(0, center.x, center.z)).wet).toHaveLength(1);
    expect(postReport(post(0)).wet).toEqual([]);
  });

  it("exempts water and reports what bypassed its footing, lights included", () => {
    const group = new DressingGroup();

    group.place(WATER, post(5));
    THREE.Group.prototype.add.call(group, new THREE.Mesh(), new THREE.AmbientLight());

    const report = groundReport([group], probePlan.terrain);

    expect(report.floating).toEqual([]);
    expect(report.unplaced).toEqual(["/Mesh[1]", "/AmbientLight[2]"]);
    expect(report.lights).toEqual(["/AmbientLight"]);
  });
});
