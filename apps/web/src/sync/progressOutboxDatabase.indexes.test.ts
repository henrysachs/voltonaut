/* oxlint-disable typescript/prefer-readonly-parameter-types -- Indexed test helpers mirror readonly outbox contracts. */
import { expect, it } from "vitest";

import { createProgressOutboxDatabase } from "./progressOutboxDatabase.js";
import { newProgressOutboxRow } from "./progressOutboxRow.js";
import {
  PROGRESS_OUTBOX_MAX_ROWS,
  type ProgressOutboxRow,
  type ProgressOutboxState,
} from "./progressOutbox.js";
import {
  MemoryOutboxDatabase,
  appendSealed,
  batch,
  checkpoint,
  fence,
  owner,
  receipt,
  requireValue,
  userB,
} from "./progressOutboxTestdata.js";

const queued = { kind: "queued", attempts: 0, retryAtMs: 0 } satisfies ProgressOutboxState;

function seededRow(sequence: number, state: ProgressOutboxState): ProgressOutboxRow {
  return newProgressOutboxRow({
    owner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch: batch([checkpoint({ sequence, startTick: sequence })]),
    phase: "sealed",
    state,
  });
}

function seedViewRows(memory: Readonly<MemoryOutboxDatabase>): void {
  const sending = { kind: "sending", attempts: 1, retryAtMs: 0 } satisfies ProgressOutboxState;

  const blocked = {
    kind: "blocked",
    cause: "forbidden",
    attempts: 1,
    retryAtMs: 1000,
  } satisfies ProgressOutboxState;

  const storedBase = seededRow(3, queued);

  const stored = seededRow(3, {
    kind: "stored",
    attempts: 1,
    retryAtMs: 0,
    receipt: receipt(storedBase),
  });

  const open = newProgressOutboxRow({
    owner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch: batch([checkpoint({ sequence: 4, startTick: 4 })]),
    phase: "open",
  });

  for (const row of [
    seededRow(0, queued),
    seededRow(1, sending),
    seededRow(2, blocked),
    stored,
    open,
  ]) {
    memory.seed(row);
  }
}

it("finds duplicate checkpoints through persisted composite sequence keys", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const first = seededRow(4, queued);
  const otherOwner = { ...owner, userId: userB };
  memory.seed(first);
  memory.seed(
    newProgressOutboxRow({
      owner: otherOwner,
      consentVersion: 1,
      sessionGeneration: 1,
      batch: batch([checkpoint({ sequence: 4, startTick: 4 })]),
      phase: "sealed",
      state: queued,
    }),
  );
  memory.resetMetrics();

  expect(await outbox.append(fence(), checkpoint({ sequence: 4, startTick: 4 }))).toEqual({
    kind: "stored",
    rows: [first],
  });
  expect(memory.metrics()).toMatchObject({ getAll: 0, sequenceRows: 1 });
  expect(memory.raw()).toHaveLength(2);
});

it("counts state and view through keyed indexes without store scans", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  seedViewRows(memory);
  memory.resetMetrics();

  const expected = {
    kind: "ready",
    counts: {
      rows: 5,
      queued: 2,
      sending: 1,
      blocked: 1,
      stored: 1,
      open: 1,
      remaining: PROGRESS_OUTBOX_MAX_ROWS - 5,
    },
  };

  expect(await outbox.state(owner)).toEqual(expected);
  expect(await outbox.view(owner)).toEqual(expected);
  expect(memory.metrics()).toMatchObject({
    getAll: 0,
    get: 0,
    accountCount: 2,
    stateCount: 8,
    openCount: 2,
  });
});

it("seals through the open and last-journal indexes without a store scan", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  await outbox.append(fence(), checkpoint());
  memory.resetMetrics();

  const sealed = requireValue(await outbox.seal(fence()));

  expect(sealed.phase).toBe("sealed");
  expect(memory.metrics()).toMatchObject({ getAll: 0, get: 0, openRows: 1, lastJournalRow: 1 });
  expect(await outbox.state(owner)).toMatchObject({ counts: { open: 0, queued: 1 } });
});

it("marks sending and blocked by primary key without a store scan", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const row = await appendSealed(outbox, checkpoint());
  memory.resetMetrics();

  const sending = await outbox.markSending({
    row,
    fence: fence(),
    nowMs: 0,
    manual: false,
  });

  expect(sending.state.kind).toBe("sending");
  expect(memory.metrics()).toMatchObject({ getAll: 0, get: 1 });
  memory.resetMetrics();

  const blocked = await outbox.markBlocked({
    row: sending,
    fence: fence(),
    cause: "reauth",
    attempts: 1,
    nowMs: 1000,
  });

  expect(sending.state.kind).toBe("sending");
  expect(blocked.state.kind).toBe("blocked");
  expect(memory.metrics()).toMatchObject({ getAll: 0, get: 1 });
});

it("requeues and stores by primary key without a store scan", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const row = await appendSealed(outbox, checkpoint());
  memory.resetMetrics();

  const sending = await outbox.markSending({
    row,
    fence: fence(),
    nowMs: 0,
    manual: false,
  });

  memory.resetMetrics();

  const requeued = await outbox.requeue(sending, fence(), 2000);

  expect(requeued.state).toEqual({ kind: "queued", attempts: 1, retryAtMs: 2000 });
  expect(memory.metrics()).toMatchObject({ getAll: 0, get: 1 });

  const resumed = await outbox.markSending({
    row: requeued,
    fence: fence(),
    nowMs: 2000,
    manual: false,
  });

  memory.resetMetrics();
  await outbox.markStored({ row: resumed, fence: fence(), receipt: receipt(resumed) });

  expect(memory.raw()).toEqual([]);
  expect(memory.metrics()).toMatchObject({ getAll: 0, get: 2 });
});
