/**
 * Ride modes (ADR-028). Every mode is one entry here; the engine, worker and UI
 * read these traits instead of asking for a specific mode. ERG (#78) is the next
 * planned entry.
 */
export type RideMode = "normal" | "fun";

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

/** Default mode at ride start and the fallback while a recording locks other modes. */
export const DEFAULT_RIDE_MODE: RideMode = "normal";

/** Menu order; the default comes first. */
export const RIDE_MODE_IDS: readonly RideMode[] = Object.freeze(["normal", "fun"]);
