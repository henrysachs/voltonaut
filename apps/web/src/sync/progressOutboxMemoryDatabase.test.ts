/* oxlint-disable typescript/prefer-readonly-parameter-types -- IndexedDB fixture requests mirror readonly DOM contracts. */
import { expect, it } from "vitest";

import { newProgressOutboxRow, progressOutboxKey } from "./progressOutboxRow.js";
import type { ProgressOutboxRow } from "./progressOutboxSchema.js";
import type {
  ProgressIndexedRequest,
  ProgressIndexedTransaction,
} from "./progressOutboxIndexedTypes.js";
import { MemoryOutboxDatabase, batch, checkpoint, owner, userB } from "./progressOutboxTestdata.js";

function request<T>(value: ProgressIndexedRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.addEventListener("success", () => {
      resolve(value.result);
    });
    value.addEventListener("error", () => {
      reject(new Error("Memory request failed"));
    });
  });
}

function transactionEvent(
  transaction: Readonly<ProgressIndexedTransaction>,
): Promise<"complete" | "abort"> {
  return new Promise((resolve) => {
    transaction.addEventListener(
      "complete",
      () => {
        resolve("complete");
      },
      { once: true },
    );
    transaction.addEventListener(
      "abort",
      () => {
        resolve("abort");
      },
      { once: true },
    );
  });
}

function row(startTick: number): ProgressOutboxRow {
  return newProgressOutboxRow({
    owner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch: batch([checkpoint({ sequence: startTick, startTick })]),
    phase: "sealed",
  });
}

async function lastTick(memory: Readonly<MemoryOutboxDatabase>): Promise<number | undefined> {
  const transaction = memory.transaction("batches", "readonly");
  const cursor = await request(transaction.objectStore("batches").lastJournalRow(owner));

  return cursor?.value.startTick;
}

it("indexes persisted composite sequence keys separately for each account", async () => {
  const memory = new MemoryOutboxDatabase();
  const first = row(7);
  const otherOwner = { ...owner, userId: userB };

  const other = newProgressOutboxRow({
    owner: otherOwner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch: batch([checkpoint({ sequence: 7, startTick: 7 })]),
    phase: "sealed",
  });

  memory.seed(first);
  memory.seed(other);

  const transaction = memory.transaction("batches", "readonly");
  const store = transaction.objectStore("batches");
  const ownPending = request(store.sequenceRows(owner, 7));
  const otherPending = request(store.sequenceRows(otherOwner, 7));
  const [ownMatches, otherMatches] = await Promise.all([ownPending, otherPending]);

  expect(ownMatches.map((entry) => entry.revision)).toEqual([first.revision]);
  expect(otherMatches.map((entry) => entry.revision)).toEqual([other.revision]);
});

it("keeps the journal last-tick index correct across out-of-order puts, deletes and rollback", async () => {
  const memory = new MemoryOutboxDatabase();
  const first = row(0);
  const middle = row(1);
  const last = row(2);
  memory.seed(last);
  memory.seed(first);
  memory.seed(middle);
  expect(await lastTick(memory)).toBe(2);

  const removal = memory.transaction("batches", "readwrite");
  const removed = transactionEvent(removal);
  await request(removal.objectStore("batches").delete([...progressOutboxKey(last)]));
  expect(await removed).toBe("complete");
  expect(await lastTick(memory)).toBe(1);

  const rollback = memory.transaction("batches", "readwrite");
  const aborted = transactionEvent(rollback);
  const appended = row(3);
  const putting = rollback.objectStore("batches").put(appended, [...progressOutboxKey(appended)]);
  putting.addEventListener(
    "success",
    () => {
      rollback.abort();
    },
    { once: true },
  );
  await request(putting);
  expect(await aborted).toBe("abort");
  expect(await lastTick(memory)).toBe(1);
});
