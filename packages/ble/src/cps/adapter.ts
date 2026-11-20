/**
 * Cycling power adapter over the Cycling Power Service (0x1818, measurement
 * 0x2A63, read only). Cadence comes from crank revolution deltas between
 * frames, so the session is stateful (spec E1-01 AK5).
 */

import type { EventBus } from "@voltonaut/shared";

import { createReconnectingAdapter, type BleDeviceAdapter } from "../adapterShell.js";
import type { ByteReader } from "../bytes.js";
import type { SimClock } from "../sim/clock.js";
import type { TickSource, Unsubscribe } from "../sim/tick.js";
import type { BleTransport, GattProfile, ScanOptions } from "../transport.js";
import { CYCLING_POWER_MEASUREMENT, CYCLING_POWER_SERVICE } from "../uuids.js";
import { parseCyclingPowerMeasurement } from "./parse.js";

export interface CpsTrainerSessionOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly transport: BleTransport;
}

export interface CpsTrainerSession {
  /** Subscribes the measurement characteristic; rejects when the connect fails. */
  readonly start: (profile: GattProfile) => Promise<void>;
  readonly stop: () => void;
}

export interface CpsTrainerAdapterOptions extends CpsTrainerSessionOptions {
  readonly ticker: TickSource;
  readonly id?: string;
}

export interface CpsTrainerAdapter extends BleDeviceAdapter {}

const SCAN: ScanOptions = {
  acceptAllDevices: false,
  filters: [{ services: [CYCLING_POWER_SERVICE] }],
  optionalServices: [],
};

const UINT16_RANGE = 0x10000;
const CRANK_IDLE_TIMEOUT_S = 3;

function delta(current: number, previous: number): number {
  return (((current - previous) % UINT16_RANGE) + UINT16_RANGE) % UINT16_RANGE;
}

interface CrankCell {
  revs: number;
  eventRaw: number;
  lastProgressS: number;
}

function createCpsNotificationHandler(options: {
  readonly bus: EventBus;
  readonly clock: SimClock;
}): (data: ByteReader) => void {
  let lastCrank: CrankCell | undefined;

  return (data: ByteReader) => {
    const parsed = parseCyclingPowerMeasurement(data);

    if (!parsed.ok) {
      return;
    }

    const sample = parsed.value;
    const tS = options.clock.nowS();
    let cadenceRpm: number | undefined;

    if (sample.crankRevs !== undefined && sample.crankEventRaw !== undefined) {
      const previous = lastCrank;
      let lastProgressS = previous?.lastProgressS ?? tS;

      if (previous !== undefined) {
        const deltaRevs = delta(sample.crankRevs, previous.revs);
        const deltaEventS = delta(sample.crankEventRaw, previous.eventRaw) / 1024;

        if (deltaRevs > 0 && deltaEventS > 0) {
          cadenceRpm = (60 * deltaRevs) / deltaEventS;
        }

        if (deltaRevs > 0) {
          lastProgressS = tS;
        } else if (tS - lastProgressS >= CRANK_IDLE_TIMEOUT_S) {
          cadenceRpm = 0;
        }
      }

      lastCrank = { revs: sample.crankRevs, eventRaw: sample.crankEventRaw, lastProgressS };
    }

    options.bus.publish(
      cadenceRpm === undefined
        ? { type: "trainer.data", tS, powerW: sample.powerW }
        : { type: "trainer.data", tS, powerW: sample.powerW, cadenceRpm },
    );
  };
}

function hasCpsMeasurement(profile: GattProfile): boolean {
  return profile.services.some(
    (service) =>
      service.uuid === CYCLING_POWER_SERVICE &&
      service.characteristics.some(
        (characteristic) => characteristic.uuid === CYCLING_POWER_MEASUREMENT,
      ),
  );
}

/** Shared session used by the standalone adapter and the trainer fallback. */
export function createCpsTrainerSession(options: CpsTrainerSessionOptions): CpsTrainerSession {
  const { bus, clock, transport } = options;
  let stopNotifications: Unsubscribe | undefined;

  return {
    async start(profile) {
      stopNotifications?.();

      if (!hasCpsMeasurement(profile)) {
        throw new Error("no cycling power service on the selected device");
      }

      stopNotifications = await transport.subscribe(
        { serviceUuid: CYCLING_POWER_SERVICE, characteristicUuid: CYCLING_POWER_MEASUREMENT },
        createCpsNotificationHandler({ bus, clock }),
      );
    },
    stop() {
      stopNotifications?.();
      stopNotifications = undefined;
    },
  };
}

export function createCpsTrainerAdapter(options: CpsTrainerAdapterOptions): CpsTrainerAdapter {
  const { bus, clock, ticker, transport } = options;
  const session = createCpsTrainerSession({ bus, clock, transport });

  return createReconnectingAdapter({
    kind: "trainer",
    id: options.id ?? "cps-trainer",
    bus,
    clock,
    ticker,
    transport,
    startSession: async (_publish, selection, signal) => {
      const profile = await transport.connect(SCAN, selection);
      signal.throwIfAborted();
      await session.start(profile);
    },
    stopSession: () => {
      session.stop();
    },
  });
}
