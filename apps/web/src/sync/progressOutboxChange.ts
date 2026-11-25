/* oxlint-disable typescript/prefer-readonly-parameter-types -- Keyed change inputs are readonly contracts; Oxlint does not follow imported aliases. */
import { progressOutboxKey } from "./progressOutboxRow.js";
import type {
  ProgressAccountOwner,
  ProgressJournalOwner,
  ProgressOutboxRow,
} from "./progressOutboxSchema.js";
import type { ProgressPendingPageCursor, ProgressWriteFence } from "./progressOutbox.js";
import {
  asProgressError,
  checkProgressFence,
  progressError,
  progressSessionError,
} from "./progressOutboxFence.js";
import {
  PROGRESS_OUTBOX_STORE_NAME,
  type ProgressIndexedDatabase,
  type ProgressIndexedKey,
  type ProgressIndexedStore,
} from "./progressOutboxIndexedTypes.js";
import {
  accountProgressRows,
  decodeProgressRows,
  type ProgressChange as RowChange,
} from "./progressOutboxRows.js";
import { applyProgressWrites, watchProgressTransaction } from "./progressOutboxTransaction.js";

async function runProgressTransactionChange<T>(
  database: Readonly<ProgressIndexedDatabase>,
  mode: "readonly" | "readwrite",
  fence: Readonly<ProgressWriteFence> | undefined,
  listen: (store: ProgressIndexedStore, ready: () => void, fail: (error: Error) => void) => void,
  decide: () => RowChange<T>,
): Promise<T> {
  if (fence !== undefined) checkProgressFence(fence);
  const transaction = database.transaction(PROGRESS_OUTBOX_STORE_NAME, mode);
  const watch = watchProgressTransaction(transaction, fence);
  let completed: { readonly value: T } | undefined;
  let settled = false;

  const ready = (): void => {
    if (settled) return;
    settled = true;

    try {
      if (fence?.signal.aborted === true || fence?.current() === false) {
        watch.fail(progressSessionError());

        return;
      }

      const change = decide();
      completed = { value: change.value };
      applyProgressWrites(transaction, change, fence, watch);
    } catch (cause) {
      watch.fail(asProgressError(cause));
    }
  };

  try {
    listen(transaction.objectStore(PROGRESS_OUTBOX_STORE_NAME), ready, watch.fail);
  } catch (cause) {
    watch.fail(asProgressError(cause));
  }

  await watch.done;

  if (completed === undefined) {
    throw progressError("storage", "Progress-Transaktion ohne Ergebnis.");
  }

  return completed.value;
}

export function runProgressChange<T>(
  database: Readonly<ProgressIndexedDatabase>,
  mode: "readonly" | "readwrite",
  fence: Readonly<ProgressWriteFence> | undefined,
  decide: (rows: readonly ProgressOutboxRow[]) => RowChange<T>,
): Promise<T> {
  let rows: readonly ProgressOutboxRow[] = [];

  return runProgressTransactionChange(
    database,
    mode,
    fence,
    (store, ready) => {
      const request = store.getAll();
      request.addEventListener("success", () => {
        rows = request.result;
        ready();
      });
    },
    () => decide(decodeProgressRows(rows)),
  );
}

export function runProgressKeyedChange<T>(
  database: Readonly<ProgressIndexedDatabase>,
  mode: "readonly" | "readwrite",
  fence: Readonly<ProgressWriteFence> | undefined,
  key: ProgressIndexedKey,
  decide: (rows: readonly ProgressOutboxRow[]) => RowChange<T>,
): Promise<T> {
  let row: ProgressOutboxRow | undefined;

  return runProgressTransactionChange(
    database,
    mode,
    fence,
    (store, ready) => {
      const request = store.get(key);
      request.addEventListener("success", () => {
        row = request.result;
        ready();
      });
    },
    () => decide(row === undefined ? [] : decodeProgressRows([row])),
  );
}

export function runProgressOpenChange<T>(
  database: Readonly<ProgressIndexedDatabase>,
  fence: Readonly<ProgressWriteFence>,
  owner: Readonly<ProgressJournalOwner>,
  decide: (rows: readonly ProgressOutboxRow[]) => RowChange<T>,
): Promise<T> {
  let rows: readonly ProgressOutboxRow[] = [];

  return runProgressTransactionChange(
    database,
    "readwrite",
    fence,
    (store, ready) => {
      let openRows: readonly ProgressOutboxRow[] = [];
      let lastRow: ProgressOutboxRow | undefined;
      let pending = 2;

      const collected = (): void => {
        pending -= 1;

        if (pending !== 0) return;

        const lastKey =
          lastRow === undefined ? undefined : JSON.stringify(progressOutboxKey(lastRow));

        const includesLast = openRows.some(
          (row) => JSON.stringify(progressOutboxKey(row)) === lastKey,
        );

        rows = lastRow === undefined || includesLast ? openRows : [...openRows, lastRow];
        ready();
      };

      const openRequest = store.openRows(owner);
      openRequest.addEventListener("success", () => {
        openRows = openRequest.result;
        collected();
      });

      const lastRequest = store.lastJournalRow(owner);
      lastRequest.addEventListener("success", () => {
        lastRow = lastRequest.result?.value;
        collected();
      });
    },
    () => decide(decodeProgressRows(rows)),
  );
}

export function runProgressPendingPage(
  database: Readonly<ProgressIndexedDatabase>,
  owner: Readonly<ProgressAccountOwner>,
  limit: number,
  after?: Readonly<ProgressPendingPageCursor>,
): Promise<readonly ProgressOutboxRow[]> {
  let rows: readonly ProgressOutboxRow[] = [];

  return runProgressTransactionChange(
    database,
    "readonly",
    undefined,
    (store, ready, fail) => {
      const request = store.pendingPage(owner, limit, after);
      request.addEventListener("success", () => {
        rows = request.result;
        ready();
      });
      request.addEventListener("error", () => {
        fail(progressError("corrupt", "Progress-Warteschlange beschädigt. Keine Daten geändert."));
      });
    },
    () => ({ value: decodeProgressRows(rows) }),
  );
}

export function runProgressJournalPending(
  database: Readonly<ProgressIndexedDatabase>,
  owner: Readonly<ProgressJournalOwner>,
): Promise<readonly ProgressOutboxRow[]> {
  let rows: readonly ProgressOutboxRow[] = [];

  return runProgressTransactionChange(
    database,
    "readonly",
    undefined,
    (store, ready) => {
      const request = store.journalRows(owner);
      request.addEventListener("success", () => {
        rows = request.result;
        ready();
      });
    },
    () => ({ value: decodeProgressRows(rows).filter((row) => row.state.kind !== "stored") }),
  );
}

export function runProgressNextRetryAt(
  database: Readonly<ProgressIndexedDatabase>,
  owner: Readonly<ProgressAccountOwner>,
  afterMs: number,
): Promise<number | undefined> {
  let retryAtMs: number | undefined;

  return runProgressTransactionChange(
    database,
    "readonly",
    undefined,
    (store, ready, fail) => {
      const request = store.nextRetryAt(owner, afterMs);
      request.addEventListener("success", () => {
        retryAtMs = request.result;
        ready();
      });
      request.addEventListener("error", () => {
        fail(progressError("corrupt", "Progress-Warteschlange beschädigt. Keine Daten geändert."));
      });
    },
    () => ({ value: retryAtMs }),
  );
}

export function runProgressStoredCleanup(
  database: Readonly<ProgressIndexedDatabase>,
  fence: Readonly<ProgressWriteFence>,
): Promise<void> {
  let storedRaw: readonly ProgressOutboxRow[] = [];

  return runProgressTransactionChange(
    database,
    "readwrite",
    fence,
    (store, ready) => {
      const request = store.storedRows(fence);
      request.addEventListener("success", () => {
        storedRaw = request.result;
        ready();
      });
    },
    () => ({
      value: undefined,
      deletes: accountProgressRows(decodeProgressRows(storedRaw), fence),
    }),
  );
}
