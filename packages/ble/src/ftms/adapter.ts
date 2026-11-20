/**
 * Trainer adapter over the Fitness Machine Service (0x1826). After connecting
 * it reads the Fitness Machine Feature (0x2ACC), logs the raw machine dword,
 * and subscribes Indoor Bike Data (0x2AD2). Devices without 0x2AD2 fall back
 * to the read-only Cycling Power Service session ("passives Spiel",
 * docs/02-bluetooth.md section 2). No control-point writes from the game; the
 * 0x2AD9 encoder is E2.
 */

import type { DeviceEvent, EventBus } from "@voltonaut/shared";

import {
  createReconnectingAdapter,
  type ReconnectingAdapterOptions,
  type SessionCancellation,
  type BleDeviceAdapter,
} from "../adapterShell.js";
import { createCpsTrainerSession, type CpsTrainerSession } from "../cps/adapter.js";
import type { ByteReader } from "../bytes.js";
import { createCell, type Cell } from "../cell.js";
import type { SimClock, TickSource, Unsubscribe } from "../sim/index.js";
import type { BleTransport, GattProfile, ScanOptions } from "../transport.js";
import { parseFitnessMachineFeature, type FitnessMachineFeature } from "./feature.js";
import { parseIndoorBikeData } from "./parse.js";
import {
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  INDOOR_BIKE_DATA,
} from "../uuids.js";

export interface TrainerAdapterOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  readonly transport: BleTransport;
  readonly id?: string;
}

export type TrainerProtocol = "ftms" | "cps" | "none";

export interface TrainerAdapter extends BleDeviceAdapter {
  /** Which session flavor the last connect selected. */
  readonly protocol: () => TrainerProtocol;
  /** Parsed 0x2ACC features; undefined before a successful FTMS connect. */
  readonly features: () => FitnessMachineFeature | undefined;
}

const SCAN: ScanOptions = {
  acceptAllDevices: false,
  filters: [{ services: [FITNESS_MACHINE_SERVICE] }, { services: [CYCLING_POWER_SERVICE] }],
  optionalServices: [FITNESS_MACHINE_SERVICE, CYCLING_POWER_SERVICE],
};

interface TrainerSessionState {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly transport: BleTransport;
  readonly notifications: Cell<Unsubscribe | undefined>;
  readonly features: Cell<FitnessMachineFeature | undefined>;
  readonly protocol: Cell<TrainerProtocol>;
  readonly cpsSession: Cell<CpsTrainerSession | undefined>;
}

function findCharacteristic(
  profile: GattProfile,
  serviceUuid: string,
  characteristicUuid: string,
): boolean {
  return profile.services.some(
    (service) =>
      service.uuid === serviceUuid &&
      service.characteristics.some((characteristic) => characteristic.uuid === characteristicUuid),
  );
}

function onIndoorBikeData(state: TrainerSessionState, data: ByteReader): void {
  const parsed = parseIndoorBikeData(data);

  if (!parsed.ok) {
    return;
  }

  const sample = parsed.value;
  const tS = state.clock.nowS();

  const event: DeviceEvent = {
    type: "trainer.data",
    tS,
    ...(sample.powerW !== undefined && { powerW: sample.powerW }),
    ...(sample.cadenceRpm !== undefined && { cadenceRpm: sample.cadenceRpm }),
    ...(sample.speedMps !== undefined && { speedMps: sample.speedMps }),
  };

  state.bus.publish(event);
}

async function readFeatures(
  state: TrainerSessionState,
  signal: SessionCancellation,
): Promise<void> {
  try {
    const featureView = await state.transport.read({
      serviceUuid: FITNESS_MACHINE_SERVICE,
      characteristicUuid: FITNESS_MACHINE_FEATURE,
    });

    signal.throwIfAborted();

    const parsedFeature = parseFitnessMachineFeature(featureView);

    if (parsedFeature.ok) {
      state.features.set(parsedFeature.value);

      console.warn(
        `[trainer] 0x2ACC machine ${parsedFeature.value.machineDwordHex} -> ${parsedFeature.value.machineFeatures.join(", ") || "none"}; targets -> ${parsedFeature.value.targetFeatures.join(", ") || "none"}`,
      );
    }
  } catch {
    signal.throwIfAborted();
    state.features.set(undefined);
    console.warn("[trainer] fitness machine feature could not be read");
  }
}

async function startFtmsSession(
  state: TrainerSessionState,
  signal: SessionCancellation,
): Promise<void> {
  await readFeatures(state, signal);
  signal.throwIfAborted();
  state.notifications.get()?.();
  state.notifications.set(
    await state.transport.subscribe(
      { serviceUuid: FITNESS_MACHINE_SERVICE, characteristicUuid: INDOOR_BIKE_DATA },
      (data: ByteReader) => {
        onIndoorBikeData(state, data);
      },
    ),
  );
  signal.throwIfAborted();
  state.protocol.set("ftms");
}

async function selectSession(
  state: TrainerSessionState,
  profile: GattProfile,
  signal: SessionCancellation,
): Promise<void> {
  if (findCharacteristic(profile, FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA)) {
    await startFtmsSession(state, signal);

    return;
  }

  if (findCharacteristic(profile, CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT)) {
    const session = createCpsTrainerSession({
      bus: state.bus,
      clock: state.clock,
      transport: state.transport,
    });

    state.cpsSession.set(session);
    await session.start(profile);
    signal.throwIfAborted();
    state.protocol.set("cps");

    return;
  }

  throw new Error("no FTMS or cycling power service on the selected device");
}

export function createTrainerAdapter(options: TrainerAdapterOptions): TrainerAdapter {
  const { bus, clock, ticker, transport } = options;

  const state: TrainerSessionState = {
    bus,
    clock,
    transport,
    notifications: createCell<Unsubscribe>(),
    features: createCell<FitnessMachineFeature>(),
    protocol: createCell<TrainerProtocol>("none"),
    cpsSession: createCell<CpsTrainerSession>(),
  };

  const startSession: ReconnectingAdapterOptions["startSession"] = async (
    publish,
    selection,
    signal,
  ) => {
    state.notifications.get()?.();
    state.features.set(undefined);
    state.protocol.set("none");

    const profile = await transport.connect(SCAN, selection);
    publish("handshaking");
    signal.throwIfAborted();
    await selectSession(state, profile, signal);
  };

  const adapter = createReconnectingAdapter({
    kind: "trainer",
    id: options.id ?? "trainer",
    bus,
    clock,
    ticker,
    transport,
    startSession,
    stopSession: () => {
      state.notifications.get()?.();
      state.notifications.set(undefined);
      state.cpsSession.get()?.stop();
      state.cpsSession.set(undefined);
    },
  });

  return {
    ...adapter,
    protocol: () => state.protocol.get(),
    features: () => state.features.get(),
  };
}
