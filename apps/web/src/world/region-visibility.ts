import type { EngineRoute } from "@voltonaut/engine";

/** The ride camera's far plane (scene-core): nothing beyond it is drawn anyway. */
export const VIEW_RANGE_M = 1500;

/** Dressing reaches this far beside its home road: forest rows, shore, sea and city blocks. */
export const DRESSING_MARGIN_M = 500;

/** Axis-aligned area a region's dressing occupies. */
export interface RegionBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Bounds of the home road's centerline, widened by the dressing margin. */
export function regionBounds(home: Pick<EngineRoute, "lengthM" | "worldPos">): RegionBounds {
  const points = Array.from({ length: Math.ceil(home.lengthM / 50) + 1 }, (_, index) =>
    home.worldPos(Math.min(home.lengthM, index * 50)),
  );

  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);

  return {
    minX: Math.min(...xs) - DRESSING_MARGIN_M,
    maxX: Math.max(...xs) + DRESSING_MARGIN_M,
    minZ: Math.min(...zs) - DRESSING_MARGIN_M,
    maxZ: Math.max(...zs) + DRESSING_MARGIN_M,
  };
}

/**
 * Whether a region's dressing can show from the rider's position (ADR-033 §6: render budget per
 * region). Regions out of view range cost no draw calls.
 */
export function regionInView(bounds: RegionBounds, x: number, z: number): boolean {
  const dx = Math.max(bounds.minX - x, 0, x - bounds.maxX);
  const dz = Math.max(bounds.minZ - z, 0, z - bounds.maxZ);

  return Math.hypot(dx, dz) <= VIEW_RANGE_M;
}
