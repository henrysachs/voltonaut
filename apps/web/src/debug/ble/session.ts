import {
  byteReader,
  bytesToDataView,
  readerBytes,
  toAscii,
  toHex,
  decodeLabFrame,
  isEncryptedHandshakeReply,
  ZWIFT_PLAY_COMMAND_RESPONSE,
  type BleFixture,
  type BleLogEntry,
  type BleTransport,
  type ByteReader,
  type CharacteristicRef,
  type GattProfile,
} from "@voltonaut/ble";
import { SnifferObservations } from "./observations.js";

export interface SnifferSession {
  readonly transport: BleTransport;
  readonly fixture: (firmware: string, notes: string) => BleFixture;
  readonly marker: (text: string) => void;
  /** Lab-generated note (e.g. a failed automatic read); never counted as a user marker. */
  readonly note: (text: string) => void;
  readonly dispose: () => Promise<void>;
  readonly observe: (ref: CharacteristicRef) => Promise<void>;
  readonly unobserve: (ref: CharacteristicRef) => void;
  readonly isObserving: (ref: CharacteristicRef) => boolean;
}

function exportGatt(profile: GattProfile): BleFixture["gatt"] {
  return profile.services.map((service) => ({
    service: service.uuid,
    characteristics: service.characteristics.map((characteristic) => ({
      char: characteristic.uuid,
      properties: characteristic.properties,
      descriptors: characteristic.descriptors,
    })),
  }));
}

interface Recorder {
  readonly data: (ref: CharacteristicRef, data: ByteReader, dir: "rx" | "tx") => void;
  readonly event: (event: string, marker: string) => void;
  readonly entries: () => readonly BleLogEntry[];
  readonly encrypted: () => boolean;
}

function captureClock(nowMs: () => number): () => number {
  const startedMs = nowMs();
  let elapsedMs = 0;

  return () => {
    elapsedMs = Math.max(elapsedMs, nowMs() - startedMs);

    return elapsedMs;
  };
}

function createRecorder(raw: BleTransport, changed: () => void, nowMs: () => number): Recorder {
  const log: BleLogEntry[] = [];
  let encrypted = false;
  const timestamp = captureClock(nowMs);

  const event = (name: string, marker: string): void => {
    log.push({
      kind: "event",
      tMs: timestamp(),
      device: raw.deviceName(),
      event: name,
      marker,
    });
    changed();
  };

  return {
    entries: () => log,
    encrypted: () => encrypted,
    event,
    data(ref, data, dir) {
      const bytes = readerBytes(data);
      log.push({
        kind: "data",
        tMs: timestamp(),
        device: raw.deviceName(),
        service: ref.serviceUuid,
        char: ref.characteristicUuid,
        dir,
        hex: toHex(bytes),
        ascii: toAscii(bytes),
        decoded: decodeLabFrame(ref, data),
        marker: "",
      });

      if (
        ref.characteristicUuid === ZWIFT_PLAY_COMMAND_RESPONSE &&
        isEncryptedHandshakeReply(data)
      ) {
        encrypted = true;
        event(
          "encrypted-handshake",
          "Stop: 64-Byte-Key. H5 dokumentieren; kein verschlüsselter Pfad in E1.",
        );
      }

      changed();
    },
  };
}

function createLoggedTransport(raw: BleTransport, recorder: Recorder): BleTransport {
  return {
    ...raw,
    async disconnect() {
      await raw.disconnect();
      recorder.event("disconnected-manual", "");
    },
    async read(ref) {
      const view = await raw.read(ref);
      recorder.data(ref, byteReader(view), "rx");

      return view;
    },
    async write(ref, bytes, mode) {
      if (recorder.encrypted()) {
        throw new Error("Encrypted handshake: writes stopped. Export capture for H5.");
      }

      await raw.write(ref, bytes, mode);
      recorder.data(ref, bytesToDataView(bytes), "tx");
    },
  };
}

function fixtureMeta(raw: BleTransport, firmware: string, notes: string): BleFixture["meta"] {
  return {
    schemaVersion: 1,
    ua: navigator.userAgent,
    date: new Date().toISOString(),
    deviceName: raw.deviceName(),
    deviceId: raw.deviceId(),
    firmware,
    protocol: "raw",
    notes,
  };
}

function annotations(recorder: Recorder): Pick<SnifferSession, "marker" | "note"> {
  return {
    marker: (text) => {
      recorder.event("marker", text);
    },
    note: (text) => {
      recorder.event("auto-capture-failed", text);
    },
  };
}

export function createSnifferSession(
  raw: BleTransport,
  changed: () => void,
  nowMs: () => number = () => performance.now(),
): SnifferSession {
  let profile: GattProfile = { services: [] };
  const recorder = createRecorder(raw, changed, nowMs);
  const logged = createLoggedTransport(raw, recorder);

  const subscriptions = new SnifferObservations(raw, recorder.data, changed);

  const stopDisconnected = raw.onDisconnected(() => {
    subscriptions.clear();
    recorder.event("disconnected", "");
  });

  return {
    transport: {
      ...logged,
      subscribe: subscriptions.subscribe,
      async disconnect() {
        subscriptions.clear();
        await logged.disconnect();
      },
      async connect(scan, selection) {
        subscriptions.clear();
        profile = await logged.connect(scan, selection);
        recorder.event("connected", "");

        return profile;
      },
    },
    observe: subscriptions.observe,
    unobserve: subscriptions.unobserve,
    isObserving: subscriptions.isObserving,
    async dispose() {
      subscriptions.clear();
      stopDisconnected();
      await raw.disconnect();
    },
    ...annotations(recorder),
    fixture: (firmware, notes) => ({
      meta: fixtureMeta(raw, firmware, notes),
      gatt: exportGatt(profile),
      log: recorder.entries(),
    }),
  };
}
