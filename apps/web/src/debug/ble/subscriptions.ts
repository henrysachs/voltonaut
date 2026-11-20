import type {
  BleTransport,
  CharacteristicRef,
  NotificationListener,
  Unsubscribe,
} from "@voltonaut/ble";

interface Subscription {
  readonly recipients: Set<NotificationListener>;
  readonly ready: Promise<Unsubscribe>;
}

class SnifferSubscriptions {
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(
    private readonly raw: BleTransport,
    private readonly record: (
      ref: CharacteristicRef,
      data: Parameters<NotificationListener>[0],
    ) => void,
  ) {}

  clear(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.recipients.clear();
      void subscription.ready.then(
        (stop) => {
          stop();

          return true;
        },
        () => false,
      );
    }

    this.subscriptions.clear();
  }

  private create(ref: CharacteristicRef, key: string): Subscription {
    const recipients = new Set<NotificationListener>();

    const ready = this.raw.subscribe(ref, (data) => {
      if (this.subscriptions.get(key)?.recipients !== recipients || recipients.size === 0) {
        return;
      }

      this.record(ref, data);

      for (const recipient of recipients) {
        recipient(data);
      }
    });

    const subscription = { recipients, ready };
    this.subscriptions.set(key, subscription);

    return subscription;
  }

  async subscribe(ref: CharacteristicRef, listener: NotificationListener): Promise<Unsubscribe> {
    const key = `${ref.serviceUuid}/${ref.characteristicUuid}`;
    const current = this.subscriptions.get(key) ?? this.create(ref, key);
    current.recipients.add(listener);
    let stop: Unsubscribe;

    try {
      stop = await current.ready;
    } catch (error) {
      if (this.subscriptions.get(key) === current) {
        this.subscriptions.delete(key);
      }

      current.recipients.clear();
      throw error;
    }

    if (this.subscriptions.get(key) !== current) {
      stop();
      throw new Error("Notification subscription cancelled");
    }

    return () => {
      current.recipients.delete(listener);

      if (current.recipients.size === 0 && this.subscriptions.get(key) === current) {
        this.subscriptions.delete(key);
        stop();
      }
    };
  }
}

export function createSubscriptions(
  raw: BleTransport,
  record: (ref: CharacteristicRef, data: Parameters<NotificationListener>[0]) => void,
) {
  const subscriptions = new SnifferSubscriptions(raw, record);

  return {
    clear: () => {
      subscriptions.clear();
    },
    subscribe: (ref: CharacteristicRef, listener: NotificationListener) =>
      subscriptions.subscribe(ref, listener),
  };
}
