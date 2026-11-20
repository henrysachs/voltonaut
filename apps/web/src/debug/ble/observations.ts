import type {
  BleTransport,
  ByteReader,
  CharacteristicRef,
  NotificationListener,
} from "@voltonaut/ble";
import { createSubscriptions } from "./subscriptions.js";

type Observation =
  | { readonly kind: "pending"; readonly ready: Promise<() => void> }
  | { readonly kind: "active"; readonly ready: Promise<() => void>; readonly stop: () => void };

function keyOf(ref: CharacteristicRef): string {
  return `${ref.serviceUuid}/${ref.characteristicUuid}`;
}

export class SnifferObservations {
  private readonly observed = new Map<string, Observation>();
  private readonly subscriptions: ReturnType<typeof createSubscriptions>;

  constructor(
    raw: BleTransport,
    record: (ref: CharacteristicRef, data: ByteReader, direction: "rx") => void,
    private readonly changed: () => void,
  ) {
    this.subscriptions = createSubscriptions(raw, (ref, data) => {
      record(ref, data, "rx");
    });
  }

  readonly subscribe = (ref: CharacteristicRef, listener: NotificationListener) =>
    this.subscriptions.subscribe(ref, listener);

  readonly clear = (): void => {
    this.observed.clear();
    this.subscriptions.clear();
    this.changed();
  };

  readonly isObserving = (ref: CharacteristicRef): boolean => this.observed.has(keyOf(ref));

  readonly unobserve = (ref: CharacteristicRef): void => {
    const key = keyOf(ref);
    const observation = this.observed.get(key);
    this.observed.delete(key);

    if (observation?.kind === "active") {
      observation.stop();
    } else if (observation !== undefined) {
      void observation.ready.then(
        (stop) => {
          stop();

          return true;
        },
        () => false,
      );
    }

    this.changed();
  };

  readonly observe = async (ref: CharacteristicRef): Promise<void> => {
    const key = keyOf(ref);
    const existing = this.observed.get(key);

    if (existing !== undefined) {
      await existing.ready;

      return;
    }

    const ready = this.subscriptions.subscribe(ref, () => {});
    const observation: Observation = { kind: "pending", ready };
    this.observed.set(key, observation);
    this.changed();

    try {
      const stop = await ready;

      if (this.observed.get(key) === observation) {
        this.observed.set(key, { kind: "active", ready, stop });
      }
    } catch (error) {
      if (this.observed.get(key) === observation) {
        this.observed.delete(key);
      }

      throw error;
    } finally {
      this.changed();
    }
  };
}
