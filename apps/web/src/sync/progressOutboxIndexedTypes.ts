/* oxlint-disable typescript/prefer-readonly-parameter-types -- IndexedDB contracts are readonly DOM boundaries. */
import type {
  ProgressAccountOwner,
  ProgressJournalOwner,
  ProgressOutboxRow,
} from "./progressOutboxSchema.js";
import type { ProgressPendingPageCursor } from "./progressOutbox.js";

export const PROGRESS_OUTBOX_DATABASE_NAME = "voltonaut-progress-outbox";
export const PROGRESS_OUTBOX_DATABASE_VERSION = 1;
export const PROGRESS_OUTBOX_STORE_NAME = "batches";
export const PROGRESS_OUTBOX_INDEX_ACCOUNT = "account";
export const PROGRESS_OUTBOX_INDEX_JOURNAL = "journal";
export const PROGRESS_OUTBOX_INDEX_OPEN = "journal-open";
export const PROGRESS_OUTBOX_INDEX_ACCOUNT_OPEN = "account-open";
export const PROGRESS_OUTBOX_INDEX_RETRY = "account-retry";
export const PROGRESS_OUTBOX_INDEX_SEQUENCE = "journal-sequence";
export const PROGRESS_OUTBOX_INDEX_STATE = "account-state";

export type ProgressIndexedKey = [string, string, string, number];

export type ProgressIndexedCursor = Readonly<{ value: ProgressOutboxRow }> | null;

export interface ProgressIndexedRequest<T> extends EventTarget {
  readonly result: T;
}

export interface ProgressIndexedStore {
  get(key: ProgressIndexedKey): ProgressIndexedRequest<ProgressOutboxRow | undefined>;
  getAll(): ProgressIndexedRequest<ProgressOutboxRow[]>;
  accountCount(owner: Readonly<ProgressAccountOwner>): ProgressIndexedRequest<number>;
  nextRetryAt(owner: Readonly<ProgressAccountOwner>): ProgressIndexedRequest<number | undefined>;
  openCount(owner: Readonly<ProgressAccountOwner>): ProgressIndexedRequest<number>;
  stateCount(
    owner: Readonly<ProgressAccountOwner>,
    state: ProgressOutboxRow["state"]["kind"],
  ): ProgressIndexedRequest<number>;
  openRows(owner: Readonly<ProgressJournalOwner>): ProgressIndexedRequest<ProgressOutboxRow[]>;
  journalRows(owner: Readonly<ProgressJournalOwner>): ProgressIndexedRequest<ProgressOutboxRow[]>;
  pendingPage(
    owner: Readonly<ProgressAccountOwner>,
    limit: number,
    after?: Readonly<ProgressPendingPageCursor>,
  ): ProgressIndexedRequest<ProgressOutboxRow[]>;
  storedRows(owner: Readonly<ProgressAccountOwner>): ProgressIndexedRequest<ProgressOutboxRow[]>;
  sequenceRows(
    owner: Readonly<ProgressJournalOwner>,
    sequence: number,
  ): ProgressIndexedRequest<ProgressOutboxRow[]>;
  lastJournalRow(
    owner: Readonly<ProgressJournalOwner>,
  ): ProgressIndexedRequest<ProgressIndexedCursor>;
  put(
    value: Readonly<ProgressOutboxRow>,
    key: ProgressIndexedKey,
  ): ProgressIndexedRequest<IDBValidKey>;
  delete(key: ProgressIndexedKey): ProgressIndexedRequest<undefined>;
}

export interface ProgressIndexedTransaction extends EventTarget {
  abort(): void;
  objectStore(name: string): ProgressIndexedStore;
}

export interface ProgressIndexedDatabase {
  transaction(name: string, mode: "readonly" | "readwrite"): ProgressIndexedTransaction;
}

export interface ProgressAppendRead {
  readonly accountCount: number;
  readonly openRows: readonly ProgressOutboxRow[];
  readonly sequenceRows: readonly ProgressOutboxRow[];
  readonly lastRow: ProgressOutboxRow | undefined;
}
