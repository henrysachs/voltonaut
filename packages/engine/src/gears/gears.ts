export const GEAR_COUNT = 24;
export const MIN_GEAR_INDEX = 0;
export const MAX_GEAR_INDEX = GEAR_COUNT - 1;

export type GearDirection = "up" | "down";

/** Shifts a zero-based gear index and clamps it to the 24-gear range. */
export function shiftGearIndex(currentIndex: number, direction: GearDirection): number {
  const nextIndex = direction === "up" ? currentIndex + 1 : currentIndex - 1;

  return Math.min(MAX_GEAR_INDEX, Math.max(MIN_GEAR_INDEX, nextIndex));
}
