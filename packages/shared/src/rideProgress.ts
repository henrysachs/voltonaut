import { z } from "zod";

import { withRideReference, type RideReference } from "./rideReference.js";

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestampMs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = z.string().min(1).max(100);

/** Effective raw readings and local physics contributions from one native engine tick. */
export const NativeTickFactsSchema = z
  .object({
    powerW: finite,
    cadenceRpm: nonnegative,
    timeS: nonnegative.max(0.05),
    distanceM: nonnegative,
    elevationGainM: nonnegative,
    energyKj: finite,
  })
  .strict()
  .readonly();

export type NativeTickFacts = z.infer<typeof NativeTickFactsSchema>;

export const RideProgressPhysicsSchema = z
  .object({
    massKg: finite.positive(),
    bikeMassKg: nonnegative,
    cdaM2: finite.positive(),
    crr: nonnegative,
    wheelCircM: finite.positive(),
  })
  .strict()
  .readonly();

const qualitySchema = z
  .object({
    paused: z.boolean(),
    dataAgeS: nonnegative,
    clockSkipped: z.boolean(),
  })
  .strict()
  .readonly();

// The ride reference (ADR-033 §7) sits between these field groups in withRideReference.
const progressHead = {
  journalId: z.string().uuid().toLowerCase(),
  startedAtMs: timestampMs,
  endedAtMs: timestampMs,
  source: z.enum(["sim", "ble"]),
  clockScale: finite.min(1).max(20),
  physicsRevision: revision,
};

const progressTail = {
  physics: RideProgressPhysicsSchema,
  facts: z.array(NativeTickFactsSchema).max(120).readonly(),
  quality: qualitySchema,
};

const inputSchema = withRideReference(progressHead, progressTail, revision).refine(
  (input) => input.endedAtMs >= input.startedAtMs,
  {
    message: "Progress end time must not precede its start time",
    path: ["endedAtMs"],
  },
);

export type RideProgressCheckpointInput = z.infer<typeof inputSchema>;

export type RideProgressMetadata = Pick<
  RideProgressCheckpointInput,
  "journalId" | "source" | "clockScale" | "physicsRevision" | "physics"
> &
  RideReference;

const checkpointEnvelopeSchema = withRideReference(
  { schemaVersion: z.literal(1), ...progressHead },
  {
    ...progressTail,
    sequence: tick,
    startTick: tick,
    endTick: tick,
    facts: z.array(NativeTickFactsSchema).min(1).max(120).readonly(),
  },
  revision,
);

/** One immutable, bounded projection of the native facts consumed by one wake. */
export const RideProgressCheckpointSchema = checkpointEnvelopeSchema
  .refine((checkpoint) => checkpoint.endTick === checkpoint.startTick + checkpoint.facts.length, {
    message: "Progress end tick must equal start tick plus fact count",
    path: ["endTick"],
  })
  .refine((checkpoint) => checkpoint.endedAtMs >= checkpoint.startedAtMs, {
    message: "Progress end time must not precede its start time",
    path: ["endedAtMs"],
  });

export type RideProgressCheckpoint = z.infer<typeof RideProgressCheckpointSchema>;

export interface RideProgressProjector {
  readonly push: (input: RideProgressCheckpointInput) => RideProgressCheckpoint | undefined;
}

/** Creates a deterministic journal projection with no clock, storage or account authority. */
export function createRideProgressProjector(): RideProgressProjector {
  let sequence = 0;
  let nextTick = 0;

  return {
    push: (input) => {
      const parsed = inputSchema.parse(input);

      const checkpoint =
        parsed.facts.length === 0
          ? undefined
          : RideProgressCheckpointSchema.parse({
              ...parsed,
              schemaVersion: 1,
              sequence,
              startTick: nextTick,
              endTick: nextTick + parsed.facts.length,
            });

      if (checkpoint !== undefined) {
        sequence += 1;
        nextTick = checkpoint.endTick;
      }

      return checkpoint;
    },
  };
}
