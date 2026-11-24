/**
 * Ride modes (ADR-028). Every mode is one entry here; the engine, worker and UI
 * read these traits instead of asking for a specific mode. ERG (#78) is the next
 * planned entry.
 */
/** Menu order; the default comes first. */
export const RIDE_MODE_IDS = Object.freeze(["normal", "fun"] as const);

export type RideMode = (typeof RIDE_MODE_IDS)[number];

/** Default mode at ride start and the fallback while a recording locks other modes. */
export const DEFAULT_RIDE_MODE: RideMode = RIDE_MODE_IDS[0];

export interface RideModeTraits {
  /**
   * The recording journal can replay rides in this mode. A mode without it
   * refuses recording starts, cannot be entered while a recording runs and makes
   * every later capture of the session local-only (ADR-028).
   */
  readonly recordable: boolean;
  /** Progress checkpoints and rewards are produced in this mode. */
  readonly progress: boolean;
  /** Trainer command path; every mode uses FTMS simulation until ERG (#78). */
  readonly trainer: "simulation";
}

export const RIDE_MODES: Readonly<Record<RideMode, RideModeTraits>> = Object.freeze({
  normal: Object.freeze({ recordable: true, progress: true, trainer: "simulation" }),
  fun: Object.freeze({ recordable: false, progress: false, trainer: "simulation" }),
});
