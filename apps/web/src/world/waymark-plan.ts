import type { EngineRoute } from "@voltonaut/engine";

/** Kilometre waymark signs stand on the left, 30 m after every full kilometre. */
export const WAYMARK_LATERAL_M = -6.2;
const WAYMARK_OFFSET_M = 30;

export interface WaymarkSpot {
  readonly km: number;
  readonly distanceM: number;
  readonly lateralM: number;
}

/** Single source for waymark placement, shared by the renderer and its neighbours. */
export function planWaymarks(route: Pick<EngineRoute, "lengthM">): readonly WaymarkSpot[] {
  return Array.from({ length: Math.ceil(route.lengthM / 1000) }, (_, km) => ({
    km,
    distanceM: km * 1000 + WAYMARK_OFFSET_M,
    lateralM: WAYMARK_LATERAL_M,
  }));
}
