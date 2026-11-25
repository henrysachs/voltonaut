/* oxlint-disable typescript/prefer-readonly-parameter-types -- IndexedDB and fence inputs are readonly contracts; Oxlint does not follow DOM or imported aliases. */
import { progressOutboxKey } from "./progressOutboxRow.js";
import type { ProgressWriteFence } from "./progressOutbox.js";
import { progressError, progressSessionError } from "./progressOutboxFence.js";
import {
  PROGRESS_OUTBOX_STORE_NAME,
  type ProgressIndexedTransaction,
} from "./progressOutboxIndexedTypes.js";
import type { ProgressChange } from "./progressOutboxRows.js";

export interface ProgressTransactionWatch {
  readonly done: Promise<void>;
  readonly fail: (error: Error) => void;
}

interface TransactionEvents {
  readonly aborted: () => void;
  readonly revoke: () => void;
  readonly complete: () => void;
}

function removeProgressListeners(
  transaction: Readonly<ProgressIndexedTransaction>,
  fence: Readonly<ProgressWriteFence> | undefined,
  events: Readonly<TransactionEvents>,
): void {
  transaction.removeEventListener("abort", events.aborted);
  transaction.removeEventListener("error", events.aborted);
  transaction.removeEventListener("complete", events.complete);
  fence?.signal.removeEventListener("abort", events.revoke);
}

function listenProgressTransaction(
  transaction: Readonly<ProgressIndexedTransaction>,
  fence: Readonly<ProgressWriteFence> | undefined,
  events: Readonly<TransactionEvents>,
): void {
  transaction.addEventListener("abort", events.aborted);
  transaction.addEventListener("error", events.aborted);
  transaction.addEventListener("complete", events.complete);
  fence?.signal.addEventListener("abort", events.revoke);

  if (fence?.signal.aborted === true || fence?.current() === false) events.revoke();
}

function abortTransaction(transaction: Readonly<ProgressIndexedTransaction>): void {
  try {
    transaction.abort();
  } catch {
    // A transaction that already committed cannot be rolled back.
  }
}

export function watchProgressTransaction(
  transaction: Readonly<ProgressIndexedTransaction>,
  fence?: Readonly<ProgressWriteFence>,
): ProgressTransactionWatch {
  let failNow: ((value: Error) => void) | undefined;

  const done = new Promise<void>((resolve, reject) => {
    let active = true;

    const cleanup = (): void => {
      active = false;
      removeProgressListeners(transaction, fence, { aborted, revoke, complete });
    };

    const fail = (value: Error): void => {
      if (!active) return;
      cleanup();
      reject(value);
      abortTransaction(transaction);
    };

    const aborted = (): void => {
      fail(progressError("storage", "Progress-Transaktion abgebrochen."));
    };

    const revoke = (): void => {
      fail(progressSessionError());
    };

    const complete = (): void => {
      if (fence?.signal.aborted === true || fence?.current() === false) revoke();
      else {
        cleanup();
        resolve();
      }
    };

    failNow = fail;
    listenProgressTransaction(transaction, fence, { aborted, revoke, complete });
  });

  return {
    done,
    fail: (value) => {
      failNow?.(value);
    },
  };
}

export function applyProgressWrites<T>(
  transaction: Readonly<ProgressIndexedTransaction>,
  change: Readonly<ProgressChange<T>>,
  fence: Readonly<ProgressWriteFence> | undefined,
  watch: Readonly<ProgressTransactionWatch>,
): void {
  const store = transaction.objectStore(PROGRESS_OUTBOX_STORE_NAME);

  const requests: readonly EventTarget[] = [
    ...(change.puts ?? []).map((row) => store.put(row, [...progressOutboxKey(row)])),
    ...(change.deletes ?? []).map((row) => store.delete([...progressOutboxKey(row)])),
  ];

  for (const request of requests) {
    request.addEventListener("success", () => {
      if (fence?.signal.aborted === true || fence?.current() === false) {
        watch.fail(progressSessionError());
      }
    });
  }
}
