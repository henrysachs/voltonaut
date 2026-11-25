/* oxlint-disable typescript/prefer-readonly-parameter-types -- In-memory IndexedDB fixture mirrors readonly domain contracts. */
import type {
  ProgressAccountOwner,
  ProgressJournalOwner,
  ProgressOutboxRow,
  ProgressOutboxState,
} from "./progressOutboxSchema.js";
import type {
  ProgressIndexedCursor,
  ProgressIndexedDatabase,
  ProgressIndexedKey,
  ProgressIndexedRequest,
  ProgressIndexedStore,
  ProgressIndexedTransaction,
} from "./progressOutboxIndexedTypes.js";
import {
  accountKey,
  addIndexes,
  emptyIndexes,
  indexedRows,
  journalKey,
  primaryKey,
  removeIndexes,
  sequenceKey,
  type MemoryIndexes,
} from "./progressOutboxMemoryIndexes.js";
import { createMemoryJournalReads } from "./progressOutboxMemoryJournal.js";
import { emptyMetrics, type MemoryOutboxMetrics } from "./progressOutboxMemoryMetrics.js";

export type { MemoryOutboxMetrics } from "./progressOutboxMemoryMetrics.js";

interface MemoryTransactionState {
  readonly rows: Map<string, ProgressOutboxRow>;
  readonly indexes: MemoryIndexes;
  readonly undo: Map<string, ProgressOutboxRow | undefined>;
  readonly metrics: MemoryOutboxMetrics;
  request<T>(result: T, apply: () => void): ProgressIndexedRequest<T>;
  abort(): void;
}

function createMemoryCounts(state: Readonly<MemoryTransactionState>) {
  const indexes = state.indexes;
  const metrics = state.metrics;
  const read = <T>(value: T): ProgressIndexedRequest<T> => state.request(value, () => {});

  return {
    accountCount: (owner: Readonly<ProgressAccountOwner>) => {
      metrics.accountCount += 1;

      return read(indexes.accounts.get(accountKey(owner)) ?? 0);
    },
    nextRetryAt: (owner: Readonly<ProgressAccountOwner>) => {
      metrics.nextRetryAt += 1;

      const retries = indexes.retries.get(accountKey(owner));

      const next =
        retries === undefined || retries.size === 0 ? undefined : Math.min(...retries.keys());

      return read(next);
    },
    openCount: (owner: Readonly<ProgressAccountOwner>) => {
      metrics.openCount += 1;

      return read(indexes.accountOpen.get(accountKey(owner)) ?? 0);
    },
    stateCount: (owner: Readonly<ProgressAccountOwner>, kind: ProgressOutboxState["kind"]) => {
      metrics.stateCount += 1;

      return read(indexes.states.get(accountKey(owner))?.get(kind) ?? 0);
    },
  };
}

function createMemoryReads(state: Readonly<MemoryTransactionState>) {
  const rows = state.rows;
  const indexes = state.indexes;
  const metrics = state.metrics;
  const read = <T>(value: T): ProgressIndexedRequest<T> => state.request(value, () => {});

  return {
    ...createMemoryCounts(state),
    ...createMemoryJournalReads(state),
    get: (key: ProgressIndexedKey) => {
      metrics.get += 1;

      return read(rows.get(JSON.stringify(key)));
    },
    getAll: () => {
      metrics.getAll += 1;

      return read([...rows.values()].map((row) => structuredClone(row)));
    },
    openRows: (owner: Readonly<ProgressJournalOwner>) => {
      metrics.openRows += 1;

      return read(indexedRows(rows, indexes.open.get(journalKey(owner))).slice(0, 2));
    },
    sequenceRows: (owner: Readonly<ProgressJournalOwner>, sequence: number) => {
      metrics.sequenceRows += 1;

      return read(indexedRows(rows, indexes.sequences.get(sequenceKey(owner, sequence))));
    },
    lastJournalRow: (owner: Readonly<ProgressJournalOwner>) => {
      metrics.lastJournalRow += 1;
      const journal = journalKey(owner);
      const lastTick = indexes.lastTicks.get(journal);
      const key = lastTick === undefined ? undefined : indexes.journals.get(journal)?.get(lastTick);
      const row = key === undefined ? undefined : rows.get(key);

      const cursor: ProgressIndexedCursor = row === undefined ? null : { value: row };

      return read(cursor);
    },
  };
}

function createMemoryStore(state: Readonly<MemoryTransactionState>): ProgressIndexedStore {
  const rows = state.rows;
  const indexes = state.indexes;

  return {
    ...createMemoryReads(state),
    put: (value, key) =>
      state.request(key, () => {
        const id = JSON.stringify(key);
        const previous = rows.get(id);

        if (!state.undo.has(id)) state.undo.set(id, previous);

        if (previous !== undefined) removeIndexes(indexes, previous);
        rows.set(id, structuredClone(value));
        addIndexes(indexes, value);
      }),
    delete: (key) =>
      state.request(undefined, () => {
        const id = JSON.stringify(key);
        const previous = rows.get(id);

        if (!state.undo.has(id)) state.undo.set(id, previous);

        if (previous !== undefined) removeIndexes(indexes, previous);
        rows.delete(id);
      }),
  };
}

function createMemoryRequest<T>(
  result: T,
  apply: () => void,
  active: () => boolean,
  settle: () => void,
): ProgressIndexedRequest<T> {
  const events = new EventTarget();
  const request = Object.assign(events, { result });
  queueMicrotask(() => {
    if (!active()) return;

    try {
      apply();
    } finally {
      settle();
    }

    events.dispatchEvent(new Event("success"));
  });

  return request;
}

function createMemoryObjectStore(state: Readonly<MemoryTransactionState>) {
  return {
    objectStore: (name: string): ProgressIndexedStore => {
      if (name !== "batches") throw new Error(`Unexpected store ${name}`);

      return createMemoryStore(state);
    },
  };
}

function restoreMemoryTransaction(
  rows: Readonly<Map<string, ProgressOutboxRow>>,
  indexes: Readonly<MemoryIndexes>,
  undo: Readonly<Map<string, ProgressOutboxRow | undefined>>,
): void {
  for (const [key, previous] of undo) {
    const current = rows.get(key);

    if (current !== undefined) removeIndexes(indexes, current);
    rows.delete(key);

    if (previous !== undefined) {
      rows.set(key, previous);
      addIndexes(indexes, previous);
    }
  }
}

function createMemoryState(
  events: EventTarget,
  rows: Map<string, ProgressOutboxRow>,
  indexes: MemoryIndexes,
  metrics: MemoryOutboxMetrics,
): MemoryTransactionState {
  const undo = new Map<string, ProgressOutboxRow | undefined>();
  let pending = 0;
  let active = true;

  const complete = (): void => {
    if (!active || pending !== 0) return;
    active = false;
    events.dispatchEvent(new Event("complete"));
  };

  return {
    rows,
    indexes,
    undo,
    metrics,
    request<T>(result: T, apply: () => void): ProgressIndexedRequest<T> {
      pending += 1;

      return createMemoryRequest(
        result,
        apply,
        () => active,
        () => {
          pending -= 1;

          if (pending === 0) queueMicrotask(complete);
        },
      );
    },
    abort: () => {
      if (!active) return;
      active = false;
      restoreMemoryTransaction(rows, indexes, undo);
      events.dispatchEvent(new Event("abort"));
    },
  };
}

function createMemoryTransaction(
  rows: Map<string, ProgressOutboxRow>,
  indexes: MemoryIndexes,
  metrics: MemoryOutboxMetrics,
): ProgressIndexedTransaction {
  const events = new EventTarget();
  const state = createMemoryState(events, rows, indexes, metrics);

  return Object.assign(events, {
    abort: () => {
      state.abort();
    },
    ...createMemoryObjectStore(state),
  });
}

export class MemoryOutboxDatabase implements ProgressIndexedDatabase {
  readonly #rows = new Map<string, ProgressOutboxRow>();
  readonly #indexes = emptyIndexes();
  readonly #metrics = emptyMetrics();

  transaction(name: string, _mode: "readonly" | "readwrite"): ProgressIndexedTransaction {
    if (name !== "batches") throw new Error(`Unexpected store ${name}`);

    return createMemoryTransaction(this.#rows, this.#indexes, this.#metrics);
  }

  seed(row: Readonly<ProgressOutboxRow>): void {
    const key = primaryKey(row);
    const previous = this.#rows.get(key);

    if (previous !== undefined) removeIndexes(this.#indexes, previous);
    this.#rows.set(key, structuredClone(row));
    addIndexes(this.#indexes, row);
  }

  raw(): readonly ProgressOutboxRow[] {
    return [...this.#rows.values()].map((row) => structuredClone(row));
  }

  resetMetrics(): void {
    Object.assign(this.#metrics, emptyMetrics());
  }

  metrics(): MemoryOutboxMetrics {
    return { ...this.#metrics };
  }
}
