import type { Point3 } from "./bikeGeometry.js";
import { boneIndex, type BoneName, type BoneSegments } from "./riderRig.js";

/** Up to four bone influences per vertex. */
export type Influences = readonly (readonly [bone: number, weight: number])[];

/** Skin weights for a vertex at a bind-pose position. */
export type Weigher = (position: Point3) => Influences;

export function rigid(bone: BoneName): Weigher {
  const influences: Influences = [[boneIndex(bone), 1]];

  return () => influences;
}

interface Capsule {
  readonly bone: number;
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly lengthSq: number;
  readonly bias: number;
}

function capsuleDistance(capsule: Readonly<Capsule>, x: number, y: number, z: number): number {
  const px = x - capsule.hx;
  const py = y - capsule.hy;
  const pz = z - capsule.hz;

  const t = Math.min(
    1,
    Math.max(0, (px * capsule.dx + py * capsule.dy + pz * capsule.dz) / capsule.lengthSq),
  );

  return Math.max(1e-4, Math.hypot(px - capsule.dx * t, py - capsule.dy * t, pz - capsule.dz * t));
}

/**
 * Envelope skinning: every vertex follows the nearest bone segments of `bones`, blended by
 * inverse distance so joints bend smoothly while the middle of a segment stays rigid. `bias`
 * scales a bone's pull (cloth that should only partly follow a limb).
 */
export function envelope(
  bind: BoneSegments,
  bones: readonly BoneName[],
  bias: Readonly<Partial<Record<BoneName, number>>> = {},
  sharpness = 6,
): Weigher {
  const capsules: Capsule[] = bones.map((name) => {
    const { head, tail } = bind[name];
    const dx = tail[0] - head[0];
    const dy = tail[1] - head[1];
    const dz = tail[2] - head[2];

    return {
      bone: boneIndex(name),
      hx: head[0],
      hy: head[1],
      hz: head[2],
      dx,
      dy,
      dz,
      lengthSq: Math.max(1e-9, dx * dx + dy * dy + dz * dz),
      bias: bias[name] ?? 1,
    };
  });

  return ([x, y, z]) => {
    const scored: (readonly [bone: number, distanceM: number, bias: number])[] = capsules.map(
      (capsule) => [capsule.bone, capsuleDistance(capsule, x, y, z), capsule.bias],
    );

    scored.sort((a, b) => a[1] - b[1]);

    const closest = scored[0]?.[1] ?? 1;
    const influences: (readonly [number, number])[] = [];
    let total = 0;

    for (const [bone, distanceM, pull] of scored.slice(0, 3)) {
      const weight = (closest / distanceM) ** sharpness * pull;

      influences.push([bone, weight]);
      total += weight;
    }

    return influences.filter(([, weight]) => weight / total > 0.01);
  };
}

/** Normalises influences to exactly four slots. */
export function skinSlots(influences: Influences): readonly [number[], number[]] {
  const indices = [0, 0, 0, 0];
  const weights = [0, 0, 0, 0];
  let total = 0;

  for (const [, weight] of influences.slice(0, 4)) total += weight;

  for (const [slot, [bone, weight]] of influences.slice(0, 4).entries()) {
    indices[slot] = bone;
    weights[slot] = weight / total;
  }

  return [indices, weights];
}
