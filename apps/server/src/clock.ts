export interface Clock {
  readonly nowMs: () => number;
}

export const CLOCK: unique symbol = Symbol("voltonaut:clock");
