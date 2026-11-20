import { describe, expect, it } from "vitest";

import { byteReader, bytesCopy, toHex, type ByteReader, type ReadOnlyBytes } from "../bytes.js";
import { createManualClock } from "../sim/clock.js";
import { createManualTicker } from "../sim/tick.js";
import type { BlePresetStep } from "./presets.js";
import type { BleTransport, CharacteristicRef, GattProfile } from "../transport.js";
import { FITNESS_MACHINE_CONTROL_POINT, FITNESS_MACHINE_SERVICE } from "../uuids.js";
import {
  FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET,
  FTMS_SIM_FIVE_PRESET,
  ZWIFT_PLAY_HANDSHAKE_PRESET,
  runBlePreset,
} from "./presets.js";

const HEX = (bytes: ReadOnlyBytes): string => toHex(bytes);

function writeBytes(step: BlePresetStep | undefined): string {
  return step?.kind === "write" ? HEX(step.bytes) : "not-a-write-step";
}

function flushAsyncQueue(depth = 10): Promise<void> {
  return depth === 0 ? Promise.resolve() : Promise.resolve().then(() => flushAsyncQueue(depth - 1));
}

describe("preset byte constants", () => {
  it("matches the documented request-control-then-sim-zero sequence", () => {
    const writeSteps = FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET.steps.filter(
      (step) => step.kind === "write",
    );

    expect(writeSteps).toHaveLength(2);
    expect(writeBytes(writeSteps[0])).toBe("00");
    expect(writeBytes(writeSteps[1])).toBe("11 00 00 00 00 28 33");
  });

  it("waits for the 80 00 01 response indication before simulating", () => {
    const waitStep = FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET.steps.find(
      (step) => step.kind === "awaitResponse",
    );

    expect(waitStep).toHaveProperty("kind", "awaitResponse");
    expect(FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET.steps.flatMap(responsePrefix)).toEqual([
      "80 00 01",
      "80 11 01",
    ]);
  });

  it("matches the documented sim 5 % write", () => {
    expect(writeBytes(FTMS_SIM_FIVE_PRESET.steps[1])).toBe("11 00 00 f4 01 28 33");
  });

  it("matches the RideOn cleartext handshake bytes", () => {
    expect(writeBytes(ZWIFT_PLAY_HANDSHAKE_PRESET.steps[2])).toBe("52 69 64 65 4f 6e");
  });
});

interface RecordedWrite {
  readonly ref: CharacteristicRef;
  readonly bytes: ReadOnlyBytes;
}

interface ScriptedTransport extends BleTransport {
  readonly writes: () => readonly RecordedWrite[];
  readonly subscriptions: () => readonly CharacteristicRef[];
  readonly respondWith: (bytes: ReadOnlyBytes) => void;
}

function refKey(ref: CharacteristicRef): string {
  return `${ref.serviceUuid}/${ref.characteristicUuid}`;
}

function responsePrefix(step: BlePresetStep): readonly string[] {
  return step.kind === "awaitResponse" ? [HEX(step.expectedPrefix)] : [];
}

function respond(
  listeners: (key: string) => readonly ((data: ByteReader) => void)[],
  bytes: ReadOnlyBytes,
): void {
  const ref = {
    serviceUuid: FITNESS_MACHINE_SERVICE,
    characteristicUuid: FITNESS_MACHINE_CONTROL_POINT,
  };

  const copy = bytesCopy(bytes);
  const view = new DataView(copy.buffer, copy.byteOffset, copy.length);

  for (const listener of listeners(refKey(ref))) {
    listener(byteReader(view));
  }
}

function createScriptedTransport(): ScriptedTransport {
  const writes: RecordedWrite[] = [];
  const subscriptions: CharacteristicRef[] = [];
  const listeners = new Map<string, ((data: ByteReader) => void)[]>();

  const transport: BleTransport = {
    deviceName: () => "scripted",
    deviceId: () => "scripted-1",
    connect: () => Promise.resolve({ services: [] } satisfies GattProfile),
    read: () => Promise.resolve(new DataView(new ArrayBuffer(0))),
    write: (ref: CharacteristicRef, bytes: ReadOnlyBytes) => {
      writes.push({ ref, bytes });

      return Promise.resolve();
    },
    subscribe: (ref: CharacteristicRef, listener: (data: ByteReader) => void) => {
      const key = refKey(ref);
      const existing = listeners.get(key) ?? [];
      listeners.set(key, [...existing, listener]);
      subscriptions.push(ref);

      return Promise.resolve(() => {
        const current = listeners.get(key) ?? [];
        listeners.set(
          key,
          current.filter((candidate) => candidate !== listener),
        );
      });
    },
    watchAdvertisements: () => () => {},
    onDisconnected: () => () => {},
    disconnect: () => Promise.resolve(),
  };

  return {
    ...transport,
    writes: () => writes,
    subscriptions: () => subscriptions,
    respondWith(bytes) {
      respond((key) => listeners.get(key) ?? [], bytes);
    },
  };
}

describe("runBlePreset", () => {
  it("runs the full preset and waits for the response indication", async () => {
    const transport = createScriptedTransport();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const seenSteps: string[] = [];

    const running = runBlePreset({
      transport,
      preset: FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET,
      clock,
      ticker,
      onStep: (step) => {
        seenSteps.push(step.kind);
      },
    });

    await flushAsyncQueue();
    transport.respondWith(Uint8Array.from([0x80, 0x00, 0x01]));
    clock.advanceS(1);
    ticker.tick();
    await flushAsyncQueue();

    expect(transport.writes()).toHaveLength(2);
    transport.respondWith(Uint8Array.from([0x80, 0x11, 0x01]));
    ticker.tick();
    expect(await running).toBe(true);
    expect(seenSteps).toEqual(["subscribe", "write", "awaitResponse", "write", "awaitResponse"]);
    expect(transport.writes()).toHaveLength(2);
    expect(transport.subscriptions()[0]).toEqual({
      serviceUuid: FITNESS_MACHINE_SERVICE,
      characteristicUuid: FITNESS_MACHINE_CONTROL_POINT,
    });
  });
});

it("times out when the response never arrives", async () => {
  const transport = createScriptedTransport();
  const clock = createManualClock();
  const ticker = createManualTicker();
  const timedOutSteps: string[] = [];

  const running = runBlePreset({
    transport,
    preset: FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET,
    clock,
    ticker,
    onWaitTimeout: (step) => {
      timedOutSteps.push(step.kind);
    },
  });

  await flushAsyncQueue();
  clock.advanceS(3);
  ticker.tick();
  await flushAsyncQueue();

  expect(await running).toBe(false);
  expect(timedOutSteps).toEqual(["awaitResponse"]);
  expect(transport.writes()).toHaveLength(1);
});

it("ignores responses that do not match the expected prefix", async () => {
  const transport = createScriptedTransport();
  const clock = createManualClock();
  const ticker = createManualTicker();

  const running = runBlePreset({
    transport,
    preset: FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET,
    clock,
    ticker,
  });

  await flushAsyncQueue();
  transport.respondWith(Uint8Array.from([0x80, 0x00, 0x02]));
  ticker.tick();
  await flushAsyncQueue();
  transport.respondWith(Uint8Array.from([0x80, 0x00, 0x01]));
  ticker.tick();
  await flushAsyncQueue();
  transport.respondWith(Uint8Array.from([0x80, 0x11, 0x01]));
  ticker.tick();

  expect(await running).toBe(true);
});
