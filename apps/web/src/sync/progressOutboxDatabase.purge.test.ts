/* oxlint-disable typescript/prefer-readonly-parameter-types -- Purge fixtures mirror readonly outbox contracts. */
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
  phase: ProgressOutboxRow["phase"] = "sealed",
): ProgressOutboxRow {
  return newProgressOutboxRow({
    owner: journalOwner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch: batch([checkpoint({ id: journalOwner.journalId, sequence, startTick: sequence })]),
    phase,
    state,
  });
}

it("purges every owner row by account index and keeps other owners", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const otherJournal = JournalIdSchema.parse("550e8400-e29b-41d4-a716-446655440001");
  const queued = { kind: "queued", attempts: 0, retryAtMs: 0 } satisfies ProgressOutboxState;
  const otherOrigin = { ...owner, apiOrigin: "http://localhost:4000" };
  const otherUser = { ...owner, userId: userB };

  const ownerRows = [
    seededRow(owner, 0, queued),
    seededRow(owner, 1, { kind: "sending", attempts: 1, retryAtMs: 0 }),
    seededRow(owner, 2, { kind: "blocked", cause: "reauth", attempts: 1, retryAtMs: 0 }),
    seededRow(owner, 3, {
      kind: "stored",
      attempts: 1,
      retryAtMs: 0,
      receipt: receipt(seededRow(owner, 3, queued)),
    }),
    seededRow(owner, 4, queued, "open"),
    seededRow({ ...owner, journalId: otherJournal }, 0, queued),
  ];

  const kept = [seededRow(otherOrigin, 0, queued), seededRow(otherUser, 0, queued)];

  for (const row of [...ownerRows, ...kept]) memory.seed(row);

  memory.resetMetrics();
  await outbox.purgeOwner(owner);

  expect(memory.metrics()).toMatchObject({ getAll: 0, accountRows: 1 });
  expect(memory.raw().map((row) => [row.apiOrigin, row.userId])).toEqual(
    kept.map((row) => [row.apiOrigin, row.userId]),
  );
  expect(await outbox.state(owner)).toEqual({
    kind: "ready",
    counts: { rows: 0, queued: 0, sending: 0, blocked: 0, stored: 0, open: 0, remaining: 1200 },
  });
  expect(await outbox.listPendingPage(otherUser, 10)).toHaveLength(1);
  expect(await outbox.listPendingPage(otherOrigin, 10)).toHaveLength(1);
});

it("treats a purge of an owner without rows as a no-op", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);

  const row = seededRow({ ...owner, userId: userB }, 0, {
    kind: "queued",
    attempts: 0,
    retryAtMs: 0,
  });

  memory.seed(row);
  await outbox.purgeOwner(owner);

  expect(memory.raw()).toEqual([row]);
});
