import type { Rpm, Seconds } from "@voltonaut/shared";

/** Auto-pause after 5 s below 0.5 m/s with no cadence (docs/03 section 1). */
export const AUTO_PAUSE_S: Seconds = 5;
export const AUTO_PAUSE_SPEED_MPS = 0.5;
export const AUTO_PAUSE_RESUME_CADENCE_RPM: Rpm = 0;

/** Data loss: no fresh trainer.data for more than 3 s => raw values read as zero. */
export const DATA_LOSS_S: Seconds = 3;

export function isStationary(speedMps: number, rawCadenceRpm: Rpm): boolean {
  return speedMps < AUTO_PAUSE_SPEED_MPS && rawCadenceRpm <= AUTO_PAUSE_RESUME_CADENCE_RPM;
}

/**
 * Pause rule: stationary for at least AUTO_PAUSE_S, checked at tick start.
 * The epsilon absorbs float drift from summing dtS (100 x 0.05 lands slightly
 * below 5.0), so exactly 100 standing ticks pause at tick 101.
 */
export function shouldAutoPause(
  stationaryS: Seconds,
  speedMps: number,
  rawCadenceRpm: Rpm,
): boolean {
  return stationaryS >= AUTO_PAUSE_S - 1e-9 && isStationary(speedMps, rawCadenceRpm);
}

/** Resume rule: any pedaling (cadence or power) un-pauses the ride. */
export function shouldResume(rawCadenceRpm: Rpm, rawPowerW: number): boolean {
  return rawCadenceRpm > 0 || rawPowerW > 0;
}

/** Raw readings read as zero once the data gap exceeds DATA_LOSS_S. */
export function rawValuesZeroed(dataAgeS: Seconds): boolean {
  return dataAgeS > DATA_LOSS_S;
}
