import * as THREE from "three";

import { addCockpit } from "./bikeCockpit.js";
import { addStaticDrivetrain, buildCrankset } from "./bikeDrivetrain.js";
import { addFrame } from "./bikeFrame.js";
import { bikeGeometry, type BikeGeometry } from "./bikeGeometry.js";
import {
  bikeMeshesOf,
  createBikeMaterials,
  PartBucket,
  type BikeMaterials,
  type BikeMesh,
} from "./bikeMaterials.js";
import {
  DEFAULT_FRAME_SPEC,
  DEFAULT_WHEEL_SPEC,
  type FrameSpec,
  type WheelSpec,
} from "./bikeSpecs.js";
import { buildWheel } from "./bikeWheel.js";

export interface BikeParts {
  readonly root: THREE.Group;
  readonly frontWheel: THREE.Group;
  readonly rearWheel: THREE.Group;
  readonly crank: THREE.Group;
  readonly pedals: readonly THREE.Group[];
}

/**
 * Assembles the bike node tree of the asset contract (`bike` → `frame`, `wheel_front`,
 * `wheel_rear`, `crank` → `pedal_r`/`pedal_l`); every node holds one mesh per material.
 */
export function assembleBike(g: Readonly<BikeGeometry>, materials: BikeMaterials): BikeParts {
  const root = new THREE.Group();
  const frame = new THREE.Group();
  const bucket = new PartBucket();

  root.name = "bike";
  frame.name = "frame";
  addFrame(bucket, g);
  addCockpit(bucket, g);
  addStaticDrivetrain(bucket, g);
  bucket.build(frame, materials, "frame");

  const frontWheel = buildWheel(g, materials, true);
  const rearWheel = buildWheel(g, materials, false);
  const { crank, pedals } = buildCrankset(g, materials);

  root.add(frame, frontWheel, rearWheel, crank);

  return { root, frontWheel, rearWheel, crank, pedals };
}

/** Realistic procedural road bike with animated wheels, crank and self-levelling pedals. */
export class BikeModel {
  readonly root = new THREE.Group();
  private readonly materials = createBikeMaterials();
  private readonly materialOf: BikeMaterials = (key) => this.materials[key];
  private parts: BikeParts;
  private geometryValue: BikeGeometry;

  constructor(
    private readonly wheelCircM: number,
    frame: Readonly<FrameSpec> = DEFAULT_FRAME_SPEC,
    wheel: Readonly<WheelSpec> = DEFAULT_WHEEL_SPEC,
  ) {
    this.root.name = "bike-root";
    this.geometryValue = bikeGeometry(wheelCircM, frame, wheel);
    this.parts = assembleBike(this.geometryValue, this.materialOf);
    this.root.add(this.parts.root);
    this.setColors("#f0a83b");
  }

  get geometry(): BikeGeometry {
    return this.geometryValue;
  }

  get frontWheel(): THREE.Group {
    return this.parts.frontWheel;
  }

  get rearWheel(): THREE.Group {
    return this.parts.rearWheel;
  }

  get crank(): THREE.Group {
    return this.parts.crank;
  }

  /** All meshes of the current build, one per material and moving part. */
  meshes(): BikeMesh[] {
    const found: BikeMesh[] = [];

    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal supplies its mutable Object3D contract.
    this.parts.root.traverse((object) => {
      found.push(...bikeMeshesOf(object));
    });

    return found;
  }

  /** Rebuilds the meshes when the frame or wheel spec changes; returns whether it did. */
  setVariant(frame: Readonly<FrameSpec>, wheel: Readonly<WheelSpec>): boolean {
    const current = this.geometryValue;

    if (frame.key === current.frame.key && wheel.key === current.wheel.key) return false;

    const { root } = this.parts;
    const crankRad = -this.parts.crank.rotation.z;
    const wheelRad = -this.parts.frontWheel.rotation.z;

    for (const mesh of this.meshes()) mesh.geometry.dispose();

    this.root.remove(root);
    this.geometryValue = bikeGeometry(this.wheelCircM, frame, wheel);
    this.parts = assembleBike(this.geometryValue, this.materialOf);
    this.root.add(this.parts.root);
    this.setMotion(crankRad, wheelRad);
    this.applyFinishes();

    return true;
  }

  /** Applies the colourable paint plus the finishes that come with the current specs. */
  setColors(frameColor: string): void {
    this.materials.paint.color.set(frameColor);
    this.applyFinishes();
  }

  /** Spec-owned finishes; a variant switch applies them without touching the paint. */
  private applyFinishes(): void {
    const { frame, wheel } = this.geometryValue;

    this.materials.accent.color.setHex(frame.decalColor);
    this.materials.sidewall.color.setHex(frame.tireSidewallColor);
    this.materials.rim.color.setHex(wheel.rimColor);
    this.materials.rim.metalness = wheel.rimMetalness;
    this.materials.rim.roughness = wheel.rimRoughness;
  }

  /**
   * Crank angle φ (right pedal forward at 0) and wheel rotation, both in radians. Pedals stay
   * level unless a rider's shoes pitch them (`pedalPitchRad`, toe down positive, right then left).
   */
  setMotion(
    crankRad: number,
    wheelRad: number,
    pedalPitchRad: readonly [number, number] = [0, 0],
  ): void {
    this.parts.crank.rotation.z = -crankRad;

    for (const [index, pedal] of this.parts.pedals.entries()) {
      pedal.rotation.z = crankRad - (pedalPitchRad[index] ?? 0);
    }

    this.parts.frontWheel.rotation.z = -wheelRad;
    this.parts.rearWheel.rotation.z = -wheelRad;
  }
}
