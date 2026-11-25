/* oxlint-disable typescript/prefer-readonly-parameter-types -- Grouping helpers receive readonly persisted rows. */
import { expect, it } from "vitest";
import { JournalIdSchema } from "@voltonaut/shared";

import { ServerProgressBatchSchema, groupProgressBatches } from "./progressBatch.js";
import { createProgressOutboxDatabase } from "./progressOutboxDatabase.js";
import { newProgressOutboxRow } from "./progressOutboxRow.js";
import type { ProgressOutbox } from "./progressOutbox.js";
import {
  MemoryOutboxDatabase,
  appendSealed,
  batch,
  checkpoint,
  fence,
  owner,
  receipt,
} from "./progressOutboxTestdata.js";

async function appendPaused(
  outbox: Readonly<ProgressOutbox>,
  sequence: number,
  generation: number,
  count: number,
): Promise<void> {
  if (count === 0) return;

  await appendSealed(
    outbox,
    checkpoint({ sequence, startTick: sequence, paused: true }),
    fence({ sessionGeneration: generation }),
  );

  return appendPaused(outbox, sequence + 1, generation, count - 1);
}

function seedOtherJournal(memory: Readonly<MemoryOutboxDatabase>) {
  const journalId = JournalIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");
  const journalOwner = { ...owner, journalId };

  const storedBase = newProgressOutboxRow({
    owner: journalOwner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch: batch([checkpoint({ id: journalId, sequence: 1, startTick: 1 })]),
    phase: "sealed",
  });

  const stored = newProgressOutboxRow({
    owner: journalOwner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch: storedBase.payload,
    phase: "sealed",
    state: { kind: "stored", attempts: 1, retryAtMs: 0, receipt: receipt(storedBase) },
  });

  const pending = newProgressOutboxRow({
    owner: journalOwner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch: batch([checkpoint({ id: journalId, sequence: 2, startTick: 2 })]),
    phase: "sealed",
  });

  memory.seed(stored);
  memory.seed(pending);

  return { journalId, stored, pending };
}

it("prepares sealed rows and groups journal rows into server batches", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  await appendPaused(outbox, 0, 1, 11);
  memory.resetMetrics();

  await outbox.prepareDelivery(fence());
  expect(memory.metrics()).toMatchObject({
    getAll: 0,
    openRows: 1,
    lastJournalRow: 1,
    storedRows: 1,
    journalRows: 0,
  });

  const rows = await outbox.listJournalPending(owner, owner.journalId);
  const groups = groupProgressBatches(rows.map((row) => row.payload));
  expect(groups.map((group) => group.checkpoints.length)).toEqual([10, 1]);
  expect(groups.flatMap((group) => group.checkpoints.map((entry) => entry.sequence))).toEqual(
    Array.from({ length: 11 }, (_, index) => index),
  );
  expect(groups.every((group) => ServerProgressBatchSchema.safeParse(group).success)).toBe(true);
  expect(await outbox.listPending(owner)).toHaveLength(11);
});

it("groups contiguous batches across browser generation changes", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  await appendSealed(outbox, checkpoint({ sequence: 0, startTick: 0, paused: true }));
  await appendSealed(
    outbox,
    checkpoint({ sequence: 1, startTick: 1, paused: true }),
    fence({ sessionGeneration: 2 }),
  );
  await appendSealed(
    outbox,
    checkpoint({ sequence: 2, startTick: 2, paused: true }),
    fence({ sessionGeneration: 3 }),
  );

  const rows = await outbox.listJournalPending(owner, owner.journalId);
  const groups = groupProgressBatches(rows.map((row) => row.payload));
  expect(groups).toHaveLength(1);
  expect(groups[0]?.checkpoints.map((entry) => entry.sequence)).toEqual([0, 1, 2]);
  expect(groups[0]?.consentVersion).toBe(1);
  expect(groups[0]?.sessionGeneration).toBe(1);
});

it("prepares delivery without full journal scans and removes stored rows across the account", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  await outbox.append(fence(), checkpoint());
  const other = seedOtherJournal(memory);
  memory.resetMetrics();

  await outbox.prepareDelivery(fence());

  expect(memory.metrics()).toMatchObject({
    getAll: 0,
    journalRows: 0,
    openRows: 1,
    lastJournalRow: 1,
    storedRows: 1,
  });
  expect(memory.raw()).not.toContainEqual(other.stored);
  expect(memory.raw()).toContainEqual(
    expect.objectContaining({ journalId: owner.journalId, phase: "sealed" }),
  );
  expect(await outbox.listJournalPending(owner, other.journalId)).toEqual([other.pending]);
});
