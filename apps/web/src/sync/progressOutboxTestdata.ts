/* oxlint-disable typescript/prefer-readonly-parameter-types -- Test fixture inputs are readonly contracts; Oxlint does not follow imported aliases. */
import {
  JournalIdSchema,
  VoltsRideRangeReceiptSchema,
  type RideProgressCheckpoint,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";

import { LocalProgressBatchSchema, type ProgressBatch } from "./progressBatch.js";
import {
  PROGRESS_OUTBOX_MAX_ROWS,
  type ProgressJournalOwner,
  type ProgressOutboxRow,
} from "./progressOutboxSchema.js";
import { newProgressOutboxRow, progressOutboxKey } from "./progressOutboxRow.js";
import type { ProgressAppendResult, ProgressOutbox, ProgressWriteFence } from "./progressOutbox.js";
import type { MemoryOutboxDatabase } from "./progressOutboxMemoryDatabase.js";

export { MemoryOutboxDatabase } from "./progressOutboxMemoryDatabase.js";

export const origin = "http://localhost:3000";
export const userA = "00000000-0000-4000-8000-000000000001";
export const userB = "00000000-0000-4000-8000-000000000002";
export const journalId = JournalIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");
export const owner: ProgressJournalOwner = { apiOrigin: origin, userId: userA, journalId };

export function fence(overrides: Readonly<Partial<ProgressWriteFence>> = {}): ProgressWriteFence {
  const controller = new AbortController();

  return {
    ...owner,
    consentVersion: 1,
    sessionGeneration: 1,
    signal: controller.signal,
    current: () => true,
    ...overrides,
  };
}

export interface CheckpointOptions {
  readonly sequence?: number;
  readonly startTick?: number;
  readonly paused?: boolean;
  readonly source?: "ble" | "sim";
  readonly id?: string;
}

export function checkpoint(options: Readonly<CheckpointOptions> = {}): RideProgressCheckpoint {
  const { sequence = 0, startTick = 0, paused = false, source = "ble", id = journalId } = options;
  const startedAtMs = 1000 + startTick * 50;

  return {
    schemaVersion: 1,
    journalId: id,
    sequence,
    startTick,
    endTick: startTick + 1,
    startedAtMs,
    endedAtMs: startedAtMs + 50,
    source,
    clockScale: 1,
    physicsRevision: "engine-v1",
    worldId: "flat-loop",
    worldRevision: "1",
    pathId: "flat-loop",
    physics: {
      massKg: 75,
      bikeMassKg: 8,
      cdaM2: 0.32,
      crr: 0.004,
      wheelCircM: 2.105,
    },
    facts: [
      {
        powerW: 200,
        cadenceRpm: 90,
        timeS: 0.05,
        distanceM: startTick + 1,
        elevationGainM: 0,
        energyKj: 0.01,
      },
    ],
    quality: { paused, dataAgeS: 0, clockSkipped: false },
  };
}

export function batch(
  checkpoints: readonly RideProgressCheckpoint[],
  consentVersion = 1,
  sessionGeneration = 1,
): ProgressBatch {
  return LocalProgressBatchSchema.parse({ consentVersion, sessionGeneration, checkpoints });
}

export function receipt(
  row: Readonly<ProgressOutboxRow>,
  startTick = row.startTick,
  endTick = row.endTick,
): VoltsRideRangeReceipt {
  return VoltsRideRangeReceiptSchema.parse({
    entryId: "123e4567-e89b-42d3-a456-426614174001",
    journalId: row.journalId,
    startTick,
    endTick,
    rewardDay: "2026-11-25",
    cumulativeWorkVolts: 1,
    cumulativeClimbVolts: 0,
    candidateVolts: 1,
    awardedVolts: 1,
    withheldVolts: 0,
  });
}

export function requireAppendedRow(result: Readonly<ProgressAppendResult>): ProgressOutboxRow {
  if (result.kind !== "stored") throw new Error("Expected stored progress rows");
  const row = result.rows[0];

  if (row === undefined) throw new Error("Missing progress row");

  return row;
}

export function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing required value");

  return value;
}

export async function appendSealed(
  outbox: Readonly<ProgressOutbox>,
  value: RideProgressCheckpoint,
  writeFence: ProgressWriteFence = fence(),
): Promise<ProgressOutboxRow> {
  await outbox.append(writeFence, value);
  const sealed = await outbox.seal(writeFence);

  if (sealed === undefined) throw new Error("Missing sealed progress row");

  return sealed;
}

export function seedRows(
  memory: Readonly<MemoryOutboxDatabase>,
  count: number,
  startIndex = 0,
): void {
  for (let index = startIndex; index < startIndex + count; index += 1) {
    const id = JournalIdSchema.parse(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    memory.seed(
      newProgressOutboxRow({
        owner: { ...owner, journalId: id },
        consentVersion: 1,
        sessionGeneration: 1,
        batch: batch([checkpoint({ id })]),
        phase: "sealed",
      }),
    );
  }
}

export function seedCapacity(memory: Readonly<MemoryOutboxDatabase>): (string | number)[] {
  seedRows(memory, PROGRESS_OUTBOX_MAX_ROWS);
  const first = memory.raw()[0];

  if (first === undefined) throw new Error("Capacity seed is empty");

  return [...progressOutboxKey(first)];
}
