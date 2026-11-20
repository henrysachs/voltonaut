export function wheelAngleRad(distanceM: number, wheelCircM: number): number {
  return (distanceM / wheelCircM) * Math.PI * 2;
}

export function advanceCrankRad(angleRad: number, cadenceRpm: number, elapsedS: number): number {
  return angleRad + (Math.max(0, cadenceRpm) / 60) * Math.PI * 2 * Math.max(0, elapsedS);
}

export function followFraction(dtS: number): number {
  return 1 - Math.exp(-6 * Math.max(0, dtS));
}
