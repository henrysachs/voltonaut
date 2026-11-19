import { GEAR_COUNT } from "@voltonaut/engine";

/** Returns the one-based gear label shown in the HUD. */
export function gearLabel(gearIndex: number): string {
  if (!Number.isInteger(gearIndex) || gearIndex < 0 || gearIndex >= GEAR_COUNT) {
    throw new RangeError(`gearIndex must be an integer in [0, ${GEAR_COUNT - 1}]`);
  }

  return String(gearIndex + 1);
}
