import type { Meters } from "@voltonaut/shared";

import type { EngineRoute } from "../elevation/route.js";

export const FIRST_ITEM_BOX_M: Meters = 300;
export const ITEM_BOX_SPACING_M: Meters = 800;

/**
 * Deterministic item box positions along the route (spec E9-01 AK2). A box
 * inside a sprint or KOM segment moves to the segment end so it never
 * interrupts a timed effort. Contents are drawn from the ride seed, not here.
 */
export function planItemBoxes(route: Pick<EngineRoute, "lengthM" | "segments">): readonly Meters[] {
  const boxes: Meters[] = [];

  for (
    let distanceM = FIRST_ITEM_BOX_M;
    distanceM < route.lengthM;
    distanceM += ITEM_BOX_SPACING_M
  ) {
    const segment = route.segments.find(
      (candidate) =>
        candidate.kind !== "lap" && candidate.startM <= distanceM && distanceM < candidate.endM,
    );

    const positionM = segment?.endM ?? distanceM;

    if (!boxes.includes(positionM)) boxes.push(positionM);
  }

  // Ascending by construction: a moved box lands at its segment end, before any later box.
  return Object.freeze(boxes);
}
