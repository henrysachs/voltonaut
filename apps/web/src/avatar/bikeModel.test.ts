import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { BikeModel } from "./bikeModel.js";
import { FRAME_SPECS, frameSpecFor, WHEEL_SPECS, wheelSpecFor } from "./bikeSpecs.js";

function triangles(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The bike owns mutable Three meshes that are only inspected here.
  bike: Readonly<BikeModel>,
): number {
  let count = 0;

  for (const mesh of bike.meshes()) count += mesh.geometry.getAttribute("position").count / 3;

  return count;
}

function material(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The bike owns mutable Three meshes that are only inspected here.
  bike: Readonly<BikeModel>,
  name: string,
): THREE.MeshStandardMaterial {
  let found: THREE.MeshStandardMaterial | undefined;

  for (const mesh of bike.meshes()) if (mesh.name === name) found = mesh.material;

  if (found === undefined) throw new Error(`Missing bike mesh ${name}`);

  return found;
}

describe("procedural road bike structure", () => {
  it("exposes the animated nodes of the bike asset contract", () => {
    const bike = new BikeModel(2.105);

    for (const name of [
      "bike",
      "frame",
      "wheel_front",
      "wheel_rear",
      "crank",
      "pedal_l",
      "pedal_r",
    ]) {
      expect(bike.root.getObjectByName(name)).toBeInstanceOf(THREE.Group);
    }

    expect(bike.root.getObjectByName("pedal_l")?.parent?.name).toBe("crank");
  });

  it("keeps every frame and wheel combination within the triangle and mesh budget", () => {
    for (const frame of FRAME_SPECS) {
      for (const wheel of WHEEL_SPECS) {
        const bike = new BikeModel(2.105, frame, wheel);

        expect(triangles(bike)).toBeLessThanOrEqual(32_000);
        expect(bike.meshes().length).toBeLessThanOrEqual(26);
      }
    }
  });
});

describe("procedural road bike motion", () => {
  it("turns wheels and crank while the pedals stay level", () => {
    const bike = new BikeModel(2.105);
    const pedal = bike.root.getObjectByName("pedal_r");

    bike.setMotion(1.3, 4);
    bike.root.updateMatrixWorld(true);

    const rotation = new THREE.Quaternion();

    pedal?.getWorldQuaternion(rotation);
    expect(pedal).toBeDefined();
    expect(bike.crank.rotation.z).toBeCloseTo(-1.3);
    expect(bike.frontWheel.rotation.z).toBeCloseTo(-4);
    expect(bike.rearWheel.rotation.z).toBeCloseTo(-4);
    expect(new THREE.Euler().setFromQuaternion(rotation).z).toBeCloseTo(0);
  });
});

describe("procedural road bike customisation", () => {
  it("rebuilds only on a variant change, frees the old geometry and keeps the motion", () => {
    const bike = new BikeModel(2.105);
    const old = bike.meshes();
    let disposals = 0;

    const onDispose = (): void => {
      disposals += 1;
    };

    for (const mesh of old) mesh.geometry.addEventListener("dispose", onDispose);

    bike.setMotion(0.7, 2);
    expect(bike.setVariant(bike.geometry.frame, bike.geometry.wheel)).toBe(false);
    expect(
      bike.setVariant(
        frameSpecFor("procedural://bike/frame/aero"),
        wheelSpecFor("procedural://bike/wheels/disc"),
      ),
    ).toBe(true);
    expect(disposals).toBe(old.length);
    expect(bike.geometry.frame.key).toBe("aero");
    expect(bike.crank.rotation.z).toBeCloseTo(-0.7);
  });

  it("applies the frame colour and the finishes of the selected specs", () => {
    const bike = new BikeModel(
      2.105,
      frameSpecFor("procedural://bike/frame/gravel"),
      wheelSpecFor("procedural://bike/wheels/carbon-flat"),
    );

    bike.setColors("#336699");

    expect(material(bike, "frame-paint").color.getHexString()).toBe("336699");
    expect(material(bike, "wheel_front-sidewall").color.getHex()).toBe(0x8a5a32);
    expect(material(bike, "wheel_front-rim").roughness).toBe(0.42);
  });
});
