/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright owns the mutable browser page and route fixtures. */
import { expect, test, type Page } from "@playwright/test";

import {
  PROGRESS_OUTBOX_INDEX_ACCOUNT,
  PROGRESS_OUTBOX_INDEX_ACCOUNT_OPEN,
  PROGRESS_OUTBOX_INDEX_JOURNAL,
  PROGRESS_OUTBOX_INDEX_OPEN,
  PROGRESS_OUTBOX_INDEX_RETRY,
  PROGRESS_OUTBOX_INDEX_SEQUENCE,
  PROGRESS_OUTBOX_INDEX_STATE,
} from "../src/sync/progressOutboxIndexedTypes.js";
import type { ProgressOutboxRow, ProgressOutboxView } from "../src/sync/progressOutbox.js";

interface ProgressRows {
  readonly matches: ProgressOutboxRow[];
  readonly raw: ProgressOutboxRow;
}

const expectedIndexes = [
  {
    name: PROGRESS_OUTBOX_INDEX_ACCOUNT,
    keyPath: ["apiOrigin", "userId"],
    multiEntry: false,
  },
  {
    name: PROGRESS_OUTBOX_INDEX_JOURNAL,
    keyPath: ["apiOrigin", "userId", "journalId"],
    multiEntry: false,
  },
  {
    name: PROGRESS_OUTBOX_INDEX_OPEN,
    keyPath: ["apiOrigin", "userId", "journalId", "phase"],
    multiEntry: false,
  },
  {
    name: PROGRESS_OUTBOX_INDEX_ACCOUNT_OPEN,
    keyPath: ["apiOrigin", "userId", "phase"],
    multiEntry: false,
  },
  {
    name: PROGRESS_OUTBOX_INDEX_RETRY,
    keyPath: ["apiOrigin", "userId", "state.kind", "state.retryAtMs"],
    multiEntry: false,
  },
  {
    name: PROGRESS_OUTBOX_INDEX_SEQUENCE,
    keyPath: "sequenceKeys",
    multiEntry: true,
  },
  {
    name: PROGRESS_OUTBOX_INDEX_STATE,
    keyPath: ["apiOrigin", "userId", "state.kind"],
    multiEntry: false,
  },
];

async function seedProgressOutbox() {
  const { openProgressOutboxDatabase } = await import("../src/sync/progressOutboxDatabase.js");

  const { checkpoint, fence, owner, requireAppendedRow, userB } =
    await import("../src/sync/progressOutboxTestdata.js");

  const outbox = await openProgressOutboxDatabase();
  const value = checkpoint({ sequence: 41, startTick: 41 });
  const first = requireAppendedRow(await outbox.append(fence(), value));
  const duplicate = requireAppendedRow(await outbox.append(fence(), value));

  await outbox.append(fence({ userId: userB }), value);

  const sealed = await outbox.seal(fence());

  if (sealed === undefined) throw new Error("Missing sealed progress row");

  return {
    first,
    duplicateRevision: duplicate.revision,
    sealedRevision: sealed.revision,
    view: await outbox.state(owner),
  };
}

async function inspectProgressIndexes() {
  const constants = await import("../src/sync/progressOutboxIndexedTypes.js");

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(
      constants.PROGRESS_OUTBOX_DATABASE_NAME,
      constants.PROGRESS_OUTBOX_DATABASE_VERSION,
    );

    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(new Error("Progress schema open failed"));
    });
  });

  try {
    const store = database
      .transaction(constants.PROGRESS_OUTBOX_STORE_NAME, "readonly")
      .objectStore(constants.PROGRESS_OUTBOX_STORE_NAME);

    return {
      version: database.version,
      indexes: Array.from(store.indexNames).map((name) => {
        const index = store.index(name);

        return { name, keyPath: index.keyPath, multiEntry: index.multiEntry };
      }),
    };
  } finally {
    database.close();
  }
}

async function readProgressRows(first: Readonly<ProgressOutboxRow>) {
  const { ProgressOutboxRowSchema } = await import("../src/sync/progressOutboxSchema.js");
  const constants = await import("../src/sync/progressOutboxIndexedTypes.js");

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(
      constants.PROGRESS_OUTBOX_DATABASE_NAME,
      constants.PROGRESS_OUTBOX_DATABASE_VERSION,
    );

    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(new Error("Progress row open failed"));
    });
  });

  try {
    return await new Promise<ProgressRows>((resolve, reject) => {
      const transaction = database.transaction(constants.PROGRESS_OUTBOX_STORE_NAME, "readonly");
      const store = transaction.objectStore(constants.PROGRESS_OUTBOX_STORE_NAME);
      const sequenceKey = [first.apiOrigin, first.userId, first.journalId, first.startSequence];

      const matches = store
        .index(constants.PROGRESS_OUTBOX_INDEX_SEQUENCE)
        .getAll(IDBKeyRange.only(sequenceKey));

      const raw = store.get([first.apiOrigin, first.userId, first.journalId, first.startTick]);

      transaction.addEventListener("complete", () => {
        try {
          resolve({
            matches: ProgressOutboxRowSchema.array().parse(matches.result),
            raw: ProgressOutboxRowSchema.parse(raw.result),
          });
        } catch {
          reject(new Error("Persisted progress row does not match the required schema"));
        }
      });
      transaction.addEventListener("error", () => {
        reject(new Error("Progress row inspection failed"));
      });
    });
  } finally {
    database.close();
  }
}

async function readPendingAfterReload(first: Readonly<ProgressOutboxRow>) {
  const { openProgressOutboxDatabase } = await import("../src/sync/progressOutboxDatabase.js");
  const { owner } = await import("../src/sync/progressOutboxTestdata.js");
  const outbox = await openProgressOutboxDatabase();

  return {
    page: await outbox.listPendingPage(owner, 10),
    after: await outbox.listPendingPage(owner, 10, {
      journalId: first.journalId,
      startTick: first.startTick,
    }),
    journal: await outbox.listJournalPending(owner, first.journalId),
    nextRetryAt: await outbox.nextRetryAt(owner),
    view: await outbox.state(owner),
  };
}

async function expectReloadedProgress(
  page: Readonly<Page>,
  first: Readonly<ProgressOutboxRow>,
  sealedRevision: string,
  view: Readonly<ProgressOutboxView>,
  rows: Readonly<ProgressRows>,
): Promise<void> {
  await page.reload();

  const persisted = await page.evaluate(readProgressRows, first);
  const pending = await page.evaluate(readPendingAfterReload, first);

  expect(persisted).toEqual(rows);
  expect(pending.page.map((row) => row.revision)).toEqual([sealedRevision]);
  expect(pending.after).toEqual([]);
  expect(pending.journal.map((row) => row.revision)).toEqual([sealedRevision]);
  expect(pending.nextRetryAt).toBe(0);
  expect(pending.view).toEqual(view);
}

test("real IndexedDB uses the v1 composite sequence schema and persists rows across reload", async ({
  page,
}: Readonly<{ page: Readonly<Page> }>) => {
  await page.context().route("**/progress-outbox-storage.html", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Progress outbox storage check</title>",
    });
  });
  await page.goto("/progress-outbox-storage.html");

  const seeded = await page.evaluate(seedProgressOutbox);
  const schema = await page.evaluate(inspectProgressIndexes);
  const rows = await page.evaluate(readProgressRows, seeded.first);

  expect(schema.version).toBe(1);
  expect(schema.indexes).toHaveLength(7);
  expect(schema.indexes).toEqual(expect.arrayContaining(expectedIndexes));
  expect(seeded.duplicateRevision).toBe(seeded.first.revision);
  expect(rows.matches.map((row) => row.revision)).toEqual([seeded.sealedRevision]);
  expect(rows.raw).toMatchObject({
    apiOrigin: "http://localhost:3000",
    phase: "sealed",
    startTick: 41,
    endTick: 42,
    startSequence: 41,
    endSequence: 41,
    sequences: [41],
    sequenceKeys: [["http://localhost:3000", rows.raw.userId, rows.raw.journalId, 41]],
    factCount: 1,
    timeS: 0.05,
  });
  expect(seeded.view).toEqual({
    kind: "ready",
    counts: {
      rows: 1,
      queued: 1,
      sending: 0,
      blocked: 0,
      stored: 0,
      open: 0,
      remaining: 1199,
    },
  });

  await expectReloadedProgress(page, seeded.first, seeded.sealedRevision, seeded.view, rows);
});
