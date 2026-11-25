export interface MemoryOutboxMetrics {
  getAll: number;
  get: number;
  accountCount: number;
  nextRetryAt: number;
  openCount: number;
  stateCount: number;
  openRows: number;
  journalRows: number;
  pendingPage: number;
  storedRows: number;
  accountRows: number;
  sequenceRows: number;
  lastJournalRow: number;
}

export function emptyMetrics(): MemoryOutboxMetrics {
  return {
    getAll: 0,
    get: 0,
    accountCount: 0,
    nextRetryAt: 0,
    openCount: 0,
    stateCount: 0,
    openRows: 0,
    journalRows: 0,
    pendingPage: 0,
    storedRows: 0,
    accountRows: 0,
    sequenceRows: 0,
    lastJournalRow: 0,
  };
}
