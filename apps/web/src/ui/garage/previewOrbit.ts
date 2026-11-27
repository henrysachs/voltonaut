export interface PreviewOrbit {
  readonly yawRad: number;
  readonly pitchRad: number;
}

export const MIN_PREVIEW_PITCH_RAD = -0.08;
export const MAX_PREVIEW_PITCH_RAD = 0.65;

export const DEFAULT_PREVIEW_ORBIT: Readonly<PreviewOrbit> = Object.freeze({
  yawRad: Math.PI / 4,
  pitchRad: 0.2,
});

const FULL_TURN_RAD = Math.PI * 2;

export function normalizeYawRad(yawRad: number): number {
  const normalized =
    ((((yawRad + Math.PI) % FULL_TURN_RAD) + FULL_TURN_RAD) % FULL_TURN_RAD) - Math.PI;

  return normalized === 0 ? 0 : normalized;
}

export function normalizePreviewOrbit(orbit: Readonly<PreviewOrbit>): PreviewOrbit {
  if (!Number.isFinite(orbit.yawRad) || !Number.isFinite(orbit.pitchRad)) {
    return DEFAULT_PREVIEW_ORBIT;
  }

  return {
    yawRad: normalizeYawRad(orbit.yawRad),
    pitchRad: Math.min(MAX_PREVIEW_PITCH_RAD, Math.max(MIN_PREVIEW_PITCH_RAD, orbit.pitchRad)),
  };
}

export function orbitBy(
  current: Readonly<PreviewOrbit>,
  delta: Readonly<PreviewOrbit>,
): PreviewOrbit {
  if (
    !Number.isFinite(current.yawRad) ||
    !Number.isFinite(current.pitchRad) ||
    !Number.isFinite(delta.yawRad) ||
    !Number.isFinite(delta.pitchRad)
  ) {
    return current;
  }

  return normalizePreviewOrbit({
    yawRad: current.yawRad + delta.yawRad,
    pitchRad: current.pitchRad + delta.pitchRad,
  });
}
