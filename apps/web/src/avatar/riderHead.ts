import { addFace } from "./riderFace.js";
import { addGlasses } from "./riderGlasses.js";
import { addHelmet } from "./riderHelmet.js";
import { boneMatrix, type BoneSegments } from "./riderRig.js";
import type { SkinBucket } from "./riderSkin.js";
import type { GlassesSpec, HelmetSpec } from "./riderSpecs.js";

/**
 * Head with sculpted face, helmet with sunk vents and straps, and the optional glasses. Parts
 * are built in head space (see `riderFace.ts`) and moved onto the bind pose of the head bone.
 */
export function addHead(
  bucket: Readonly<SkinBucket>,
  bind: BoneSegments,
  helmet: Readonly<HelmetSpec>,
  glasses: Readonly<GlassesSpec>,
): void {
  const head = boneMatrix(bind.Head);

  addFace(bucket, head);
  addHelmet(bucket, helmet, head);
  addGlasses(bucket, glasses, head);
}
