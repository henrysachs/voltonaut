/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D and Color are mutable scene resources; these layers own the instances they write. */
import type { WorldPos } from "@voltonaut/engine";
import * as THREE from "three";

import {
  chunkedMeshes,
  groundPosition,
  seededRandom,
  type ChunkLayer,
  type ChunkItem,
} from "./biomeSceneryShared.js";
import { CARRIED, DressingGroup, STANDS } from "./dressing-group.js";
import type { LandscapePlan } from "./landscape-plan.js";

interface StreetFixture extends ChunkItem {
  readonly position: WorldPos;
  readonly rotationRad: number;
  readonly heightM: number;
  readonly kind: "lamp" | "sign";
  readonly hue: number;
}

interface StreetHead extends ChunkItem {
  readonly position: WorldPos;
  readonly rotationRad: number;
  readonly hue: number;
}

const LAMP_INTERVAL_M = 40;
const SIGN_INTERVAL_M = 90;

function streetFixtures(
  plan: Readonly<LandscapePlan>,
  random: () => number,
): readonly StreetFixture[] {
  const fixtures: StreetFixture[] = [];

  for (let distanceM = 0; distanceM < plan.route.lengthM; distanceM += LAMP_INTERVAL_M) {
    const side = (Math.floor(distanceM / LAMP_INTERVAL_M) % 2 === 0 ? 1 : -1) * 8.2;

    fixtures.push({
      routeDistanceM: distanceM,
      position: groundPosition(plan, distanceM, side),
      rotationRad: plan.route.headingRad(distanceM),
      heightM: 5.5,
      kind: "lamp",
      hue: 0,
    });
  }

  for (let distanceM = 45; distanceM < plan.route.lengthM; distanceM += SIGN_INTERVAL_M) {
    const side = (Math.floor(distanceM / SIGN_INTERVAL_M) % 2 === 0 ? -1 : 1) * 10;

    fixtures.push({
      routeDistanceM: distanceM,
      position: groundPosition(plan, distanceM, side),
      rotationRad: plan.route.headingRad(distanceM),
      heightM: 4,
      kind: "sign",
      hue: random(),
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

function headsOfKind(
  fixtures: readonly StreetFixture[],
  kind: Readonly<StreetFixture["kind"]>,
): readonly StreetHead[] {
  const heads: StreetHead[] = [];

  for (const fixture of fixtures) {
    if (fixture.kind !== kind) continue;

    heads.push({
      routeDistanceM: fixture.routeDistanceM,
      position: fixture.position,
      rotationRad: fixture.rotationRad,
      hue: fixture.hue,
    });
  }

  return heads;
}

function lampHeadLayer(heads: readonly StreetHead[]): ChunkLayer<StreetHead> {
  return {
    geometry: new THREE.BoxGeometry(0.55, 0.16, 0.24),
    material: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    items: heads,
    transform(head: Readonly<StreetHead>, object: Readonly<THREE.Object3D>) {
      object.position.set(head.position.x, head.position.y + 5.5, head.position.z);
      object.rotation.set(0, head.rotationRad, 0);
    },
    tint(head: Readonly<StreetHead>, color: Readonly<THREE.Color>) {
      color.setHSL(0.11, 0.9, 0.7 + head.hue * 0.05);
    },
  };
}

function signHeadLayer(signs: readonly StreetHead[]): ChunkLayer<StreetHead> {
  return {
    geometry: new THREE.BoxGeometry(2.1, 0.9, 0.12),
    material: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    items: signs,
    transform(sign: Readonly<StreetHead>, object: Readonly<THREE.Object3D>) {
      object.position.set(sign.position.x, sign.position.y + 3.6, sign.position.z);
      object.rotation.set(0, sign.rotationRad + 0.35, 0);
    },
    tint(sign: Readonly<StreetHead>, color: Readonly<THREE.Color>) {
      color.setHSL(sign.hue, 0.95, 0.6);
    },
  };
}

/** Night city: streetlights and neon signs glowing on dark asphalt; the glow is its atmosphere. */
export function createNightCityScenery(plan: Readonly<LandscapePlan>): DressingGroup {
  const root = new DressingGroup();
  const fixtures = streetFixtures(plan, seededRandom(23));

  root.name = "biome-night-city";
  root.place(STANDS, ...chunkedMeshes(streetPoleLayer(fixtures)));
  root.place(
    CARRIED,
    ...chunkedMeshes(lampHeadLayer(headsOfKind(fixtures, "lamp"))),
    ...chunkedMeshes(signHeadLayer(headsOfKind(fixtures, "sign"))),
  );

  return root;
}
