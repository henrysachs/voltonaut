/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D and Color are mutable scene resources; these layers own the instances they write. */
import type { WorldPos } from "@voltonaut/engine";
import * as THREE from "three";

import {
  chunkedMeshes,
  groundPosition,
  seededRandom,
  type ChunkItem,
  type ChunkLayer,
} from "./biomeSceneryShared.js";
import { CARRIED, DressingGroup, ROAD, STANDS } from "./dressing-group.js";
import type { LandscapePlan } from "./landscape-plan.js";
import {
  buildingLayer,
  NEON,
  NEON_HUES,
  planBuildings,
  type NeonTubeItem,
} from "./nightCityBuildings.js";
import { createLampLight, neonLayer, type NeonItem, type StreetLamp } from "./nightCityLights.js";

export { nightLightsOf } from "./nightCityLights.js";

interface StreetFixture extends ChunkItem {
  readonly position: WorldPos;
  readonly rotationRad: number;
  readonly heightM: number;
  readonly kind: "lamp" | "sign";
  readonly side: 1 | -1;
  readonly hue: number;
}

const LAMP_INTERVAL_M = 40;
const SIGN_INTERVAL_M = 90;
const LAMP_LATERAL_M = 8.2;
const SIGN_LATERAL_M = 10;
const LAMP_HEIGHT_M = 5.5;
const SIGN_HEIGHT_M = 4;

function streetFixtures(
  plan: Readonly<LandscapePlan>,
  random: () => number,
): readonly StreetFixture[] {
  const fixtures: StreetFixture[] = [];

  for (let distanceM = 0; distanceM < plan.route.lengthM; distanceM += LAMP_INTERVAL_M) {
    const side: 1 | -1 = Math.floor(distanceM / LAMP_INTERVAL_M) % 2 === 0 ? 1 : -1;

    fixtures.push({
      routeDistanceM: distanceM,
      position: groundPosition(plan, distanceM, side * LAMP_LATERAL_M),
      rotationRad: -plan.route.headingRad(distanceM),
      heightM: LAMP_HEIGHT_M,
      kind: "lamp",
      side,
      hue: NEON.amber,
    });
  }

  for (let distanceM = 45; distanceM < plan.route.lengthM; distanceM += SIGN_INTERVAL_M) {
    const side: 1 | -1 = Math.floor(distanceM / SIGN_INTERVAL_M) % 2 === 0 ? -1 : 1;

    fixtures.push({
      routeDistanceM: distanceM,
      position: groundPosition(plan, distanceM, side * SIGN_LATERAL_M),
      rotationRad: -plan.route.headingRad(distanceM),
      heightM: SIGN_HEIGHT_M,
      kind: "sign",
      side,
      hue: NEON_HUES[Math.floor(random() * NEON_HUES.length) % NEON_HUES.length] ?? NEON.amber,
    });
  }

  return fixtures;
}

function streetPoleLayer(fixtures: readonly StreetFixture[]): ChunkLayer<StreetFixture> {
  return {
    geometry: new THREE.CylinderGeometry(0.09, 0.11, 1, 6),
    material: new THREE.MeshStandardMaterial({ color: 0x30343b, roughness: 0.9 }),
    items: fixtures,
    transform(fixture: Readonly<StreetFixture>, object: Readonly<THREE.Object3D>) {
      object.position.set(
        fixture.position.x,
        fixture.position.y + fixture.heightM / 2,
        fixture.position.z,
      );
      object.rotation.set(0, fixture.rotationRad, 0);
      object.scale.set(1, fixture.heightM, 1);
    },
    tint(fixture: Readonly<StreetFixture>, color: Readonly<THREE.Color>) {
      color.setHex(0xffffff);

      if (fixture.kind === "sign") color.setHSL(fixture.hue, 0.1, 0.95);
    },
  };
}

function fixtureNeon(fixture: Readonly<StreetFixture>): NeonItem {
  const lamp = fixture.kind === "lamp";
  const { position } = fixture;

  return {
    routeDistanceM: fixture.routeDistanceM,
    position: {
      x: position.x,
      y: position.y + fixture.heightM - (lamp ? 0 : 0.4),
      z: position.z,
    },
    rotationRad: fixture.rotationRad + (lamp ? 0 : 0.35),
    sizeM: lamp ? { x: 0.55, y: 0.16, z: 0.24 } : { x: 2.1, y: 0.9, z: 0.12 },
    hue: fixture.hue,
    saturation: lamp ? 0.9 : 1,
    luminance: lamp ? 1.5 : 1.3,
  };
}

function tubeNeon(tube: Readonly<NeonTubeItem>): NeonItem {
  return {
    routeDistanceM: tube.routeDistanceM,
    position: {
      x: tube.position.x,
      y: tube.position.y + 3 + tube.heightM / 2,
      z: tube.position.z,
    },
    rotationRad: 0,
    sizeM: { x: 0.45, y: tube.heightM, z: 0.45 },
    hue: tube.hue,
    saturation: 1,
    luminance: 1.4,
  };
}

function streetLamps(fixtures: readonly StreetFixture[]): readonly StreetLamp[] {
  return fixtures.flatMap((fixture) =>
    fixture.kind === "lamp" ? [{ routeDistanceM: fixture.routeDistanceM, side: fixture.side }] : [],
  );
}

/**
 * Night city: lit towers, neon and lamp light on the asphalt; bloom.ts makes the neon glow at
 * night, and the blue glow is its atmosphere (biome-atmosphere.ts).
 */
export function createNightCityScenery(plan: Readonly<LandscapePlan>): DressingGroup {
  const root = new DressingGroup();
  const fixtures = streetFixtures(plan, seededRandom(23));
  const random = seededRandom(151);
  const { buildings, tubes } = planBuildings(plan, random);

  root.name = "biome-night-city";
  root.place(STANDS, ...chunkedMeshes(buildingLayer(buildings, random)));
  root.place(STANDS, ...chunkedMeshes(streetPoleLayer(fixtures)));
  root.place(
    CARRIED,
    ...chunkedMeshes(
      neonLayer([
        ...fixtures.map((fixture) => fixtureNeon(fixture)),
        ...tubes.map((tube) => tubeNeon(tube)),
      ]),
    ),
  );
  root.place(ROAD, createLampLight(plan.route, streetLamps(fixtures)));

  return root;
}
