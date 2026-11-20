/** One scripted simulator reading. gearIndex is zero-based; the HUD shows gearIndex + 1. */
export interface SimSample {
  readonly powerW: number;
  readonly cadenceRpm: number;
  readonly heartRateBpm: number;
  readonly gearIndex: number;
}

export type SimScript = readonly [SimSample, ...SimSample[]];

export function createSimScript(samples: readonly SimSample[]): SimScript {
  const [firstSample, ...restSamples] = samples;

  if (firstSample === undefined) {
    throw new RangeError("a sim script needs at least one sample");
  }

  return [firstSample, ...restSamples];
}
