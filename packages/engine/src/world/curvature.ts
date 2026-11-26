import type { CenterlinePoint } from "../elevation/route.js";

/**
 * Proposed kink limits for ADR-033 §2 ("Bögen, keine Knicke"), pending Henry's confirmation.
 * A vertex may turn the road by at most MAX_VERTEX_TURN_RAD, and by no more than the shorter
 * adjacent chord divided by MIN_CURVE_RADIUS_M. Tight hairpins therefore need short chords.
 */
export const MAX_VERTEX_TURN_RAD = 0.2;

export const MIN_CURVE_RADIUS_M = 10;

interface Chord {
  readonly dx: number;
  readonly dz: number;
  readonly lengthM: number;
}

function chordBetween(from: CenterlinePoint, to: CenterlinePoint): Chord {
  const dx = to.x - from.x;
  const dz = to.z - from.z;

  return { dx, dz, lengthM: Math.hypot(dx, dz) };
}

function chords(points: readonly CenterlinePoint[], label: string): readonly Chord[] {
  const result: Chord[] = [];
  let from: CenterlinePoint | undefined;

  for (const [index, to] of points.entries()) {
    if (from !== undefined) {
      const chord = chordBetween(from, to);

      if (chord.lengthM === 0) {
        throw new RangeError(`${label} has a zero-length chord at point ${index}`);
      }

      result.push(chord);
    }

    from = to;
  }

  return result;
}

/** Absolute heading change from one chord to the next, in radians (0 to π). */
function turnRad(incoming: Chord, outgoing: Chord): number {
  const cross = incoming.dx * outgoing.dz - incoming.dz * outgoing.dx;
  const dot = incoming.dx * outgoing.dx + incoming.dz * outgoing.dz;

  return Math.abs(Math.atan2(cross, dot));
}

function assertVertex(incoming: Chord, outgoing: Chord, label: string, pointIndex: number): void {
  const shorterM = Math.min(incoming.lengthM, outgoing.lengthM);
  const limitRad = Math.min(MAX_VERTEX_TURN_RAD, shorterM / MIN_CURVE_RADIUS_M);
  const angleRad = turnRad(incoming, outgoing);

  if (angleRad > limitRad) {
    throw new RangeError(
      `${label} kinks by ${angleRad} rad at point ${pointIndex} (limit ${limitRad} rad)`,
    );
  }
}

/**
 * Rejects zero-length chords and kinks. A closed centerline (first point equals last point)
 * is also checked across its seam at point 0.
 */
export function assertSmoothCenterline(
  points: readonly CenterlinePoint[],
  closed: boolean,
  label: string,
): void {
  const [first, ...rest] = chords(points, label);

  if (first === undefined) {
    return;
  }

  let previous = first;

  for (const [index, chord] of rest.entries()) {
    assertVertex(previous, chord, label, index + 1);
    previous = chord;
  }

  if (closed) {
    assertVertex(previous, first, label, 0);
  }
}
