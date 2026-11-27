import * as THREE from "three";

import type { RiderJoints } from "./pose.js";
import { buildRiderMeshes } from "./riderBuild.js";
import { paintHelmet, paintShoe, paintSkin } from "./riderGearTexture.js";
import { paintKit } from "./riderKitTexture.js";
import { createRiderMaterials, type RiderMaterials } from "./riderMaterials.js";
import { cssRgb } from "./riderPaint.js";
import { RiderRig } from "./riderRig.js";
import type { RiderMesh } from "./riderSkin.js";
import { DEFAULT_RIDER_KIT, sameKit, type RiderKit } from "./riderSpecs.js";

/** Smoked visor tint when the kit has no glasses of its own. */
const HELMET_VISOR = { color: 0x22303a, opacity: 0.7, metalness: 0.5 } as const;

/** Rider colours from the avatar config. */
export interface RiderColors {
  readonly jerseyColors: readonly [string, string];
  readonly skinTone: string;
  readonly helmetColor: string;
}

/** The colours of the default avatar config. */
export const DEFAULT_RIDER_COLORS: RiderColors = {
  jerseyColors: ["#ec6b48", "#f5ebca"],
  skinTone: "#c98d68",
  helmetColor: "#f5ebca",
};

/** Swaps a painted map and frees the previous texture. */
function replaceMap(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Updates the rider's own material.
  material: THREE.MeshStandardMaterial,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The material takes ownership of the new texture.
  map: THREE.Texture,
): void {
  material.map?.dispose();
  material.map = map;
  material.needsUpdate = true;
}

/**
 * The rider's body: a 22-bone skeleton, one skinned mesh per material for the current kit and
 * the painted textures. Geometry is built once per kit in the bind pose; posing only moves bones.
 */
export class RiderBody {
  readonly root = new THREE.Group();
  readonly rig: RiderRig;
  private readonly materials = createRiderMaterials();
  private readonly materialOf: RiderMaterials = (key) => this.materials[key];
  private kit: RiderKit;
  private meshesValue: RiderMesh[];
  private jerseyColors: readonly [string, string];
  private skinTone: string;

  /** Builds the body directly in `kit` and `colors`, so a first look costs one build. */
  constructor(
    private readonly bind: Readonly<RiderJoints>,
    kit: Readonly<RiderKit> = DEFAULT_RIDER_KIT,
    colors: Readonly<RiderColors> = DEFAULT_RIDER_COLORS,
  ) {
    this.root.name = "rider";
    this.kit = kit;
    this.jerseyColors = colors.jerseyColors;
    this.skinTone = colors.skinTone;
    this.rig = new RiderRig(bind);
    this.meshesValue = buildRiderMeshes(bind, this.rig, this.kit, this.materialOf);
    this.root.add(this.rig.root, ...this.meshesValue);
    this.paintKit();
    this.paintGear();
    replaceMap(this.materials.skin, paintSkin(this.skinTone));
    this.materials.helmet.color.set(colors.helmetColor);
  }

  /** Skinned rider meshes of the current kit, one per material. */
  meshes(): readonly RiderMesh[] {
    return this.meshesValue;
  }

  pose(joints: Readonly<RiderJoints>): void {
    this.rig.pose(joints);
  }

  /** Rebuilds the meshes and gear textures for a new kit; returns whether it did. */
  setKit(kit: Readonly<RiderKit>): boolean {
    if (sameKit(kit, this.kit)) return false;

    for (const mesh of this.meshesValue) {
      mesh.geometry.dispose();
      this.root.remove(mesh);
    }

    this.kit = kit;
    this.meshesValue = buildRiderMeshes(this.bind, this.rig, kit, this.materialOf);
    this.root.add(...this.meshesValue);
    this.paintKit();
    this.paintGear();

    return true;
  }

  /** Repaints only the textures whose colours changed. */
  setColors(colors: Readonly<RiderColors>): void {
    const [primary, accent] = colors.jerseyColors;

    if (primary !== this.jerseyColors[0] || accent !== this.jerseyColors[1]) {
      this.jerseyColors = [primary, accent];
      this.paintKit();
    }

    if (colors.skinTone !== this.skinTone) {
      this.skinTone = colors.skinTone;
      replaceMap(this.materials.skin, paintSkin(colors.skinTone));
    }

    this.materials.helmet.color.set(colors.helmetColor);
  }

  private paintKit(): void {
    const [primary, accent] = this.jerseyColors;

    replaceMap(
      this.materials.kit,
      paintKit(this.kit.jersey, { primary: cssRgb(primary), accent: cssRgb(accent) }),
    );
  }

  /** Spec-owned textures and finishes of jersey fabric, helmet, shoes and lenses. */
  private paintGear(): void {
    const m = this.materials;
    const { jersey, helmet, shoes, glasses } = this.kit;
    const lens = glasses.lens ?? HELMET_VISOR;

    replaceMap(m.helmet, paintHelmet(helmet));
    replaceMap(m.shoe, paintShoe(shoes));
    m.kit.roughness = 0.35 + jersey.accentRoughness * 0.5;
    m.helmet.roughness = helmet.shellRoughness;
    m.shoe.roughness = shoes.upperRoughness;
    m.lens.color.setHex(lens.color);
    m.lens.opacity = lens.opacity;
    m.lens.metalness = lens.metalness;
  }

  /** Frees skeleton, painted maps and materials no mesh uses; meshes go with the scene graph. */
  dispose(): void {
    const used = new Set<THREE.Material>();

    for (const mesh of this.meshesValue) used.add(mesh.material);

    this.rig.dispose();

    for (const material of Object.values(this.materials)) {
      material.map?.dispose();

      if (!used.has(material)) material.dispose();
    }
  }
}
