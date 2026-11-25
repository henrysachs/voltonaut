import type { RiderJoints } from "./pose.js";
import { addHead } from "./riderHead.js";
import { addLimbs } from "./riderLimbs.js";
import type { RiderMaterials } from "./riderMaterials.js";
import type { RiderRig } from "./riderRig.js";
import { addShoes } from "./riderShoes.js";
import { SkinBucket, type RiderMesh } from "./riderSkin.js";
import type { RiderKit } from "./riderSpecs.js";
import { addTorso } from "./riderTorso.js";

/** Builds the skinned rider meshes (one per material) for a kit in the rig's bind pose. */
export function buildRiderMeshes(
  joints: Readonly<RiderJoints>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The rig's Three skeleton is shared by the new skinned meshes.
  rig: RiderRig,
  kit: Readonly<RiderKit>,
  materials: RiderMaterials,
): RiderMesh[] {
  const bucket = new SkinBucket();

  addTorso(bucket, joints, rig.bind);
  addLimbs(bucket, joints, rig.bind);
  addShoes(bucket, joints, kit.shoes);
  addHead(bucket, rig.bind, kit.helmet, kit.glasses);

  return bucket.build(rig.skeleton, materials);
}
