/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D and Color are mutable scene resources; these layers own the instances they write. */
import * as THREE from "three";

import { chunkedMeshes, type ChunkItem, type ChunkLayer } from "./biomeSceneryShared.js";
import { CARRIED, STANDS, type DressingGroup } from "./dressing-group.js";
import { partsOf, type Part, type Placed, type Volcano } from "./stone-age-plan.js";

export function stone(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
}

/** Unlit and unfogged, so lava glows through the haze without a light source. */
function glow(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, fog: false });
}

/** Moves the object onto the item, turns it by the item's yaw and offsets it in that frame. */
export function atItem(
  object: THREE.Object3D,
  item: Readonly<Placed>,
  offset: readonly [number, number, number],
): void {
  object.position.set(item.position.x, item.position.y, item.position.z);
  object.rotation.set(0, item.rotationRad, 0);
  object.scale.set(1, 1, 1);
  object.translateX(offset[0] * item.scale);
  object.translateY(offset[1] * item.scale);
  object.translateZ(offset[2] * item.scale);
}

/** One pose of a statue part in the statue frame at scale 1: snout towards +X, feet at y 0. */
interface StatuePose {
  readonly offset: readonly [number, number, number];
  /** Roll about local Z; negative leans local +Y towards the snout. */
  readonly rollRad: number;
  readonly size: readonly [number, number, number];
}

interface StatuePart {
  readonly name: string;
  readonly geometry: () => THREE.BufferGeometry;
  readonly poses: readonly StatuePose[];
}

const LEG_SIZE = [1, 1, 1] as const;

/** A long-necked dino statue built from five primitive parts. */
const DINO_PARTS: readonly StatuePart[] = [
  {
    name: "body",
    geometry: () => new THREE.SphereGeometry(1, 10, 7),
    poses: [{ offset: [0, 2.6, 0], rollRad: 0, size: [2.4, 1.3, 1.1] }],
  },
  {
    name: "neck",
    geometry: () => new THREE.CylinderGeometry(0.3, 0.55, 4, 7),
    poses: [{ offset: [3.15, 4.64, 0], rollRad: -0.61, size: [1, 1, 1] }],
  },
  {
    name: "head",
    geometry: () => new THREE.SphereGeometry(1, 8, 6),
    poses: [{ offset: [4.6, 6.4, 0], rollRad: -0.3, size: [0.8, 0.5, 0.5] }],
  },
  {
    name: "tail",
    geometry: () => new THREE.ConeGeometry(0.5, 5, 7),
    poses: [{ offset: [-4.66, 2.17, 0], rollRad: 1.745, size: [1, 1, 1] }],
  },
  {
    name: "legs",
    geometry: () => new THREE.CylinderGeometry(0.35, 0.4, 2.1, 6),
    poses: [
      { offset: [1.3, 1.05, 0.6], rollRad: 0, size: LEG_SIZE },
      { offset: [1.3, 1.05, -0.6], rollRad: 0, size: LEG_SIZE },
      { offset: [-1.3, 1.05, 0.6], rollRad: 0, size: LEG_SIZE },
      { offset: [-1.3, 1.05, -0.6], rollRad: 0, size: LEG_SIZE },
    ],
  },
];

/** One part of one statue in its pose. */
interface StatuePiece extends ChunkItem {
  readonly statue: Readonly<Placed>;
  readonly pose: Readonly<StatuePose>;
}

function statuePartLayer(
  statues: readonly Placed[],
  part: Readonly<StatuePart>,
): ChunkLayer<StatuePiece> {
  return {
    geometry: part.geometry(),
    material: stone(),
    items: statues.flatMap((statue) =>
      part.poses.map((pose) => ({ routeDistanceM: statue.routeDistanceM, statue, pose })),
    ),
    transform({ statue, pose }: Readonly<StatuePiece>, object: THREE.Object3D) {
      atItem(object, statue, pose.offset);
      object.rotateZ(pose.rollRad);
      object.scale.set(
        pose.size[0] * statue.scale,
        pose.size[1] * statue.scale,
        pose.size[2] * statue.scale,
      );
    },
    tint({ statue }: Readonly<StatuePiece>, color: THREE.Color) {
      color.setHSL(0.17, 0.08, 0.42 + statue.shade * 0.14);
    },
  };
}

/** Rim radius of the truncated cone relative to its base radius. */
const CRATER_RIM = 0.16;

function volcanoConeLayer(fire: readonly Volcano[]): ChunkLayer<Volcano> {
  return {
    geometry: new THREE.CylinderGeometry(CRATER_RIM, 1, 1, 24, 1, true),
    material: stone(),
    items: fire,
    transform(volcano: Readonly<Volcano>, object: THREE.Object3D) {
      atItem(object, volcano, [0, volcano.heightM / 2, 0]);
      object.scale.set(volcano.baseRadiusM, volcano.heightM, volcano.baseRadiusM);
    },
    tint(volcano: Readonly<Volcano>, color: THREE.Color) {
      color.setHSL(0.04, 0.12, 0.2 + volcano.shade * 0.06);
    },
  };
}

/** A glowing lava dome that rises just above the rim, so riders see it from below. */
function craterGlowLayer(fire: readonly Volcano[]): ChunkLayer<Volcano> {
  return {
    geometry: new THREE.SphereGeometry(1, 16, 8),
    material: glow(0xff7a1c),
    items: fire,
    transform(volcano: Readonly<Volcano>, object: THREE.Object3D) {
      atItem(object, volcano, [0, volcano.heightM * 0.97, 0]);
      object.scale.set(
        volcano.baseRadiusM * CRATER_RIM * 0.95,
        volcano.heightM * 0.07,
        volcano.baseRadiusM * CRATER_RIM * 0.95,
      );
    },
    tint(_volcano: Readonly<Volcano>, color: THREE.Color) {
      color.setHex(0xffffff);
    },
  };
}

const LAVA_STREAMS = 4;

/** Lava streams lie on the flank from the rim down, lifted slightly off the cone surface. */
function lavaStreamLayer(fire: readonly Volcano[]): ChunkLayer<Part<Volcano>> {
  return {
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: glow(0xff4a12),
    items: partsOf(fire, LAVA_STREAMS),
    transform(stream: Readonly<Part<Volcano>>, object: THREE.Object3D) {
      const volcano = stream.owner;
      const runM = volcano.baseRadiusM * (1 - CRATER_RIM);
      const slopeRad = Math.atan2(volcano.heightM, runM);
      const lengthM = Math.hypot(runM, volcano.heightM) * (0.35 + 0.1 * stream.index);
      const midM = lengthM / 2;

      atItem(object, volcano, [0, 0, 0]);
      object.rotateY((stream.index / LAVA_STREAMS) * Math.PI * 2 + 0.4);
      object.translateZ(volcano.baseRadiusM * CRATER_RIM + midM * Math.cos(slopeRad) + 0.6);
      object.translateY(volcano.heightM - midM * Math.sin(slopeRad) + 0.6);
      object.rotateX(slopeRad - Math.PI / 2);
      object.scale.set(volcano.baseRadiusM * 0.05, lengthM, 1.2);
    },
    tint(_stream: Readonly<Part<Volcano>>, color: THREE.Color) {
      color.setHex(0xffffff);
    },
  };
}

export function named(
  meshes: readonly THREE.InstancedMesh[],
  name: string,
): readonly THREE.InstancedMesh[] {
  for (const mesh of meshes) mesh.name = name;

  return meshes;
}

/** Volcano meshes span the valley; their shadow would cost a draw call and show nothing. */
function withoutShadow(meshes: readonly THREE.InstancedMesh[]): readonly THREE.InstancedMesh[] {
  for (const mesh of meshes) mesh.castShadow = false;

  return meshes;
}

/** The cone stands on the valley floor and carries its crater glow and lava streams. */
export function placeVolcanoes(root: DressingGroup, fire: readonly Volcano[], lapM: number): void {
  root.place(
    STANDS,
    ...named(withoutShadow(chunkedMeshes(volcanoConeLayer(fire), lapM)), "stone-age-volcano"),
  );
  root.place(
    CARRIED,
    ...named(withoutShadow(chunkedMeshes(craterGlowLayer(fire), lapM)), "stone-age-crater"),
    ...named(withoutShadow(chunkedMeshes(lavaStreamLayer(fire), lapM)), "stone-age-lava"),
  );
}

/** A statue stands on its legs; body, neck, head and tail are carried by them. */
export function placeStatues(root: DressingGroup, statues: readonly Placed[], lapM: number): void {
  for (const part of DINO_PARTS) {
    root.place(
      part.name === "legs" ? STANDS : CARRIED,
      ...named(chunkedMeshes(statuePartLayer(statues, part), lapM), `stone-age-dino-${part.name}`),
    );
  }
}
