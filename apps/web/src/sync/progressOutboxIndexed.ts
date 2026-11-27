/* oxlint-disable typescript/prefer-readonly-parameter-types -- IDBFactory is a mutable DOM boundary; the adapter never mutates it. */
import type {
  ProgressIndexedDatabase,
  ProgressIndexedTransaction,
} from "./progressOutboxIndexedTypes.js";
import { indexedProgressStore } from "./progressOutboxStore.js";

export type { ProgressIndexedDatabase } from "./progressOutboxIndexedTypes.js";

export {
  runProgressChange,
  runProgressJournalPending,
  runProgressNextRetryAt,
  runProgressOpenChange,
  runProgressOwnerPurge,
  runProgressPendingPage,
  runProgressStoredCleanup,
} from "./progressOutboxChange.js";

export { applyProgressWrites, watchProgressTransaction } from "./progressOutboxTransaction.js";

class IndexedProgressTransaction extends EventTarget implements ProgressIndexedTransaction {
  readonly #transaction: IDBTransaction;

  constructor(transaction: IDBTransaction) {
    super();
    this.#transaction = transaction;
    transaction.addEventListener("abort", () => {
      this.dispatchEvent(new Event("abort"));
    });
    transaction.addEventListener("error", () => {
      this.dispatchEvent(new Event("error"));
    });
    transaction.addEventListener("complete", () => {
      this.dispatchEvent(new Event("complete"));
    });
  }

  abort(): void {
    this.#transaction.abort();
  }

  objectStore(name: string) {
    return indexedProgressStore(this.#transaction.objectStore(name));
  }
}

export function wrapIndexedDatabase(database: IDBDatabase): ProgressIndexedDatabase {
  return {
    transaction: (name, mode) => new IndexedProgressTransaction(database.transaction(name, mode)),
  };
}
