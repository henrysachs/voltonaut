/* oxlint-disable typescript/prefer-readonly-parameter-types -- Retry helper receives readonly outbox and row contracts. */
import { expect, it } from "vitest";

import { createProgressOutboxDatabase } from "./progressOutboxDatabase.js";
import type { ProgressOutbox, ProgressOutboxRow } from "./progressOutbox.js";
import {
  MemoryOutboxDatabase,
  appendSealed,
  checkpoint,
  fence,
  owner,
  receipt,
} from "./progressOutboxTestdata.js";

async function exhaustRetry(
  outbox: Readonly<ProgressOutbox>,
  current: Readonly<ProgressOutboxRow>,
  attempts: number,
): Promise<ProgressOutboxRow> {
  const blocked = await outbox.markBlocked({
    row: current,
    fence: fence(),
    cause: "retry",
    attempts,
    nowMs: 10_000,
  });

  expect(blocked.state.kind).toBe(attempts === 5 ? "blocked" : "queued");

  if (attempts === 5) return blocked;

  const sending = await outbox.markSending({
    row: blocked,
    fence: fence(),
    nowMs: blocked.state.retryAtMs,
    manual: false,
  });

  return exhaustRetry(outbox, sending, attempts + 1);
}

it("keeps retry idempotent, applies 1/2/4/8 second backoff and blocks after five attempts", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const queued = await appendSealed(outbox, checkpoint({ paused: true }));

  const sending = await outbox.markSending({
    row: queued,
    fence: fence(),
    nowMs: 1000,
    manual: false,
  });

  expect(sending.state).toEqual({ kind: "sending", attempts: 1, retryAtMs: 0 });
  expect(
    await outbox.markSending({ row: queued, fence: fence(), nowMs: 1000, manual: false }),
  ).toEqual(sending);

  const retry = await outbox.markBlocked({
    row: sending,
    fence: fence(),
    cause: "retry",
    attempts: 1,
    nowMs: 1000,
  });

  expect(retry.state).toEqual({ kind: "queued", attempts: 1, retryAtMs: 2000 });
  expect(
    await outbox.markSending({ row: retry, fence: fence(), nowMs: 1999, manual: false }),
  ).toEqual(retry);

  let current = await outbox.markSending({
    row: retry,
    fence: fence(),
    nowMs: 2000,
    manual: false,
  });

  expect(current.state).toMatchObject({ kind: "sending", attempts: 2 });
  current = await exhaustRetry(outbox, current, 2);
  expect(current.state).toMatchObject({ kind: "blocked", cause: "retry", attempts: 5 });

  current = await outbox.markSending({ row: current, fence: fence(), nowMs: 20_000, manual: true });
  expect(current.state).toMatchObject({ kind: "sending", attempts: 1 });
});

it("requeues an uncovered sending row without resetting attempts or payload", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const row = await appendSealed(outbox, checkpoint());

  const sending = await outbox.markSending({
    row,
    fence: fence(),
    nowMs: 1000,
    manual: false,
  });

  const queued = await outbox.requeue(sending, fence(), 5000);
  expect(queued.state).toEqual({ kind: "queued", attempts: 1, retryAtMs: 5000 });
  expect(queued.payload).toEqual(sending.payload);
  expect(queued.hash).toBe(sending.hash);
  expect(memory.raw()).toHaveLength(1);
  expect(await outbox.requeue(queued, fence(), 6000)).toEqual(queued);

  const resumed = await outbox.markSending({
    row: queued,
    fence: fence(),
    nowMs: 6000,
    manual: false,
  });

  expect(resumed.state).toMatchObject({ kind: "sending", attempts: 2 });
});

it("deletes only after a covering receipt and keeps lost-response retry idempotent", async () => {
  const memory = new MemoryOutboxDatabase();
  const outbox = createProgressOutboxDatabase(memory);
  const queued = await appendSealed(outbox, checkpoint({ paused: true }));

  const sending = await outbox.markSending({
    row: queued,
    fence: fence(),
    nowMs: 1000,
    manual: false,
  });

  await expect(
    outbox.markStored({ row: sending, fence: fence(), receipt: receipt(sending, 1, 2) }),
  ).rejects.toMatchObject({ cause: "contract" });
  expect(await outbox.listPending(owner)).toHaveLength(1);

  const confirmed = await outbox.markStored({
    row: sending,
    fence: fence(),
    receipt: receipt(sending),
  });

  expect(confirmed.state.kind).toBe("stored");
  expect(await outbox.listPending(owner)).toEqual([]);
  expect(memory.raw()).toEqual([]);
  expect(
    await outbox.markStored({ row: sending, fence: fence(), receipt: receipt(sending) }),
  ).toMatchObject({ state: { kind: "stored" } });
});
