import type { ByteReader, ReadOnlyBytes } from "../bytes.js";
import { readOnlyBytes } from "../bytes.js";
import type { SimClock } from "../sim/clock.js";
import type { TickSource } from "../sim/tick.js";
import type { BleTransport, CharacteristicRef } from "../transport.js";
import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  ZWIFT_PLAY_COMMAND_RESPONSE,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_MEASUREMENT,
} from "../uuids.js";

export type BlePresetStep =
  | { readonly kind: "subscribe"; readonly ref: CharacteristicRef }
  | { readonly kind: "write"; readonly ref: CharacteristicRef; readonly bytes: ReadOnlyBytes }
  | {
      readonly kind: "awaitResponse";
      readonly ref: CharacteristicRef;
      readonly expectedPrefix: ReadOnlyBytes;
      readonly timeoutS: number;
    };

export interface BlePreset {
  readonly id: string;
  readonly label: string;
  readonly steps: readonly BlePresetStep[];
}

const ftmsControlPoint: CharacteristicRef = {
  serviceUuid: FITNESS_MACHINE_SERVICE,
  characteristicUuid: FITNESS_MACHINE_CONTROL_POINT,
};

// UNVERIFIED: docs/02-bluetooth.md#characteristics-gleiche-uuids-in-beiden-service-varianten
const playMeasurement: CharacteristicRef = {
  serviceUuid: ZWIFT_PLAY_LEGACY_SERVICE,
  characteristicUuid: ZWIFT_PLAY_MEASUREMENT,
};

const playControlPoint: CharacteristicRef = {
  serviceUuid: ZWIFT_PLAY_LEGACY_SERVICE,
  characteristicUuid: ZWIFT_PLAY_CONTROL_POINT,
};

const playCommandResponse: CharacteristicRef = {
  serviceUuid: ZWIFT_PLAY_LEGACY_SERVICE,
  characteristicUuid: ZWIFT_PLAY_COMMAND_RESPONSE,
};

/** Request Control `00`, expect `80 00 01`, then Set Indoor Bike Simulation 0 %. */
export const FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET: BlePreset = {
  id: "ftms-request-control-sim-zero",
  label: "FTMS Request Control + Sim 0 %",
  steps: [
    { kind: "subscribe", ref: ftmsControlPoint },
    {
      kind: "write",
      ref: ftmsControlPoint,
      bytes: readOnlyBytes(Uint8Array.from([0x00])),
    },
    {
      kind: "awaitResponse",
      ref: ftmsControlPoint,
      expectedPrefix: readOnlyBytes(Uint8Array.from([0x80, 0x00, 0x01])),
      timeoutS: 3,
    },
    {
      kind: "write",
      ref: ftmsControlPoint,
      bytes: readOnlyBytes(Uint8Array.from([0x11, 0x00, 0x00, 0x00, 0x00, 0x28, 0x33])),
    },
    {
      kind: "awaitResponse",
      ref: ftmsControlPoint,
      expectedPrefix: readOnlyBytes(Uint8Array.from([0x80, 0x11, 0x01])),
      timeoutS: 3,
    },
  ],
};

/** Set Indoor Bike Simulation 5 %; requires a prior successful Request Control. */
export const FTMS_SIM_FIVE_PRESET: BlePreset = {
  id: "ftms-sim-five",
  label: "FTMS Sim 5 %",
  steps: [
    { kind: "subscribe", ref: ftmsControlPoint },
    {
      kind: "write",
      ref: ftmsControlPoint,
      bytes: readOnlyBytes(Uint8Array.from([0x11, 0x00, 0x00, 0xf4, 0x01, 0x28, 0x33])),
    },
    {
      kind: "awaitResponse",
      ref: ftmsControlPoint,
      expectedPrefix: readOnlyBytes(Uint8Array.from([0x80, 0x11, 0x01])),
      timeoutS: 3,
    },
  ],
};

/**
 * Zwift Play handshake: subscribe 0x...02 and 0x...04, write the cleartext
 * "RideOn" to 0x...03. A 64-byte answer means the encrypted path; the sniffer
 * documents it instead of continuing (docs/02-bluetooth.md section 4).
 */
export const ZWIFT_PLAY_HANDSHAKE_PRESET: BlePreset = {
  id: "zwift-play-handshake",
  label: "Zwift-Controller-Handshake",
  steps: [
    { kind: "subscribe", ref: playMeasurement },
    { kind: "subscribe", ref: playCommandResponse },
    {
      kind: "write",
      ref: playControlPoint,
      bytes: readOnlyBytes(Uint8Array.from([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e])),
    },
  ],
};

export const SNIFFER_PRESETS: readonly BlePreset[] = [
  FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET,
  FTMS_SIM_FIVE_PRESET,
  ZWIFT_PLAY_HANDSHAKE_PRESET,
];

export interface RunBlePresetOptions {
  readonly transport: BleTransport;
  readonly preset: BlePreset;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  /** Called before each step; the sniffer logs preset progress here. */
  readonly onStep?: (step: BlePresetStep) => void;
  /** Called instead of failing when an awaited response never arrives. */
  readonly onWaitTimeout?: (step: BlePresetStep) => void;
}

function bytesStartWith(data: ByteReader, prefix: ReadOnlyBytes): boolean {
  if (data.byteLength < prefix.length) {
    return false;
  }

  let index = 0;

  while (index < prefix.length) {
    if (data.getUint8(index) !== (prefix.at(index) ?? -1)) {
      return false;
    }

    index += 1;
  }

  return true;
}

function awaitPresetResponse(
  response: () => ByteReader | undefined,
  step: Extract<BlePresetStep, { kind: "awaitResponse" }>,
  clock: SimClock,
  ticker: TickSource,
): Promise<boolean> {
  const deadlineS = clock.nowS() + step.timeoutS;

  return new Promise<boolean>((resolve) => {
    const stopTick = ticker.start(() => {
      const data = response();

      if (data !== undefined && bytesStartWith(data, step.expectedPrefix)) {
        stopTick();
        resolve(true);

        return;
      }

      if (clock.nowS() >= deadlineS) {
        stopTick();
        resolve(false);
      }
    });
  });
}

interface PresetResponses {
  readonly latest: (ref: CharacteristicRef) => ByteReader | undefined;
  readonly receive: (ref: CharacteristicRef, data: ByteReader) => void;
  readonly clear: (ref: CharacteristicRef) => void;
  readonly subscribed: (stop: () => void) => void;
}

async function runPresetStep(
  options: RunBlePresetOptions,
  step: BlePresetStep,
  responses: PresetResponses,
): Promise<boolean> {
  options.onStep?.(step);

  if (step.kind === "subscribe") {
    const stop = await options.transport.subscribe(step.ref, (data) => {
      responses.receive(step.ref, data);
    });

    responses.subscribed(stop);

    return true;
  }

  if (step.kind === "write") {
    responses.clear(step.ref);
    await options.transport.write(step.ref, step.bytes);

    return true;
  }

  const matched = await awaitPresetResponse(
    () => responses.latest(step.ref),
    step,
    options.clock,
    options.ticker,
  );

  if (!matched) {
    options.onWaitTimeout?.(step);
  }

  return matched;
}

function responseKey(ref: CharacteristicRef): string {
  return `${ref.serviceUuid}/${ref.characteristicUuid}`;
}

export function runBlePreset(options: RunBlePresetOptions): Promise<boolean> {
  const replies = new Map<string, ByteReader>();
  const stops: (() => void)[] = [];

  const responses: PresetResponses = {
    subscribed: (stop) => {
      stops.push(stop);
    },
    latest: (ref) => replies.get(responseKey(ref)),
    receive: (ref, data) => {
      replies.set(responseKey(ref), data);
    },
    clear: (ref) => {
      replies.delete(responseKey(ref));
    },
  };

  const runFrom = async (index: number): Promise<boolean> => {
    const step = options.preset.steps[index];

    if (step === undefined) {
      return true;
    }

    const matched = await runPresetStep(options, step, responses);

    return matched ? runFrom(index + 1) : false;
  };

  return runFrom(0).finally(() => {
    for (const stop of stops) {
      stop();
    }
  });
}
