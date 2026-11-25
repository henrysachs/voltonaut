/* oxlint-disable typescript/prefer-readonly-parameter-types -- In-memory journal reads mirror readonly IndexedDB contracts. */
import type {
  ProgressAccountOwner,
  ProgressJournalOwner,
  ProgressOutboxRow,
} from "./progressOutboxSchema.js";
import type { ProgressIndexedRequest } from "./progressOutboxIndexedTypes.js";
import type { ProgressPendingPageCursor } from "./progressOutbox.js";
import {
  accountKey,
  indexedRows,
  journalKey,
  pendingRows,
  type MemoryIndexes,
} from "./progressOutboxMemoryIndexes.js";
import type { MemoryOutboxMetrics } from "./progressOutboxMemoryMetrics.js";

interface MemoryJournalReadState {
  readonly rows: Readonly<Map<string, ProgressOutboxRow>>;
  readonly indexes: Readonly<MemoryIndexes>;
  readonly metrics: MemoryOutboxMetrics;
  request<T>(result: T, apply: () => void): ProgressIndexedRequest<T>;
}

export function createMemoryJournalReads(state: Readonly<MemoryJournalReadState>) {
  const rows = state.rows;
  const indexes = state.indexes;
  const metrics = state.metrics;
  const read = <T>(value: T): ProgressIndexedRequest<T> => state.request(value, () => {});

  return {
    journalRows: (owner: Readonly<ProgressJournalOwner>) => {
      metrics.journalRows += 1;

      return read(indexedRows(rows, indexes.journals.get(journalKey(owner))?.values()));
    },
    pendingPage: (
      owner: Readonly<ProgressAccountOwner>,
      limit: number,
      after?: Readonly<ProgressPendingPageCursor>,
    ) => {
      metrics.pendingPage += 1;

      return read(pendingRows(rows, indexes, owner, limit, after));
    },
    storedRows: (owner: Readonly<ProgressAccountOwner>) => {
      metrics.storedRows += 1;

      return read(indexedRows(rows, indexes.stored.get(accountKey(owner))));
    },
    accountRows: (owner: Readonly<ProgressAccountOwner>) => {
      metrics.accountRows += 1;

      const journals = indexes.accountJournals.get(accountKey(owner)) ?? [];

      return read(
        [...journals].flatMap((journalId) =>
          indexedRows(rows, indexes.journals.get(journalKey({ ...owner, journalId }))?.values()),
        ),
      );
    },
  };
}
