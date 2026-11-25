/* oxlint-disable typescript/prefer-readonly-parameter-types -- Retry fixtures mirror readonly outbox contracts. */
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
  fence,
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

it("returns the earliest queued retry through the account index", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const otherJournal = JournalIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");
  const journalOwner = { ...owner, journalId: otherJournal };
  const queued = { kind: "queued", attempts: 1, retryAtMs: 5000 } satisfies ProgressOutboxState;
  const storedBase = seededRow(owner, 3, queued);

  const rows = [
    seededRow(owner, 0, queued),
    seededRow(journalOwner, 0, { kind: "queued", attempts: 1, retryAtMs: 9000 }),
    seededRow(owner, 1, { kind: "sending", attempts: 1, retryAtMs: 0 }),
    seededRow(owner, 2, { kind: "blocked", cause: "reauth", attempts: 1, retryAtMs: 0 }),
    seededRow(owner, 3, {
      kind: "stored",
      attempts: 1,
      retryAtMs: 0,
      receipt: receipt(storedBase),
    }),
    seededRow({ ...owner, userId: userB }, 0, { kind: "queued", attempts: 1, retryAtMs: 1 }),
  ];

  for (const row of rows) memory.seed(row);

  memory.resetMetrics();
  expect(await outbox.nextRetryAt(owner)).toBe(5000);
  expect(await outbox.nextRetryAt({ ...owner, userId: userB })).toBe(1);
  expect(
    await outbox.nextRetryAt({ ...owner, apiOrigin: "http://localhost:4000" }),
  ).toBeUndefined();
  expect(memory.metrics()).toMatchObject({ getAll: 0, nextRetryAt: 3 });
});

it("tracks queued retry changes without store scans", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const row = seededRow(owner, 0, { kind: "queued", attempts: 0, retryAtMs: 0 });
  const later = seededRow(owner, 1, { kind: "queued", attempts: 1, retryAtMs: 3000 });
  memory.seed(row);
  memory.seed(later);
  memory.resetMetrics();

  const sending = await outbox.markSending({ row, fence: fence(), nowMs: 0, manual: false });

  expect(await outbox.nextRetryAt(owner)).toBe(3000);
  expect(memory.metrics()).toMatchObject({ getAll: 0, nextRetryAt: 1 });

  const blocked = await outbox.markBlocked({
    row: sending,
    fence: fence(),
    cause: "retry",
    attempts: 1,
    nowMs: 1000,
  });

  memory.resetMetrics();

  expect(await outbox.nextRetryAt(owner)).toBe(2000);
  expect(memory.metrics()).toMatchObject({ getAll: 0, nextRetryAt: 1 });

  const retried = await outbox.markSending({
    row: blocked,
    fence: fence(),
    nowMs: 2000,
    manual: false,
  });

  await outbox.requeue(retried, fence(), 5000);

  memory.resetMetrics();

  expect(await outbox.nextRetryAt(owner)).toBe(3000);
  expect(memory.metrics()).toMatchObject({ getAll: 0, nextRetryAt: 1 });
});
