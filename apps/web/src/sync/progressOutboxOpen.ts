/* oxlint-disable typescript/prefer-readonly-parameter-types -- IDBFactory is a mutable DOM boundary; the adapter never mutates it. */
import { progressError } from "./progressOutboxFence.js";
import { wrapIndexedDatabase } from "./progressOutboxIndexed.js";
import {
  PROGRESS_OUTBOX_DATABASE_NAME,
  PROGRESS_OUTBOX_DATABASE_VERSION,
  PROGRESS_OUTBOX_INDEX_ACCOUNT,
  PROGRESS_OUTBOX_INDEX_ACCOUNT_OPEN,
  PROGRESS_OUTBOX_INDEX_JOURNAL,
  PROGRESS_OUTBOX_INDEX_OPEN,
  PROGRESS_OUTBOX_INDEX_RETRY,
  PROGRESS_OUTBOX_INDEX_SEQUENCE,
  PROGRESS_OUTBOX_INDEX_STATE,
  PROGRESS_OUTBOX_STORE_NAME,
  type ProgressIndexedDatabase,
} from "./progressOutboxIndexedTypes.js";

function createProgressStore(database: IDBDatabase): void {
  const store = database.createObjectStore(PROGRESS_OUTBOX_STORE_NAME);

  store.createIndex(PROGRESS_OUTBOX_INDEX_ACCOUNT, ["apiOrigin", "userId"]);
  store.createIndex(PROGRESS_OUTBOX_INDEX_JOURNAL, ["apiOrigin", "userId", "journalId"]);
  store.createIndex(PROGRESS_OUTBOX_INDEX_OPEN, ["apiOrigin", "userId", "journalId", "phase"]);
  store.createIndex(PROGRESS_OUTBOX_INDEX_ACCOUNT_OPEN, ["apiOrigin", "userId", "phase"]);
  store.createIndex(PROGRESS_OUTBOX_INDEX_RETRY, [
    "apiOrigin",
    "userId",
    "state.kind",
    "state.retryAtMs",
  ]);
  store.createIndex(PROGRESS_OUTBOX_INDEX_SEQUENCE, "sequenceKeys", { multiEntry: true });
  store.createIndex(PROGRESS_OUTBOX_INDEX_STATE, ["apiOrigin", "userId", "state.kind"]);
}

export function openProgressOutboxIndexed(
  factory: IDBFactory = indexedDB,
): Promise<ProgressIndexedDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(PROGRESS_OUTBOX_DATABASE_NAME, PROGRESS_OUTBOX_DATABASE_VERSION);
    let expired = false;

    const timeout = setTimeout(() => {
      expired = true;
      reject(progressError("storage", "Progress-Warteschlange nicht verfügbar."));
    }, 1000);

    const fail = (): void => {
      clearTimeout(timeout);
      expired = true;
      reject(progressError("storage", "Progress-Warteschlange nicht verfügbar."));
    };

    request.addEventListener("upgradeneeded", () => {
      createProgressStore(request.result);
    });
    request.addEventListener("error", fail);
    request.addEventListener("blocked", fail);
    request.addEventListener("success", () => {
      clearTimeout(timeout);
      const database = request.result;

      if (expired) database.close();
      else {
        database.addEventListener("versionchange", () => {
          database.close();
        });
        resolve(wrapIndexedDatabase(database));
      }
    });
  });
}
