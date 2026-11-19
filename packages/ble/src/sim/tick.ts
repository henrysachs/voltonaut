export type Unsubscribe = () => void;

export interface TickSource {
  start(onTick: () => void): Unsubscribe;
}

export interface ManualTicker extends TickSource {
  tick(): void;
}

export function createManualTicker(): ManualTicker {
  const listeners = new Set<() => void>();

  return {
    start(onTick) {
      listeners.add(onTick);

      return () => {
        listeners.delete(onTick);
      };
    },
    tick() {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

export function createIntervalTicker(intervalMs: number): TickSource {
  return {
    start(onTick) {
      const intervalId = setInterval(() => {
        onTick();
      }, intervalMs);

      return () => {
        clearInterval(intervalId);
      };
    },
  };
}
