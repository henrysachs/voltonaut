/* oxlint-disable typescript/prefer-readonly-parameter-types -- Seed helper receives a readonly test database contract. */
import { expect, it } from "vitest";
import { JournalIdSchema } from "@voltonaut/shared";

import { createProgressOutboxDatabase, progressOutboxKey } from "./progressOutboxDatabase.js";
import { LOCAL_PROGRESS_MAX_TIME_S } from "./progressBatch.js";
import { PROGRESS_OUTBOX_MAX_ROWS } from "./progressOutbox.js";
import {
  MemoryOutboxDatabase,
  checkpoint,
  fence,
  origin,
  owner,
  seedCapacity,
  userB,
} from "./progressOutboxTestdata.js";

it("caps each account and origin at 1200 rows without eviction", async () => {
  expect(PROGRESS_OUTBOX_MAX_ROWS * LOCAL_PROGRESS_MAX_TIME_S).toBe(2 * 60 * 60);
  const memory = new MemoryOutboxDatabase();
  const firstKey = seedCapacity(memory);
  const outbox = createProgressOutboxDatabase(memory);
  const target = JournalIdSchema.parse("00000000-0000-4000-8000-000000000fff");

  await expect(
    outbox.append(fence({ ...owner, journalId: target }), checkpoint({ id: target })),
  ).rejects.toMatchObject({ cause: "capacity" });
  expect(memory.raw()).toHaveLength(PROGRESS_OUTBOX_MAX_ROWS);
  expect(
    memory.raw().some((row) => JSON.stringify(progressOutboxKey(row)) === JSON.stringify(firstKey)),
  ).toBe(true);
  expect(await outbox.state(owner)).toMatchObject({ kind: "blocked", cause: "capacity" });

  await outbox.append(fence({ userId: userB, journalId: target }), checkpoint({ id: target }));
  expect(memory.raw()).toHaveLength(PROGRESS_OUTBOX_MAX_ROWS + 1);
  expect(await outbox.state({ apiOrigin: origin, userId: userB })).toMatchObject({
    kind: "ready",
    counts: { rows: 1, remaining: PROGRESS_OUTBOX_MAX_ROWS - 1 },
  });

  await outbox.append(
    fence({ apiOrigin: "http://localhost:4000", journalId: target }),
    checkpoint({ id: target }),
  );
  expect(memory.raw()).toHaveLength(PROGRESS_OUTBOX_MAX_ROWS + 2);
});
