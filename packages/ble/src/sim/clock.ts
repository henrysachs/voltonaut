export interface SimClock {
  nowS(): number;
}

export interface ManualClock extends SimClock {
  advanceS(deltaS: number): void;
}

export function createManualClock(startS = 0): ManualClock {
  let currentS = startS;

  return {
    nowS: () => currentS,
    advanceS(deltaS) {
      currentS += deltaS;
    },
  };
}

export function createScaledClock(source: Readonly<SimClock>, factor: number): SimClock {
  return {
    nowS: () => source.nowS() * factor,
  };
}
