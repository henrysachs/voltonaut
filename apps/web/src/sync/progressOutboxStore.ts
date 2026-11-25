/* oxlint-disable typescript/prefer-readonly-parameter-types -- IDBObjectStore is a mutable DOM boundary; this adapter only reads and writes rows. */
/* oxlint-disable typescript/no-unsafe-return -- Raw IDBRequest<any> values are parsed by the row schema before domain use. */
import type {
  ProgressAccountOwner,
  ProgressJournalOwner,
  ProgressOutboxRow,
} from "./progressOutboxSchema.js";
import type { ProgressPendingPageCursor } from "./progressOutbox.js";
import { readPendingProgressPage } from "./progressOutboxPendingPage.js";
import { readNextProgressRetry } from "./progressOutboxRetry.js";
import {
  PROGRESS_OUTBOX_INDEX_ACCOUNT,
  PROGRESS_OUTBOX_INDEX_ACCOUNT_OPEN,
  PROGRESS_OUTBOX_INDEX_JOURNAL,
  PROGRESS_OUTBOX_INDEX_OPEN,
  PROGRESS_OUTBOX_INDEX_SEQUENCE,
  PROGRESS_OUTBOX_INDEX_STATE,
  type ProgressIndexedKey,
  type ProgressIndexedRequest,
  type ProgressIndexedStore,
} from "./progressOutboxIndexedTypes.js";

class IndexedProgressStore implements ProgressIndexedStore {
  readonly #store: IDBObjectStore;

  constructor(store: IDBObjectStore) {
    this.#store = store;
  }

  get(key: ProgressIndexedKey): IDBRequest<ProgressOutboxRow | undefined> {
    return this.#store.get(key);
  }

  getAll(): IDBRequest<ProgressOutboxRow[]> {
    return this.#store.getAll();
  }

  accountCount(owner: Readonly<ProgressAccountOwner>): IDBRequest<number> {
    return this.#store
      .index(PROGRESS_OUTBOX_INDEX_ACCOUNT)
      .count(IDBKeyRange.only([owner.apiOrigin, owner.userId]));
  }

  nextRetryAt(
    owner: Readonly<ProgressAccountOwner>,
    afterMs: number,
  ): ProgressIndexedRequest<number | undefined> {
    return readNextProgressRetry(this.#store, owner, afterMs);
  }

  openCount(owner: Readonly<ProgressAccountOwner>): IDBRequest<number> {
    return this.#store
      .index(PROGRESS_OUTBOX_INDEX_ACCOUNT_OPEN)
      .count(IDBKeyRange.only([owner.apiOrigin, owner.userId, "open"]));
  }

  stateCount(
    owner: Readonly<ProgressAccountOwner>,
    state: ProgressOutboxRow["state"]["kind"],
  ): IDBRequest<number> {
    return this.#store
      .index(PROGRESS_OUTBOX_INDEX_STATE)
      .count(IDBKeyRange.only([owner.apiOrigin, owner.userId, state]));
  }

  openRows(owner: Readonly<ProgressJournalOwner>): IDBRequest<ProgressOutboxRow[]> {
    return this.#store
      .index(PROGRESS_OUTBOX_INDEX_OPEN)
      .getAll(IDBKeyRange.only([owner.apiOrigin, owner.userId, owner.journalId, "open"]), 2);
  }

  journalRows(owner: Readonly<ProgressJournalOwner>): IDBRequest<ProgressOutboxRow[]> {
    return this.#store
      .index(PROGRESS_OUTBOX_INDEX_JOURNAL)
      .getAll(IDBKeyRange.only([owner.apiOrigin, owner.userId, owner.journalId]));
  }

  pendingPage(
    owner: Readonly<ProgressAccountOwner>,
    limit: number,
    after?: Readonly<ProgressPendingPageCursor>,
  ): ProgressIndexedRequest<ProgressOutboxRow[]> {
    return readPendingProgressPage(this.#store, owner, limit, after);
  }

  storedRows(owner: Readonly<ProgressAccountOwner>): IDBRequest<ProgressOutboxRow[]> {
    return this.#store
      .index(PROGRESS_OUTBOX_INDEX_STATE)
      .getAll(IDBKeyRange.only([owner.apiOrigin, owner.userId, "stored"]));
  }

  accountRows(owner: Readonly<ProgressAccountOwner>): IDBRequest<ProgressOutboxRow[]> {
    return this.#store
      .index(PROGRESS_OUTBOX_INDEX_ACCOUNT)
      .getAll(IDBKeyRange.only([owner.apiOrigin, owner.userId]));
  }

  sequenceRows(
    owner: Readonly<ProgressJournalOwner>,
    sequence: number,
  ): IDBRequest<ProgressOutboxRow[]> {
    return this.#store
      .index(PROGRESS_OUTBOX_INDEX_SEQUENCE)
      .getAll(IDBKeyRange.only([owner.apiOrigin, owner.userId, owner.journalId, sequence]));
  }

  lastJournalRow(owner: Readonly<ProgressJournalOwner>): IDBRequest<IDBCursorWithValue | null> {
    return this.#store
      .index(PROGRESS_OUTBOX_INDEX_JOURNAL)
      .openCursor(IDBKeyRange.only([owner.apiOrigin, owner.userId, owner.journalId]), "prev");
  }

  put(value: Readonly<ProgressOutboxRow>, key: ProgressIndexedKey): IDBRequest<IDBValidKey> {
    return this.#store.put(value, key);
  }

  delete(key: ProgressIndexedKey): IDBRequest<undefined> {
    return this.#store.delete(key);
  }
}

export function indexedProgressStore(store: IDBObjectStore): ProgressIndexedStore {
  return new IndexedProgressStore(store);
}
