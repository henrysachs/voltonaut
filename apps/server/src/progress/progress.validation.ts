import { createHash } from "node:crypto";

import { isXpActive } from "@voltonaut/rules";
import {
  JournalIdSchema,
  ProgressCheckpointBatchSchema,
  RewardEffortSchema,
  RewardFactsSchema,
  VoltsRewardDaySchema,
  type ErrorCode,
  type JournalId,
  type ProgressCheckpointBatch,
  type RewardFacts,
  type RideProgressCheckpoint,
  type RideProgressMetadata,
  type VoltsRewardDay,
} from "@voltonaut/shared";

import { ApiError } from "../api-error.js";

const MAX_FACT_COUNT = 1200;
const MAX_DATA_AGE_S = 2.5;
const ENERGY_TOLERANCE_KJ = 1e-6;
const MAX_FUTURE_INTAKE_MS = 5 * 60_000;
const MAX_LATE_INTAKE_MS = 7 * 24 * 60 * 60_000;

export type ValidatedProgressMetadata = Readonly<
  Omit<RideProgressMetadata, "journalId" | "source" | "clockScale"> & {
    journalId: JournalId;
    source: "ble";
    clockScale: 1;
  }
>;

export type ValidatedProgressRange = Readonly<{
  metadata: ValidatedProgressMetadata;
  startSequence: number;
  endSequence: number;
  startTick: number;
  endTick: number;
  startedAtMs: number;
  endedAtMs: number;
  rewardDay: VoltsRewardDay;
  deltaFacts: RewardFacts;
}>;

export type ValidatedProgressBatch = Readonly<{
  payload: ProgressCheckpointBatch;
  checkpoints: readonly RideProgressCheckpoint[];
  range: ValidatedProgressRange;
}>;

export const ZERO_PROGRESS_FACTS = RewardFactsSchema.parse({
  activeDistanceM: 0,
  activeElevationGainM: 0,
  activeTimeS: 0,
  elevationGainM: 0,
  energyKj: 0,
});

export function progressError(status: number, code: ErrorCode, message: string): ApiError {
  return new ApiError(status, code, message);
}

export function progressPayloadHash(payload: Readonly<ProgressCheckpointBatch>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function invalid(message: string): never {
  throw progressError(422, "validation_failed", message);
}

function sourceRejected(message: string): never {
  throw progressError(422, "progress_source_rejected", message);
}

function hasSamePhysics(
  left: Readonly<RideProgressMetadata["physics"]>,
  right: Readonly<RideProgressMetadata["physics"]>,
): boolean {
  return (
    left.massKg === right.massKg &&
    left.bikeMassKg === right.bikeMassKg &&
    left.cdaM2 === right.cdaM2 &&
    left.crr === right.crr &&
    left.wheelCircM === right.wheelCircM
  );
}

function hasSameMetadata(
  left: Readonly<RideProgressMetadata>,
  right: Readonly<RideProgressMetadata>,
): boolean {
  return (
    left.journalId === right.journalId &&
    left.source === right.source &&
    left.clockScale === right.clockScale &&
    left.physicsRevision === right.physicsRevision &&
    left.routeId === right.routeId &&
    left.routeRevision === right.routeRevision &&
    hasSamePhysics(left.physics, right.physics)
  );
}

function metadataFrom(first: Readonly<RideProgressCheckpoint>): ValidatedProgressMetadata {
  return {
    journalId: JournalIdSchema.parse(first.journalId),
    source: "ble",
    clockScale: 1,
    physicsRevision: first.physicsRevision,
    routeId: first.routeId,
    routeRevision: first.routeRevision,
    physics: first.physics,
  };
}

function validateCheckpointQuality(checkpoint: Readonly<RideProgressCheckpoint>): void {
  if (checkpoint.source !== "ble") sourceRejected("simulated progress is not accepted");

  if (checkpoint.clockScale !== 1) sourceRejected("scaled progress clocks are not accepted");

  if (checkpoint.quality.clockSkipped) sourceRejected("progress clock skips are not accepted");

  if (checkpoint.quality.dataAgeS > MAX_DATA_AGE_S) {
    sourceRejected("progress trainer data is stale");
  }

  if (!checkpoint.quality.paused && checkpoint.facts.some((fact) => fact.timeS === 0)) {
    invalid("an unpaused progress checkpoint cannot contain paused ticks");
  }
}

function validateFact(fact: Readonly<RideProgressCheckpoint["facts"][number]>): void {
  if (fact.timeS !== 0 && fact.timeS !== 0.05) {
    invalid("progress tick time must be zero or 0.05 seconds");
  }

  if (fact.powerW < 0 || fact.powerW > 2000) {
    invalid("progress power is outside the accepted range");
  }

  if (fact.cadenceRpm < 0 || fact.cadenceRpm > 200) {
    invalid("progress cadence is outside the accepted range");
  }

  if (fact.energyKj < 0) invalid("progress energy must not be negative");

  const expectedEnergyKj = (fact.powerW * fact.timeS) / 1000;

  if (Math.abs(fact.energyKj - expectedEnergyKj) > ENERGY_TOLERANCE_KJ) {
    invalid("progress energy does not match power and tick time");
  }

  if (
    fact.timeS === 0 &&
    (fact.distanceM !== 0 || fact.elevationGainM !== 0 || fact.energyKj !== 0)
  ) {
    invalid("paused progress ticks must have zero deltas");
  }
}

function validateChain(
  checkpoints: readonly RideProgressCheckpoint[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- ValidatedProgressMetadata is a readonly alias.
  metadata: ValidatedProgressMetadata,
): void {
  let previous: RideProgressCheckpoint | undefined;
  let factCount = 0;

  for (const checkpoint of checkpoints) {
    validateCheckpointQuality(checkpoint);

    if (
      !Number.isSafeInteger(checkpoint.startedAtMs) ||
      !Number.isSafeInteger(checkpoint.endedAtMs)
    ) {
      invalid("progress checkpoint times must be safe integer milliseconds");
    }

    if (!hasSameMetadata(metadata, checkpoint)) {
      invalid("progress checkpoint metadata must remain unchanged");
    }

    if (previous !== undefined) {
      if (checkpoint.sequence !== previous.sequence + 1) {
        invalid("progress checkpoint sequence must increase by one");
      }

      if (checkpoint.startTick !== previous.endTick) {
        invalid("progress checkpoints must be tick-contiguous");
      }

      if (checkpoint.startedAtMs < previous.endedAtMs) {
        invalid("progress checkpoint times must not move backwards");
      }
    }

    factCount += checkpoint.facts.length;

    if (factCount > MAX_FACT_COUNT) invalid("progress batch exceeds 1200 facts");
    previous = checkpoint;
  }
}

function aggregateFacts(checkpoints: readonly RideProgressCheckpoint[]): RewardFacts {
  let energyKj = 0;
  let elevationGainM = 0;
  let activeDistanceM = 0;
  let activeElevationGainM = 0;
  let activeTimeS = 0;

  for (const checkpoint of checkpoints) {
    for (const fact of checkpoint.facts) {
      validateFact(fact);
      energyKj += fact.energyKj;
      elevationGainM += fact.elevationGainM;

      const effort = RewardEffortSchema.parse({ powerW: fact.powerW, cadenceRpm: fact.cadenceRpm });

      if (isXpActive(effort)) {
        activeDistanceM += fact.distanceM;
        activeElevationGainM += fact.elevationGainM;
        activeTimeS += fact.timeS;
      }
    }
  }

  const aggregate = RewardFactsSchema.safeParse({
    activeDistanceM,
    activeElevationGainM,
    activeTimeS,
    elevationGainM,
    energyKj,
  });

  if (!aggregate.success) invalid("progress reward facts exceed accepted limits");

  return aggregate.data;
}

function rewardDayAt(endedAtMs: number): VoltsRewardDay {
  const date = new Date(endedAtMs);

  if (Number.isNaN(date.getTime())) invalid("progress end time is outside the UTC date range");

  const parsed = VoltsRewardDaySchema.safeParse(date.toISOString().slice(0, 10));

  if (!parsed.success) invalid("progress end time has no accepted UTC reward day");

  return parsed.data;
}

/** Validates transport eligibility and derives reward facts without account or storage authority. */
export function validateProgressBatch(
  batch: ProgressCheckpointBatch,
  nowMs: number,
): ValidatedProgressBatch {
  const parsed = ProgressCheckpointBatchSchema.safeParse(batch);

  if (!parsed.success) invalid("invalid progress checkpoint batch");

  const first = parsed.data.checkpoints[0];
  const last = parsed.data.checkpoints.at(-1);

  if (first === undefined || last === undefined) invalid("progress batch has no checkpoints");

  if (last.endedAtMs > nowMs + MAX_FUTURE_INTAKE_MS) {
    invalid("progress end time is too far in the future");
  }

  if (last.endedAtMs < nowMs - MAX_LATE_INTAKE_MS) {
    invalid("progress end time is older than the late-delivery window");
  }

  const metadata = metadataFrom(first);

  if (first.startTick === 0 && first.sequence !== 0) {
    invalid("the first progress checkpoint must use sequence zero");
  }

  validateChain(parsed.data.checkpoints, metadata);

  const range: ValidatedProgressRange = Object.freeze({
    metadata: Object.freeze(metadata),
    startSequence: first.sequence,
    endSequence: last.sequence,
    startTick: first.startTick,
    endTick: last.endTick,
    startedAtMs: first.startedAtMs,
    endedAtMs: last.endedAtMs,
    rewardDay: rewardDayAt(last.endedAtMs),
    deltaFacts: aggregateFacts(parsed.data.checkpoints),
  });

  return Object.freeze({
    payload: parsed.data,
    checkpoints: parsed.data.checkpoints,
    range,
  });
}
