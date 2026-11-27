/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D and Color are mutable scene resources; these layers own the instances they write. */
import * as THREE from "three";

import { chunkedMeshes, type ChunkLayer } from "./biomeSceneryShared.js";
import { CARRIED, DressingGroup, STANDS } from "./dressing-group.js";
import type { LandscapePlan } from "./landscape-plan.js";
import { partsOf, planStoneAge, type Part, type Placed, type RockHouse } from "./stone-age-plan.js";
import { atItem, named, placeStatues, placeVolcanoes, stone } from "./stoneAgeLandmarks.js";

function houseDomeLayer(houses: readonly RockHouse[]): ChunkLayer<RockHouse> {
  return {
    geometry: new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    material: stone(),
    items: houses,
    transform(house: Readonly<RockHouse>, object: THREE.Object3D) {
      atItem(object, house, [0, -0.3, 0]);
      object.scale.set(house.domeRadiusM, house.heightM, house.domeRadiusM);
    },
    tint(house: Readonly<RockHouse>, color: THREE.Color) {
      color.setHSL(0.08, 0.2, 0.42 + house.shade * 0.14);
    },
  };
}

const ENTRANCE_RADIUS_M = 1.25;

/** How far the entrance tunnel reaches out of the dome rim towards the road. */
const ENTRANCE_REACH_M = 0.5;

/** Share of the dome radius where the tunnel starts; the dome is still taller than the arch there. */
const ENTRANCE_START = 0.6;

function entranceLengthM(house: Readonly<RockHouse>): number {
  return house.domeRadiusM * (1 - ENTRANCE_START) + ENTRANCE_REACH_M;
}

/**
 * Half-cylinder entrance tunnel that comes out of the dome, like the porch of an igloo. An upright
 * door box at the rim stood up to 1.5 m above the low dome edge and read as a black slab.
 */
function houseEntranceLayer(houses: readonly RockHouse[]): ChunkLayer<RockHouse> {
  return {
    // Upper half around the local Z axis, flat side on the ground.
    geometry: new THREE.CylinderGeometry(1, 1, 1, 10, 1, false, -Math.PI / 2, Math.PI).rotateX(
      -Math.PI / 2,
    ),
    material: stone(),
    items: houses,
    transform(house: Readonly<RockHouse>, object: THREE.Object3D) {
      const lengthM = entranceLengthM(house);

      atItem(object, house, [0, -0.1, house.domeRadiusM * ENTRANCE_START + lengthM / 2]);
      object.scale.set(ENTRANCE_RADIUS_M, ENTRANCE_RADIUS_M, lengthM);
    },
    tint(house: Readonly<RockHouse>, color: THREE.Color) {
      color.setHSL(0.08, 0.2, 0.36 + house.shade * 0.14);
    },
  };
}

/** Dark doorway on the tunnel mouth; its corners stay inside the arch. */
function houseDoorLayer(houses: readonly RockHouse[]): ChunkLayer<RockHouse> {
  return {
    geometry: new THREE.BoxGeometry(1.2, 1, 0.08),
    material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    items: houses,
    transform(house: Readonly<RockHouse>, object: THREE.Object3D) {
      const mouthM = house.domeRadiusM * ENTRANCE_START + entranceLengthM(house);

      atItem(object, house, [0, 0.4, mouthM + 0.02]);
    },
    tint(_house: Readonly<RockHouse>, color: THREE.Color) {
      color.setHex(0x24180f);
    },
  };
}

function palmHeightM(palm: Readonly<Placed>): number {
  return 4.5 + palm.shade * 4;
}

function palmTrunkLayer(palms: readonly Placed[]): ChunkLayer<Placed> {
  return {
    geometry: new THREE.CylinderGeometry(0.28, 0.45, 1, 6),
    material: stone(),
    items: palms,
    transform(palm: Readonly<Placed>, object: THREE.Object3D) {
      atItem(object, palm, [0, palmHeightM(palm) / 2 / palm.scale, 0]);
      object.scale.set(palm.scale, palmHeightM(palm), palm.scale);
    },
    tint(palm: Readonly<Placed>, color: THREE.Color) {
      color.setHSL(0.08, 0.38, 0.28 + palm.shade * 0.1);
    },
  };
}

interface FrondStyle {
  readonly count: number;
  readonly lengthM: number;
  /** Lean from vertical; beyond π/2 the frond droops. */
  readonly tiltRad: number;
  readonly hue: number;
  readonly stemTopM: (owner: Readonly<Placed>) => number;
}

const PALM_FRONDS: FrondStyle = {
  count: 7,
  lengthM: 3.4,
  tiltRad: 1.95,
  hue: 0.27,
  stemTopM: (palm) => palmHeightM(palm) - 0.2,
};

/** Base radius of a frond cone as a share of its length. */
const FROND_BASE_SHARE = 0.16;

const FERN_LENGTH_M = 1.9;
const FERN_TILT_RAD = 0.7;

/**
 * Fern fronds rise from the ground. A tilted cone lifts one side of its base rim by
 * base radius · sin(tilt), so the stem sinks by that much and no rim corner floats. Flatter fronds
 * than 0.7 rad lie so low that the slope above them reaches their middle.
 */
const FERN_FRONDS: FrondStyle = {
  count: 6,
  lengthM: FERN_LENGTH_M,
  tiltRad: FERN_TILT_RAD,
  hue: 0.3,
  stemTopM: (fern) => -FERN_LENGTH_M * FROND_BASE_SHARE * Math.sin(FERN_TILT_RAD) * fern.scale,
};

/** Each frond starts at the stem top and leans out; fronds fan evenly around the stem. */
function frondLayer(owners: readonly Placed[], style: FrondStyle): ChunkLayer<Part<Placed>> {
  return {
    geometry: new THREE.ConeGeometry(style.lengthM * FROND_BASE_SHARE, style.lengthM, 4),
    material: stone(),
    items: partsOf(owners, style.count),
    transform(frond: Readonly<Part<Placed>>, object: THREE.Object3D) {
      const { owner } = frond;

      atItem(object, owner, [0, style.stemTopM(owner) / owner.scale, 0]);
      object.rotateY((frond.index / style.count) * Math.PI * 2);
      object.rotateX(style.tiltRad);
      object.translateY((style.lengthM * owner.scale) / 2);
      object.scale.set(owner.scale, owner.scale, owner.scale);
    },
    tint(frond: Readonly<Part<Placed>>, color: THREE.Color) {
      color.setHSL(style.hue + frond.owner.shade * 0.04, 0.5, 0.22 + frond.owner.shade * 0.14);
    },
  };
}

function boulderLayer(boulders: readonly Placed[]): ChunkLayer<Placed> {
  return {
    geometry: new THREE.IcosahedronGeometry(1, 0),
    material: stone(),
    items: boulders,
    transform(boulder: Readonly<Placed>, object: THREE.Object3D) {
      atItem(object, boulder, [0, boulder.radiusM * 0.25, 0]);
      object.scale.set(boulder.radiusM, boulder.radiusM * 0.7, boulder.radiusM * 0.85);
    },
    tint(boulder: Readonly<Placed>, color: THREE.Color) {
      color.setHSL(0.08, 0.3, 0.42 + boulder.shade * 0.2);
    },
  };
}

const PLANT_CHUNK_M = 500;

/**
 * Stone age (spec E10-16): rock houses with entrance tunnels and dark doors, palms, ferns and
 * boulders, long-necked dino statues and glowing volcanoes. Houses, statues and volcanoes are few,
 * so each layer is one mesh over the whole lap. Plants use 500 m chunks: with four plant layers,
 * 250 m chunks took the Steinbruch view to 140 of the 150 draw calls (spec E10-16 AK6).
 */
export function createStoneAgeScenery(plan: Readonly<LandscapePlan>): DressingGroup {
  const root = new DressingGroup();
  const decor = planStoneAge(plan);
  const lapM = plan.route.lengthM;

  root.name = "biome-stone-age";
  placeVolcanoes(root, decor.volcanoes, lapM);
  root.place(
    STANDS,
    ...named(chunkedMeshes(houseDomeLayer(decor.houses), lapM), "stone-age-house"),
  );
  // The dome carries its tunnel. Settling keeps the tunnel floor on the ground at its mouth; on a
  // slope its uphill side runs into the hill like a cellar entrance.
  root.place(
    CARRIED,
    ...named(chunkedMeshes(houseEntranceLayer(decor.houses), lapM), "stone-age-entrance"),
    ...named(chunkedMeshes(houseDoorLayer(decor.houses), lapM), "stone-age-door"),
  );
  placeStatues(root, decor.statues, lapM);
  root.place(
    STANDS,
    ...named(chunkedMeshes(palmTrunkLayer(decor.palms), PLANT_CHUNK_M), "stone-age-palm"),
    ...named(chunkedMeshes(frondLayer(decor.ferns, FERN_FRONDS), PLANT_CHUNK_M), "stone-age-fern"),
    ...named(chunkedMeshes(boulderLayer(decor.boulders), PLANT_CHUNK_M), "stone-age-boulder"),
  );
  root.place(
    CARRIED,
    ...named(
      chunkedMeshes(frondLayer(decor.palms, PALM_FRONDS), PLANT_CHUNK_M),
      "stone-age-palm-frond",
    ),
  );

  return root;
}
