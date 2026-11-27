import clickCapture from "../../../../fixtures/ble/zwift-click-v2-right-hardware-20261127.json" with { type: "json" };
import hubCapture from "../../../../fixtures/ble/zwift-hub-one-hardware-20261127.json" with { type: "json" };
import type { DeviceEvent } from "@voltonaut/shared";
import { bytesToDataView, parseHex, type ByteReader } from "../bytes.js";
import { parseBleFixtureJson, type BleFixture } from "../fixtureSchema.js";
import {
  parseClickV2Input,
  parseControlResponse,
  parseFitnessMachineFeature,
  parseIndoorBikeData,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  INDOOR_BIKE_DATA,
  ZWIFT_PLAY_MEASUREMENT,
  type ClickV2Button,
  type GattProfile,
} from "../index.js";

/** Genuine captures of 27.11.2026 (fixtures/ble/zwift-hub-click-hardware-20261127.md). */
function parsed(text: string): BleFixture {
  const result = parseBleFixtureJson(text);

  if (!result.ok) throw new Error(result.failure.reason);

  return result.value;
}

export const HUB_CAPTURE = parsed(JSON.stringify(hubCapture));

export const CLICK_CAPTURE = parsed(JSON.stringify(clickCapture));

interface MarkedFrame {
  readonly marker: string;
  readonly data: ByteReader;
}

/** Received frames of one characteristic with the marker set before each. */
function rxFrames(capture: BleFixture, char: string): readonly MarkedFrame[] {
  const frames: MarkedFrame[] = [];
  let marker = "";

  for (const entry of capture.log) {
    if (entry.kind === "event" && entry.event === "marker") marker = entry.marker;

    const bytes =
      entry.kind === "data" && entry.dir === "rx" && entry.char === char
        ? parseHex(entry.hex)
        : undefined;

    if (bytes !== undefined) frames.push({ marker, data: bytesToDataView(bytes) });
  }

  return frames;
}

export interface HubSummary {
  readonly machineDwordHex: string | undefined;
  readonly simulation: boolean;
  readonly bikeFrames: number;
  readonly bikeParseFailures: number;
  readonly maxPowerW: number;
  readonly maxCadenceRpm: number;
  /** `opcode:result` of every control-point response, in order. */
  readonly responses: readonly string[];
}

export function summarizeHub(capture: BleFixture): HubSummary {
  const feature = rxFrames(capture, FITNESS_MACHINE_FEATURE)
    .map((frame) => parseFitnessMachineFeature(frame.data))
    .find((result) => result.ok);

  const samples = rxFrames(capture, INDOOR_BIKE_DATA).map((frame) =>
    parseIndoorBikeData(frame.data),
  );

  const values = samples.flatMap((sample) => (sample.ok ? [sample.value] : []));

  return {
    machineDwordHex: feature?.ok === true ? feature.value.machineDwordHex : undefined,
    simulation:
      feature?.ok === true &&
      feature.value.targetFeatures.includes("indoorBikeSimulationParameters"),
    bikeFrames: samples.length,
    bikeParseFailures: samples.length - values.length,
    maxPowerW: Math.max(...values.map((value) => value.powerW ?? 0)),
    maxCadenceRpm: Math.max(...values.map((value) => value.cadenceRpm ?? 0)),
    responses: rxFrames(capture, FITNESS_MACHINE_CONTROL_POINT).flatMap((frame) => {
      const response = parseControlResponse(frame.data);

      return response.ok ? [`${response.value.opcode}:${response.value.result}`] : [];
    }),
  };
}

export interface ClickSummary {
  readonly frames: number;
  readonly parseFailures: number;
  /** Distinct buttons pressed after each marker, sorted. */
  readonly pressedByMarker: ReadonlyMap<string, readonly ClickV2Button[]>;
}

export function summarizeClick(capture: BleFixture): ClickSummary {
  const frames = rxFrames(capture, ZWIFT_PLAY_MEASUREMENT);
  const pressedByMarker = new Map<string, readonly ClickV2Button[]>();
  let failures = 0;

  for (const frame of frames) {
    const result = parseClickV2Input(frame.data);

    if (result.ok) {
      const known = new Set([
        ...(pressedByMarker.get(frame.marker) ?? []),
        ...result.value.pressed,
      ]);

      pressedByMarker.set(frame.marker, [...known].toSorted());
    } else {
      failures += 1;
    }
  }

  return { frames: frames.length, parseFailures: failures, pressedByMarker };
}

export function firstWriteMs(capture: BleFixture): number {
  return capture.log.find((entry) => entry.kind === "data" && entry.dir === "tx")?.tMs ?? 0;
}

export function captureProfile(capture: BleFixture): GattProfile {
  return {
    services: capture.gatt.map((service) => ({
      uuid: service.service,
      characteristics: service.characteristics.map((characteristic) => ({
        uuid: characteristic.char,
        properties: characteristic.properties,
        descriptors: characteristic.descriptors,
      })),
    })),
  };
}

/** `shiftUp:true`-style labels of the controller button events. */
export function buttonTrail(events: readonly DeviceEvent[]): readonly string[] {
  return events.flatMap((event) =>
    event.type === "controller.button" ? [`${event.button}:${String(event.pressed)}`] : [],
  );
}
