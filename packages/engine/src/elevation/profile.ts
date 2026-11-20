import type { Meters, Pct } from "@voltonaut/shared";

/** One elevation support point; distances are strictly increasing. */
export interface ElevationSample {
  readonly distanceM: Meters;
  readonly elevationM: Meters;
}

export interface ElevationProfileOptions {
  /** Loop profiles wrap positions with d mod L; the data should be closed (end = start). */
  readonly loop: boolean;
}

/** Central-difference smoothing window; docs/03 section 4 (20-30 m). */
export const DEFAULT_SMOOTHING_M = 25;

export interface ElevationProfile {
  readonly samples: readonly ElevationSample[];
  readonly lengthM: Meters;
  readonly loop: boolean;
  /** Linear interpolation; exact at support points; clamped outside [0, L] (non-loop). */
  readonly elevationAt: (distanceM: Meters) => Meters;
  /**
   * Central difference (elev(d + s/2) - elev(d - s/2)) over the smoothing window.
   * Loops close the window across the wrap; non-loop ends clamp the window to
   * [0, L] and divide by the actual window width.
   */
  readonly gradeAt: (distanceM: Meters, smoothingM?: Meters) => Pct;
}

function wrapDistanceM(distanceM: Meters, lengthM: Meters): Meters {
  return ((distanceM % lengthM) + lengthM) % lengthM;
}

function clampDistanceM(distanceM: Meters, lengthM: Meters): Meters {
  return Math.min(lengthM, Math.max(0, distanceM));
}

/** Largest index i with samples[i].distanceM <= d, bounded to [0, count - 2]. */
function segmentIndexFor(samples: readonly ElevationSample[], distanceM: Meters): number {
  let low = 0;
  let high = samples.length - 1;

  while (low < high - 1) {
    const mid = (low + high) >> 1;
    const midDistance = samples[mid]?.distanceM ?? 0;

    if (midDistance <= distanceM) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

function interpolateElevation(samples: readonly ElevationSample[], distanceM: Meters): Meters {
  const index = segmentIndexFor(samples, distanceM);
  const start = samples[index];
  const end = samples[index + 1];

  if (start === undefined || end === undefined) {
    return samples[0]?.elevationM ?? 0;
  }

  const spanM = end.distanceM - start.distanceM;

  if (spanM <= 0) {
    return start.elevationM;
  }

  const fraction = (distanceM - start.distanceM) / spanM;

  return start.elevationM + fraction * (end.elevationM - start.elevationM);
}

function validateSamples(samples: readonly ElevationSample[]): void {
  if (samples.length < 2) {
    throw new RangeError("an elevation profile needs at least 2 samples");
  }

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];

    if (sample === undefined) {
      throw new RangeError(`elevation sample ${index} is missing`);
    }

    if (!Number.isFinite(sample.distanceM) || !Number.isFinite(sample.elevationM)) {
      throw new RangeError(`elevation sample ${index} is not finite`);
    }

    const previous = samples[index - 1];

    if (previous !== undefined && sample.distanceM <= previous.distanceM) {
      throw new RangeError(`elevation sample ${index} is not strictly increasing in distanceM`);
    }
  }
}

function nonLoopGrade(
  samples: readonly ElevationSample[],
  positionM: Meters,
  lengthM: Meters,
  smoothingM: Meters,
): Pct {
  const lowM = Math.max(0, positionM - smoothingM / 2);
  const highM = Math.min(lengthM, positionM + smoothingM / 2);
  const windowM = highM - lowM;

  if (windowM <= 0) {
    return 0;
  }

  return (
    ((interpolateElevation(samples, highM) - interpolateElevation(samples, lowM)) / windowM) * 100
  );
}

/** Validates and constructs a profile: >= 2 support points, strictly increasing distances. */
export function createElevationProfile(
  samples: readonly ElevationSample[],
  options: ElevationProfileOptions,
): ElevationProfile {
  validateSamples(samples);

  const lengthM = samples.at(-1)?.distanceM ?? 0;

  if (lengthM <= 0) {
    throw new RangeError("an elevation profile needs a positive length");
  }

  const { loop } = options;

  return {
    samples,
    lengthM,
    loop,
    elevationAt(distanceM: Meters): Meters {
      const positionM = loop
        ? wrapDistanceM(distanceM, lengthM)
        : clampDistanceM(distanceM, lengthM);

      return interpolateElevation(samples, positionM);
    },
    gradeAt(distanceM: Meters, smoothingM: Meters = DEFAULT_SMOOTHING_M): Pct {
      if (smoothingM <= 0 || Number.isNaN(smoothingM)) {
        throw new RangeError("smoothingM must be positive");
      }

      if (loop) {
        const lowM = wrapDistanceM(distanceM - smoothingM / 2, lengthM);
        const highM = wrapDistanceM(distanceM + smoothingM / 2, lengthM);

        return (
          ((interpolateElevation(samples, highM) - interpolateElevation(samples, lowM)) /
            smoothingM) *
          100
        );
      }

      const positionM = clampDistanceM(distanceM, lengthM);

      return nonLoopGrade(samples, positionM, lengthM, smoothingM);
    },
  };
}
