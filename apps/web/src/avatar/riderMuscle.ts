import type { Point3 } from "./bikeGeometry.js";
import { add3, lerp, smoothPath, vector } from "./bikeSweep.js";

export const UPWARD: Point3 = [0, 1, 0];

/** Anterior side of the leg: up for the thigh, forward for the shin. */
export const LEG_FRONT: Point3 = [1, 0.6, 0];

/** Soft bump centred at `at` with half width `width` (0 outside). */
export function bump(t: number, at: number, width: number): number {
  const x = (t - at) / width;

  return Math.abs(x) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x);
}

/**
 * Elliptic limb section with muscle bellies: `front` scales the +forward half, `back` the
 * −forward half. Returns (across, along) for the tube builder.
 */
export function muscle(
  halfLateral: number,
  halfForward: number,
  front: number,
  back: number,
  angleRad: number,
): readonly [number, number] {
  const sin = Math.sin(angleRad);

  return [Math.cos(angleRad) * halfLateral, sin * halfForward * (1 + (sin > 0 ? front : back))];
}

/** Two-segment limb root → joint → end sampled as one smooth path between `window` fractions. */
export interface Chain {
  readonly path: Point3[];
  /** Maps tube t to (segment, position along that segment). */
  readonly at: (t: number) => readonly [0 | 1, number];
}

export function chain(
  points: readonly [Point3, Point3, Point3],
  window: readonly [number, number],
  rings: number,
): Chain {
  const [root, joint, end] = points;
  const upperM = vector(joint).distanceTo(vector(root));
  const split = upperM / (upperM + vector(end).distanceTo(vector(joint)));
  const fine = 160;
  const sampled = smoothPath(points, fine);
  const steps = Math.max(1, Math.round((window[1] - window[0]) * rings));
  const along = (t: number): number => lerp(window[0], window[1], t);

  return {
    path: Array.from(
      { length: steps + 1 },
      (_, index): Point3 => sampled[Math.round(along(index / steps) * fine)] ?? root,
    ),
    at: (t) => {
      const position = along(t);

      return position < split ? [0, position / split] : [1, (position - split) / (1 - split)];
    },
  };
}

export function extend(start: Point3, end: Point3, beforeM: number): Point3 {
  const direction = vector(end).sub(vector(start)).normalize();

  return add3(start, [direction.x, direction.y, direction.z], -beforeM);
}
