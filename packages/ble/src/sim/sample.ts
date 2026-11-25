/** One scripted simulator reading, sent by the sim peripherals as GATT notifications. */
export interface SimSample {
  readonly powerW: number;
  readonly cadenceRpm: number;
  readonly heartRateBpm: number;
}

export type SimScript = readonly [SimSample, ...SimSample[]];

export function createSimScript(samples: readonly SimSample[]): SimScript {
  const [firstSample, ...restSamples] = samples;

  if (firstSample === undefined) {
    throw new RangeError("a sim script needs at least one sample");
  }

  return [firstSample, ...restSamples];
}
