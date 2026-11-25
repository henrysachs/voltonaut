import type { DeviceEvent, RecordingEntryV2 } from "@voltonaut/shared";

/** Readings the journal contract cannot hold; each one makes the journal unverifiable. */
export type RejectedReading = "powerW" | "cadenceRpm" | "speedMps" | "hrBpm";

export type IgnoredInputReason =
  /** The engine does not read this event, so replay needs no entry. */
  | "no_engine_effect"
  /** Only modes without journal replay react (ADR-028); entering one invalidates capture. */
  | "unrecordable_mode_intent";

/**
 * Journal decision for one accepted device event. Entries carry sequence 0;
 * the journal assigns the real sequence on append.
 */
export type JournalInputDecision =
  | {
      readonly kind: "entry";
      readonly entry: RecordingEntryV2;
      readonly rejected: readonly RejectedReading[];
    }
  | { readonly kind: "rejected"; readonly rejected: readonly RejectedReading[] }
  | { readonly kind: "ignored"; readonly reason: IgnoredInputReason };

// Contract limits of RecordingEntryV2Schema in packages/shared.
const MAX_POWER_W = 2000;
const MAX_CADENCE_RPM = 200;
const MAX_SPEED_MPS = 100;
const MIN_HR_BPM = 1;
const MAX_HR_BPM = 250;

const NO_ENGINE_EFFECT: JournalInputDecision = Object.freeze({
  kind: "ignored",
  reason: "no_engine_effect",
});

function journalReading(value: number | undefined, max: number): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

function entry(journalEntry: RecordingEntryV2): JournalInputDecision {
  return { kind: "entry", entry: journalEntry, rejected: [] };
}

function encodeTrainer(
  event: Extract<DeviceEvent, { readonly type: "trainer.data" }>,
  atMs: number,
): JournalInputDecision {
  const power = journalReading(event.powerW, MAX_POWER_W);
  const cadence = journalReading(event.cadenceRpm, MAX_CADENCE_RPM);
  const speed = journalReading(event.speedMps, MAX_SPEED_MPS);
  const rejected: RejectedReading[] = [];

  if (event.powerW !== undefined && power === null) rejected.push("powerW");

  if (event.cadenceRpm !== undefined && cadence === null) rejected.push("cadenceRpm");

  if (event.speedMps !== undefined && speed === null) rejected.push("speedMps");

  return { kind: "entry", entry: [0, atMs, "trainer", power, cadence, speed], rejected };
}

function encodeButton(
  event: Extract<DeviceEvent, { readonly type: "controller.button" }>,
  atMs: number,
): JournalInputDecision {
  if (!event.pressed) return NO_ENGINE_EFFECT;

  switch (event.button) {
    case "shiftUp":
    case "shiftDown":
      return entry([0, atMs, "shift", event.button]);
    case "powerUp":
      return { kind: "ignored", reason: "unrecordable_mode_intent" };
    case "navUp":
    case "navDown":
    case "navLeft":
    case "navRight":
    case "confirm":
    case "back":
    case "brake":
      return NO_ENGINE_EFFECT;
    default: {
      const exhaustive: never = event.button;

      return exhaustive;
    }
  }
}

/** Translates one device event the engine accepts into its Fahrtjournal decision. */
export function encodeJournalInput(event: DeviceEvent, atMs: number): JournalInputDecision {
  switch (event.type) {
    case "trainer.data":
      return encodeTrainer(event, atMs);
    case "hr.data":
      return Number.isFinite(event.bpm) && event.bpm >= MIN_HR_BPM && event.bpm <= MAX_HR_BPM
        ? entry([0, atMs, "hr", event.bpm])
        : { kind: "rejected", rejected: ["hrBpm"] };
    case "device.status":
      return entry([0, atMs, "status", event.kind, event.status]);
    case "controller.button":
      return encodeButton(event, atMs);
    case "controller.battery":
    case "trainer.controlResult":
      return NO_ENGINE_EFFECT;
    default: {
      const exhaustive: never = event;

      return exhaustive;
    }
  }
}
