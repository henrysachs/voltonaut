/**
 * Heart rate adapter over the Heart Rate Service (0x180D, measurement 0x2A37).
 * Owns its reconnect schedule; the connect dialog only shows device.status
 * and triggers a manual connect.
 */

import type { EventBus } from "@voltonaut/shared";

import {
  createReconnectingAdapter,
  type ReconnectingAdapterOptions,
  type BleDeviceAdapter,
} from "../adapterShell.js";
import type { ByteReader } from "../bytes.js";
import type { SimClock } from "../sim/clock.js";
import type { TickSource, Unsubscribe } from "../sim/tick.js";
import type { BleTransport, ScanOptions } from "../transport.js";
import { BATTERY_SERVICE, HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE } from "../uuids.js";
import { parseHeartRateMeasurement } from "./parse.js";

export interface HeartRateAdapterOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  readonly transport: BleTransport;
  readonly id?: string;
}

export interface HeartRateAdapter extends BleDeviceAdapter {}

const SCAN: ScanOptions = {
  acceptAllDevices: false,
  filters: [{ services: [HEART_RATE_SERVICE] }],
  optionalServices: [BATTERY_SERVICE],
};

function onNotification(bus: EventBus, clock: SimClock, data: ByteReader): void {
  const parsed = parseHeartRateMeasurement(data);

  if (!parsed.ok) {
    return;
  }

  const sample = parsed.value;

  bus.publish(
    sample.rrMs.length > 0
      ? { type: "hr.data", tS: clock.nowS(), bpm: sample.bpm, rrMs: sample.rrMs }
      : { type: "hr.data", tS: clock.nowS(), bpm: sample.bpm },
  );
}

export function createHeartRateAdapter(options: HeartRateAdapterOptions): HeartRateAdapter {
  const { bus, clock, ticker, transport } = options;
  let stopNotifications: Unsubscribe | undefined;

  const startSession: ReconnectingAdapterOptions["startSession"] = async (
    publish,
    selection,
    signal,
  ) => {
    stopNotifications?.();
    await transport.connect(SCAN, selection);
    signal.throwIfAborted();
    publish("handshaking");
    signal.throwIfAborted();
    stopNotifications = await transport.subscribe(
      { serviceUuid: HEART_RATE_SERVICE, characteristicUuid: HEART_RATE_MEASUREMENT },
      (data: ByteReader) => {
        onNotification(bus, clock, data);
      },
    );
  };

  return createReconnectingAdapter({
    kind: "heartRate",
    id: options.id ?? "heart-rate",
    bus,
    clock,
    ticker,
    transport,
    startSession,
    stopSession: () => {
      stopNotifications?.();
      stopNotifications = undefined;
    },
  });
}
