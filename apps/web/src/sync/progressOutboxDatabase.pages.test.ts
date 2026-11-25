/* oxlint-disable typescript/prefer-readonly-parameter-types -- Paging fixtures mirror readonly outbox contracts. */
import { expect, it } from "vitest";
import { JournalIdSchema } from "@voltonaut/shared";

import { createProgressOutboxDatabase } from "./progressOutboxDatabase.js";
import { newProgressOutboxRow } from "./progressOutboxRow.js";
import type {
  ProgressJournalOwner,
  ProgressOutboxRow,
  ProgressOutboxState,
} from "./progressOutbox.js";
import {
  MemoryOutboxDatabase,
  batch,
  checkpoint,
  owner,
  receipt,
  userB,
} from "./progressOutboxTestdata.js";

function seededRow(
  journalOwner: Readonly<ProgressJournalOwner>,
  sequence: number,
  state: ProgressOutboxState,
): ProgressOutboxRow {
  return newProgressOutboxRow({
    owner: journalOwner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch: batch([checkpoint({ id: journalOwner.journalId, sequence, startTick: sequence })]),
    phase: "sealed",
    state,
  });
}

function seedPages(memory: Readonly<MemoryOutboxDatabase>) {
  const journalA = JournalIdSchema.parse("550e8400-e29b-41d4-a716-446655440000");
  const journalB = JournalIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");
  const ownerA = { ...owner, journalId: journalA };
  const ownerB = { ...owner, journalId: journalB };
  const queued = { kind: "queued", attempts: 0, retryAtMs: 0 } satisfies ProgressOutboxState;
  const sending = { kind: "sending", attempts: 1, retryAtMs: 0 } satisfies ProgressOutboxState;
  const storedBase = seededRow(ownerA, 0, queued);

  const stored = seededRow(ownerA, 0, {
    kind: "stored",
    attempts: 1,
    retryAtMs: 0,
    receipt: receipt(storedBase),
  });

  const first = seededRow(ownerA, 1, queued);
  const second = seededRow(ownerA, 2, sending);
  const third = seededRow(ownerB, 0, queued);
  const otherUser = seededRow({ ...ownerA, userId: userB }, 0, queued);

  for (const row of [stored, first, second, third, otherUser]) memory.seed(row);

  return { journalA, journalB, first, second, third };
}

it("returns the first pending rows through the primary-key cursor without a store scan", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const expected = seedPages(memory);
  memory.resetMetrics();

  expect(await outbox.listPendingPage(owner, 2)).toEqual([expected.first, expected.second]);
  expect(memory.metrics()).toMatchObject({ getAll: 0, pendingPage: 1 });

  memory.resetMetrics();
  expect(await outbox.listPendingPage(owner, 3)).toEqual([
    expected.first,
    expected.second,
    expected.third,
  ]);
  expect(memory.metrics()).toMatchObject({ getAll: 0, pendingPage: 1 });
});

it("continues within a journal after a full page", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const queued = { kind: "queued", attempts: 0, retryAtMs: 0 } satisfies ProgressOutboxState;
  const rows = Array.from({ length: 12 }, (_, sequence) => seededRow(owner, sequence, queued));

  for (const row of rows) memory.seed(row);

  memory.resetMetrics();
  const first = await outbox.listPendingPage(owner, 10);

  const second = await outbox.listPendingPage(owner, 10, {
    journalId: owner.journalId,
    startTick: 9,
  });

  expect(first.map((row) => row.startSequence)).toEqual(
    Array.from({ length: 10 }, (_, sequence) => sequence),
  );
  expect(second).toEqual(rows.slice(10));
  expect(memory.metrics()).toMatchObject({ getAll: 0, pendingPage: 2 });
});

it("starts strictly after a row cursor and reaches later journals", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const expected = seedPages(memory);
  memory.resetMetrics();

  expect(
    await outbox.listPendingPage(owner, 3, {
      journalId: expected.journalA.toUpperCase(),
      startTick: 2,
    }),
  ).toEqual([expected.third]);
  expect(memory.metrics()).toMatchObject({ getAll: 0, pendingPage: 1 });

  memory.resetMetrics();
  expect(
    await outbox.listPendingPage(owner, 3, { journalId: expected.journalB, startTick: 0 }),
  ).toEqual([]);
  expect(memory.metrics()).toMatchObject({ getAll: 0, pendingPage: 1 });
});

it("accepts an empty page and rejects invalid limits before reading", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  seedPages(memory);
  memory.resetMetrics();

  expect(await outbox.listPendingPage(owner, 0)).toEqual([]);
  expect(memory.metrics()).toMatchObject({ getAll: 0, pendingPage: 1 });

  memory.resetMetrics();
  expect(() => outbox.listPendingPage(owner, -1)).toThrow(
    expect.objectContaining({ cause: "contract" }),
  );
  expect(() => outbox.listPendingPage(owner, 1.5)).toThrow(
    expect.objectContaining({ cause: "contract" }),
  );
  expect(() =>
    outbox.listPendingPage(owner, 10, { journalId: owner.journalId, startTick: -1 }),
  ).toThrow(expect.objectContaining({ cause: "contract" }));
  expect(memory.metrics()).toMatchObject({ getAll: 0, pendingPage: 0 });
});

it("lists all non-stored rows for one journal through the journal index", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const expected = seedPages(memory);
  memory.resetMetrics();

  expect(await outbox.listJournalPending(owner, expected.journalA)).toEqual([
    expected.first,
    expected.second,
  ]);
  expect(memory.metrics()).toMatchObject({ getAll: 0, journalRows: 1 });
});
