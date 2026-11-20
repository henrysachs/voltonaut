/**
 * Shared shell for device adapters: status publishing on the bus, the
 * five-attempt reconnect schedule, and the manual connect/disconnect phases.
 * Protocol adapters provide their session start/stop; the shell owns status.
 */
import type { ConnectionStatus, DeviceAdapter, DeviceKind, EventBus } from "@voltonaut/shared";
import { createReconnectController, type ReconnectController } from "./reconnect.js";
import type { SimClock } from "./sim/clock.js";
import type { TickSource } from "./sim/tick.js";
import type { BleTransport, DeviceSelection } from "./transport.js";

export type StatusPublisher = (status: ConnectionStatus) => void;

export type SessionCancellation = Readonly<Pick<AbortSignal, "throwIfAborted">>;

export interface BleDeviceAdapter extends DeviceAdapter {
  readonly select: () => Promise<void>;
}

export interface ReconnectingAdapterOptions {
  readonly kind: DeviceKind;
  readonly id: string;
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  readonly transport: BleTransport;
  readonly startSession: (
    publish: StatusPublisher,
    selection: DeviceSelection,
    signal: SessionCancellation,
  ) => Promise<void>;
  readonly stopSession: () => void;
}

class ReconnectingBleDevice implements BleDeviceAdapter {
  private currentStatus: ConnectionStatus = "disconnected";
  private session = new AbortController();
  private readonly reconnect: ReconnectController;

  constructor(private readonly options: ReconnectingAdapterOptions) {
    this.reconnect = createReconnectController({
      clock: options.clock,
      ticker: options.ticker,
      attempt: () => this.start("remembered", () => {}),
      onAttempt: () => {
        this.publish("reconnecting");
      },
      onExhausted: () => {
        this.publish("error");
      },
    });
    options.transport.onDisconnected(() => {
      this.unexpectedDisconnect();
    });
  }

  get kind(): DeviceKind {
    return this.options.kind;
  }
  get id(): string {
    return this.options.id;
  }
  status(): ConnectionStatus {
    return this.currentStatus;
  }

  private publish(status: ConnectionStatus): void {
    this.currentStatus = status;
    this.options.bus.publish({
      type: "device.status",
      tS: this.options.clock.nowS(),
      kind: this.kind,
      id: this.id,
      status,
    });
  }

  private async start(selection: DeviceSelection, publish: StatusPublisher): Promise<boolean> {
    const { signal } = this.session;
    await this.options.startSession(
      (status) => {
        signal.throwIfAborted();
        publish(status);
      },
      selection,
      signal,
    );
    signal.throwIfAborted();

    this.publish("ready");

    return true;
  }

  private unexpectedDisconnect(): void {
    if (this.currentStatus === "disconnected") {
      return;
    }

    this.resetSession();
    this.options.stopSession();

    if (this.currentStatus === "error") {
      return;
    }

    this.publish("reconnecting");
    this.reconnect.disconnected();
  }

  private async manualConnect(selection: DeviceSelection): Promise<void> {
    this.resetSession();
    const { signal } = this.session;
    this.reconnect.reset();
    this.options.stopSession();
    this.publish("connecting");

    try {
      await this.start(selection, (status) => {
        this.publish(status);
      });
    } catch {
      if (!signal.aborted) {
        this.publish("error");
      }
    }
  }

  private resetSession(): void {
    this.session.abort();
    this.session = new AbortController();
  }

  connect(): Promise<void> {
    return this.manualConnect("remembered");
  }
  select(): Promise<void> {
    return this.manualConnect("select");
  }

  async disconnect(): Promise<void> {
    this.session.abort();
    this.reconnect.reset();
    this.publish("disconnected");
    this.options.stopSession();
    await this.options.transport.disconnect().catch(() => null);
  }
}

export function createReconnectingAdapter(options: ReconnectingAdapterOptions): BleDeviceAdapter {
  const adapter = new ReconnectingBleDevice(options);

  return {
    kind: options.kind,
    id: options.id,
    connect: () => adapter.connect(),
    select: () => adapter.select(),
    status: () => adapter.status(),
    disconnect: () => adapter.disconnect(),
  };
}
