/** The ride camera's far plane (scene-core): nothing beyond it is drawn anyway. */
export const VIEW_RANGE_M = 1500;

/** Axis-aligned ground area of a dressing part. */
export interface RegionBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Whether a dressing part can show from the rider's position (ADR-033 §6: render budget per
 * region). Parts out of view range cost no draw calls.
 */
export function regionInView(bounds: RegionBounds, x: number, z: number): boolean {
  const dx = Math.max(bounds.minX - x, 0, x - bounds.maxX);
  const dz = Math.max(bounds.minZ - z, 0, z - bounds.maxZ);

  return Math.hypot(dx, dz) <= VIEW_RANGE_M;
}
