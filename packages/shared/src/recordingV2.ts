import { z } from "zod";

import { RiderProfileSchema } from "./profile.js";
import { withRideReference } from "./rideReference.js";

export const MAX_RECORDING_V2_BYTES = 8_388_608;
export const MAX_RECORDING_V2_ADVANCES = 500_000;
export const MAX_RECORDING_V2_INPUTS = 250_000;
export const MAX_RECORDING_V2_OBSERVATIONS = 21_602;
export const MAX_RECORDING_V2_MS = 21_600_000;

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const seq = z.number().int().nonnegative();
const workerMs = nonnegative.max(Number.MAX_SAFE_INTEGER);
const revision = z.string().min(1).max(100);
const gear = z.number().int().min(0).max(23);
const deviceKind = z.enum(["trainer", "heartRate", "controller", "keyboard"]);

const connectionStatus = z
  .enum(["disconnected", "connecting", "handshaking", "ready", "reconnecting", "error"])
  .readonly();

export const RecordingEntryV2Schema = z
  .union([
    z.tuple([seq, workerMs, z.literal("arm")]),
    z.tuple([
      seq,
      workerMs,
      z.literal("trainer"),
      nonnegative.max(2000).nullable(),
      nonnegative.max(200).nullable(),
      nonnegative.max(100).nullable(),
    ]),
    z.tuple([seq, workerMs, z.literal("hr"), finite.min(1).max(250)]),
    z.tuple([seq, workerMs, z.literal("shift"), z.enum(["shiftUp", "shiftDown"])]),
    z.tuple([seq, workerMs, z.literal("status"), deviceKind, connectionStatus]),
    z.tuple([seq, workerMs, z.literal("advance"), nonnegative.max(MAX_RECORDING_V2_MS / 1000)]),
    z.tuple([seq, workerMs, z.literal("boundary"), z.enum(["start", "sample", "finish"])]),
  ])
  .readonly();

export const ReplaySnapshotV2Schema = z
  .object({
    tS: nonnegative,
    distanceM: nonnegative,
    routePosM: nonnegative,
    lap: seq,
    speedMps: nonnegative,
    powerW: nonnegative,
    cadenceRpm: nonnegative,
    hrBpm: nonnegative.nullable(),
    gradePct: finite,
    gearIndex: gear,
    gearRatio: nonnegative,
    elevationGainM: nonnegative,
    energyKj: nonnegative,
    paused: z.boolean(),
    dataAgeS: nonnegative,
  })
  .strict()
  .readonly();

export const ReplayEventV2Schema = z
  .union([
    z.object({ type: z.literal("ride.started") }).strict(),
    z.object({ type: z.literal("gear.changed"), from: gear, to: gear }).strict(),
    z
      .object({ type: z.literal("distance.tick"), deltaM: nonnegative, deltaElevM: finite })
      .strict(),
    z
      .object({
        type: z.enum(["segment.entered", "segment.exited"]),
        segmentId: revision,
        tS: nonnegative,
      })
      .strict(),
    z.object({ type: z.literal("lap.completed"), lap: seq, tS: nonnegative }).strict(),
    z.object({ type: z.literal("ride.clockSkipped"), skippedS: nonnegative }).strict(),
  ])
  .readonly();

export const ReplayCommandV2Schema = z.union([
  z
    .object({
      type: z.literal("simulation"),
      gradePct: finite,
      windMps: finite,
      crr: finite,
      cwKgPerM: finite,
    })
    .strict(),
  z.object({ type: z.literal("targetPower"), powerW: finite }).strict(),
  z.object({ type: z.literal("resistance"), level: finite }).strict(),
]);

const observation = z
  .object({
    boundarySeq: seq,
    snapshot: ReplaySnapshotV2Schema,
    events: z.array(ReplayEventV2Schema).max(500_000).readonly(),
    commands: z.array(ReplayCommandV2Schema).max(500_000).readonly(),
    gap: z.boolean(),
  })
  .strict()
  .readonly();

const envelope = z
  .object({
    schemaVersion: z.literal(2),
    rideId: z.string().uuid(),
    initializedAt: z.string().datetime({ precision: 3 }),
    // New rides reference a world path; stored single-route rides stay readable (ADR-033 §7).
    initialization: withRideReference(
      { physicsRevision: revision },
      {
        profile: RiderProfileSchema.extend({
          bike: RiderProfileSchema.shape.bike.strict().readonly(),
        })
          .strict()
          .readonly(),
        source: z.enum(["sim", "ble"]),
        clockScale: finite.min(1).max(20),
        workerTimeOriginMs: workerMs,
        initializedWorkerMs: workerMs,
      },
      revision,
    ),
    journalState: z.enum(["complete", "incomplete"]),
    entries: z
      .array(RecordingEntryV2Schema)
      .min(3)
      .max(MAX_RECORDING_V2_ADVANCES + MAX_RECORDING_V2_INPUTS + MAX_RECORDING_V2_OBSERVATIONS + 1)
      .readonly(),
    window: z.object({ startSeq: seq, finishSeq: seq }).strict().readonly(),
    observations: z.array(observation).min(2).max(MAX_RECORDING_V2_OBSERVATIONS).readonly(),
  })
  .strict()
  .readonly();

export type RecordingEntryV2 = z.infer<typeof RecordingEntryV2Schema>;

export type ReplaySnapshotV2 = z.infer<typeof ReplaySnapshotV2Schema>;

export type ReplayObservationV2 = z.infer<typeof observation>;

function exceedsByteLimit(text: string): boolean {
  let bytes = 0;

  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;

    if (bytes > MAX_RECORDING_V2_BYTES) {
      return true;
    }
  }

  return false;
}

function validTimeline(ride: z.infer<typeof envelope>): boolean {
  let previousMs = ride.initialization.initializedWorkerMs;
  let wakeMs: number | undefined;
  let valid = true;

  for (const [index, entry] of ride.entries.entries()) {
    const [entrySeq, atMs, operation] = entry;
    valid &&=
      entrySeq === index &&
      atMs >= previousMs &&
      atMs - ride.initialization.initializedWorkerMs <= MAX_RECORDING_V2_MS;
    previousMs = atMs;

    if (operation === "arm") {
      valid &&= wakeMs === undefined;
      wakeMs = atMs;
    } else if (operation === "advance") {
      valid &&= wakeMs !== undefined && entry[3] === (atMs - wakeMs) / 1000;
      wakeMs = atMs;
    }
  }

  return valid && wakeMs !== undefined;
}

/** Count-only scan for capture capacity checks. Does not replace envelope validation. */
export function recordingV2EntryLimit(
  entries: readonly RecordingEntryV2[],
): "advances" | "inputs" | null {
  let advances = 0;
  let inputs = 0;

  for (const entry of entries) {
    if (entry[2] === "advance") advances += 1;
    else if (entry[2] !== "arm" && entry[2] !== "boundary") inputs += 1;

    if (advances > MAX_RECORDING_V2_ADVANCES) return "advances";

    if (inputs > MAX_RECORDING_V2_INPUTS) return "inputs";
  }

  return null;
}

function validBoundaries(ride: z.infer<typeof envelope>): boolean {
  const boundaries = ride.entries.filter((entry) => entry[2] === "boundary");
  const start = boundaries[0];
  const finish = boundaries.at(-1);

  if (
    start === undefined ||
    finish === undefined ||
    boundaries.length !== ride.observations.length ||
    start[0] !== ride.window.startSeq ||
    finish[0] !== ride.window.finishSeq ||
    finish[0] !== ride.entries.length - 1 ||
    finish[1] - start[1] < 1000 ||
    finish[1] - start[1] > MAX_RECORDING_V2_MS
  )
    return false;

  return boundaries.every((entry, index) => {
    const expected = index === 0 ? "start" : index === boundaries.length - 1 ? "finish" : "sample";
    const previous = boundaries[index - 1];

    return (
      entry[3] === expected &&
      entry[0] === ride.observations[index]?.boundarySeq &&
      (previous === undefined || entry[1] >= previous[1])
    );
  });
}

function validateJournal(
  ride: z.infer<typeof envelope>,
  context: Pick<z.RefinementCtx, "addIssue">,
): void {
  if (
    !validTimeline(ride) ||
    !validBoundaries(ride) ||
    recordingV2EntryLimit(ride.entries) !== null
  ) {
    context.addIssue({ code: "custom", message: "Invalid journal order, references or limits" });
  }

  if (exceedsByteLimit(JSON.stringify(ride))) {
    context.addIssue({ code: "custom", message: "Recording exceeds UTF-8 byte limit" });
  }
}

export const RecordingV2Schema = envelope.superRefine(validateJournal).readonly();

export type RecordingV2 = z.infer<typeof RecordingV2Schema>;

export function parseRecordingV2Json(
  json: string,
):
  | { readonly status: "parsed"; readonly recording: RecordingV2 }
  | { readonly status: "invalid"; readonly reason: "bytes" | "json" | "contract" } {
  if (exceedsByteLimit(json)) {
    return { status: "invalid", reason: "bytes" };
  }

  try {
    const parsed = RecordingV2Schema.safeParse(JSON.parse(json));

    return parsed.success
      ? { status: "parsed", recording: parsed.data }
      : { status: "invalid", reason: "contract" };
  } catch {
    return { status: "invalid", reason: "json" };
  }
}
