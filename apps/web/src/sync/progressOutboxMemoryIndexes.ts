/* oxlint-disable typescript/prefer-readonly-parameter-types -- In-memory index helpers mirror readonly row contracts. */
import type {
  ProgressAccountOwner,
  ProgressJournalOwner,
  ProgressOutboxRow,
  ProgressOutboxState,
} from "./progressOutboxSchema.js";
import type { ProgressPendingPageCursor } from "./progressOutbox.js";

export interface MemoryIndexes {
  readonly accounts: Map<string, number>;
  readonly journals: Map<string, Map<number, string>>;
  readonly accountJournals: Map<string, Set<string>>;
  readonly lastTicks: Map<string, number>;
  readonly open: Map<string, Set<string>>;
  readonly accountOpen: Map<string, number>;
  readonly states: Map<string, Map<ProgressOutboxState["kind"], number>>;
  readonly retries: Map<string, Map<number, Set<string>>>;
  readonly stored: Map<string, Set<string>>;
  readonly sequences: Map<string, Set<string>>;
}

export function primaryKey(row: Readonly<ProgressOutboxRow>): string {
  return JSON.stringify([row.apiOrigin, row.userId, row.journalId, row.startTick]);
}

export function accountKey(owner: Readonly<ProgressAccountOwner>): string {
  return JSON.stringify([owner.apiOrigin, owner.userId]);
}

export function journalKey(
  owner: Readonly<{
    apiOrigin: string;
    userId: string;
    journalId: string;
  }>,
): string {
  return JSON.stringify([owner.apiOrigin, owner.userId, owner.journalId]);
}

export function sequenceKey(owner: Readonly<ProgressJournalOwner>, sequence: number): string {
  return JSON.stringify([owner.apiOrigin, owner.userId, owner.journalId, sequence]);
}

export function emptyIndexes(): MemoryIndexes {
  return {
    accounts: new Map(),
    journals: new Map(),
    accountJournals: new Map(),
    lastTicks: new Map(),
    open: new Map(),
    accountOpen: new Map(),
    states: new Map(),
    retries: new Map(),
    stored: new Map(),
    sequences: new Map(),
  };
}

export function addIndexes(indexes: MemoryIndexes, row: Readonly<ProgressOutboxRow>): void {
  const account = accountKey(row);
  const journal = journalKey(row);
  indexes.accounts.set(account, (indexes.accounts.get(account) ?? 0) + 1);
  const ticks = indexes.journals.get(journal) ?? new Map<number, string>();
  ticks.set(row.startTick, primaryKey(row));
  indexes.journals.set(journal, ticks);
  const journals = indexes.accountJournals.get(account) ?? new Set<string>();
  journals.add(row.journalId);
  indexes.accountJournals.set(account, journals);
  const lastTick = indexes.lastTicks.get(journal);

  if (lastTick === undefined || row.startTick > lastTick) {
    indexes.lastTicks.set(journal, row.startTick);
  }

  if (row.phase === "open") {
    const open = indexes.open.get(journal) ?? new Set<string>();
    open.add(primaryKey(row));
    indexes.open.set(journal, open);
    indexes.accountOpen.set(account, (indexes.accountOpen.get(account) ?? 0) + 1);
  }

  const states = indexes.states.get(account) ?? new Map<ProgressOutboxState["kind"], number>();
  states.set(row.state.kind, (states.get(row.state.kind) ?? 0) + 1);
  indexes.states.set(account, states);

  if (row.state.kind === "queued") {
    const retries = indexes.retries.get(account) ?? new Map<number, Set<string>>();
    const keys = retries.get(row.state.retryAtMs) ?? new Set<string>();
    keys.add(primaryKey(row));
    retries.set(row.state.retryAtMs, keys);
    indexes.retries.set(account, retries);
  }

  if (row.state.kind === "stored") {
    const stored = indexes.stored.get(account) ?? new Set<string>();
    stored.add(primaryKey(row));
    indexes.stored.set(account, stored);
  }

  for (const sequenceKeyValue of row.sequenceKeys) {
    const key = JSON.stringify(sequenceKeyValue);
    const rows = indexes.sequences.get(key) ?? new Set<string>();
    rows.add(primaryKey(row));
    indexes.sequences.set(key, rows);
  }
}

function removeRetryIndex(
  indexes: MemoryIndexes,
  account: string,
  row: Readonly<ProgressOutboxRow>,
): void {
  if (row.state.kind !== "queued") return;

  const retries = indexes.retries.get(account);
  const keys = retries?.get(row.state.retryAtMs);
  keys?.delete(primaryKey(row));

  if (keys?.size === 0) retries?.delete(row.state.retryAtMs);

  if (retries?.size === 0) indexes.retries.delete(account);
}

export function removeIndexes(indexes: MemoryIndexes, row: Readonly<ProgressOutboxRow>): void {
  const account = accountKey(row);
  const journal = journalKey(row);
  const count = (indexes.accounts.get(account) ?? 1) - 1;

  if (count === 0) indexes.accounts.delete(account);
  else indexes.accounts.set(account, count);
  const ticks = indexes.journals.get(journal);
  ticks?.delete(row.startTick);

  if (ticks?.size === 0) {
    const journals = indexes.accountJournals.get(account);
    journals?.delete(row.journalId);

    if (journals?.size === 0) indexes.accountJournals.delete(account);
  }

  if (indexes.lastTicks.get(journal) === row.startTick) {
    if (ticks === undefined || ticks.size === 0) indexes.lastTicks.delete(journal);
    else indexes.lastTicks.set(journal, Math.max(...ticks.keys()));
  }

  if (row.phase === "open") {
    indexes.open.get(journal)?.delete(primaryKey(row));
    const openCount = (indexes.accountOpen.get(account) ?? 1) - 1;

    if (openCount === 0) indexes.accountOpen.delete(account);
    else indexes.accountOpen.set(account, openCount);
  }

  const states = indexes.states.get(account);
  const stateCount = (states?.get(row.state.kind) ?? 1) - 1;

  if (states === undefined || stateCount === 0) states?.delete(row.state.kind);
  else states.set(row.state.kind, stateCount);

  if (states?.size === 0) indexes.states.delete(account);

  removeRetryIndex(indexes, account, row);
  indexes.stored.get(account)?.delete(primaryKey(row));

  for (const sequenceKeyValue of row.sequenceKeys) {
    indexes.sequences.get(JSON.stringify(sequenceKeyValue))?.delete(primaryKey(row));
  }
}

export function indexedRows(
  rows: ReadonlyMap<string, ProgressOutboxRow>,
  keys: Iterable<string> | undefined,
): ProgressOutboxRow[] {
  return [...(keys ?? [])].flatMap((key) => {
    const row = rows.get(key);

    return row === undefined ? [] : [structuredClone(row)];
  });
}

export function pendingRows(
  rows: ReadonlyMap<string, ProgressOutboxRow>,
  indexes: Readonly<MemoryIndexes>,
  owner: Readonly<ProgressAccountOwner>,
  limit: number,
  after?: Readonly<ProgressPendingPageCursor>,
): ProgressOutboxRow[] {
  const pending: ProgressOutboxRow[] = [];

  if (limit <= 0) return pending;

  const journals = [...(indexes.accountJournals.get(accountKey(owner)) ?? [])].toSorted();

  for (const journal of journals) {
    if (after !== undefined && journal < after.journalId) continue;

    const ticks = indexes.journals.get(journalKey({ ...owner, journalId: journal }));

    if (ticks === undefined) continue;

    for (const tick of [...ticks.keys()].toSorted((left, right) => left - right)) {
      if (after !== undefined && journal === after.journalId && tick <= after.startTick) continue;

      const key = ticks.get(tick);
      const row = key === undefined ? undefined : rows.get(key);

      if (row === undefined || row.state.kind === "stored") continue;

      pending.push(structuredClone(row));

      if (pending.length >= limit) return pending;
    }
  }

  return pending;
}
