/* oxlint-disable typescript/prefer-readonly-parameter-types -- Outbox inputs are readonly contracts; Oxlint does not follow imported aliases. */
import {
  JournalIdSchema,
  RideProgressCheckpointSchema,
  type RideProgressCheckpoint,
} from "@voltonaut/shared";

import { appendProgressRows, runProgressAppend } from "./progressOutboxAppend.js";
import { sealProgressRow } from "./progressOutboxChanges.js";
import {
  runProgressMarkBlocked,
  runProgressMarkSending,
  runProgressMarkStored,
  runProgressRequeue,
  runProgressView,
} from "./progressOutboxDelivery.js";
import {
  checkProgressFence,
  normalizeProgressFence,
  normalizeProgressOwner,
  progressError,
} from "./progressOutboxFence.js";
import {
  runProgressChange,
  runProgressJournalPending,
  runProgressNextRetryAt,
  runProgressOpenChange,
  runProgressOwnerPurge,
  runProgressPendingPage,
  runProgressStoredCleanup,
  type ProgressIndexedDatabase,
} from "./progressOutboxIndexed.js";
import { openProgressOutboxIndexed } from "./progressOutboxOpen.js";
import {
  PROGRESS_OUTBOX_MAX_ROWS,
  type ProgressAccountOwner,
  type ProgressAppendResult,
  type ProgressMarkBlocked,
  type ProgressMarkSending,
  type ProgressMarkStored,
  type ProgressOutbox,
  type ProgressOutboxRow,
  type ProgressOutboxView,
  type ProgressPendingPageCursor,
  type ProgressWriteFence,
} from "./progressOutbox.js";
import { accountProgressRows } from "./progressOutboxRows.js";

export {
  PROGRESS_OUTBOX_DATABASE_NAME,
  PROGRESS_OUTBOX_DATABASE_VERSION,
  PROGRESS_OUTBOX_STORE_NAME,
} from "./progressOutboxIndexed.js";

export type {
  ProgressIndexedDatabase,
  ProgressIndexedKey,
  ProgressIndexedRequest,
  ProgressIndexedStore,
  ProgressIndexedTransaction,
} from "./progressOutboxIndexed.js";

export { progressOutboxKey } from "./progressOutbox.js";

export { progressFailureState } from "./progressOutboxDelivery.js";

function normalizePageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 0) {
    throw progressError("contract", "Progress-Seitengröße muss eine nichtnegative Ganzzahl sein.");
  }

  return Math.min(limit, PROGRESS_OUTBOX_MAX_ROWS);
}

function normalizePageCursor(
  after: Readonly<ProgressPendingPageCursor> | undefined,
): ProgressPendingPageCursor | undefined {
  if (after === undefined) return undefined;

  if (!Number.isSafeInteger(after.startTick) || after.startTick < 0) {
    throw progressError("contract", "Progress-Seitenzeiger braucht einen nichtnegativen Tick.");
  }

  return { journalId: JournalIdSchema.parse(after.journalId), startTick: after.startTick };
}

class IndexedProgressOutbox implements ProgressOutbox {
  readonly #database: Readonly<ProgressIndexedDatabase>;

  constructor(database: Readonly<ProgressIndexedDatabase>) {
    this.#database = database;
  }

  async append(
    fenceInput: Readonly<ProgressWriteFence>,
    checkpoint: RideProgressCheckpoint,
  ): Promise<ProgressAppendResult> {
    const parsed = RideProgressCheckpointSchema.parse(checkpoint);
    const fence = normalizeProgressFence(fenceInput);
    checkProgressFence(fence);

    if (parsed.source === "sim") return { kind: "ignored", reason: "sim" };

    if (fence.consentVersion <= 0) return { kind: "ignored", reason: "consent" };

    const rows = await runProgressAppend(this.#database, fence, parsed, (read) =>
      appendProgressRows(read, fence, parsed),
    );

    return { kind: "stored", rows };
  }

  async seal(fenceInput: Readonly<ProgressWriteFence>): Promise<ProgressOutboxRow | undefined> {
    const fence = normalizeProgressFence(fenceInput);
    checkProgressFence(fence);

    const row = await runProgressOpenChange(this.#database, fence, fence, (rows) =>
      sealProgressRow(rows, fence),
    );

    return row;
  }

  async prepareDelivery(fenceInput: Readonly<ProgressWriteFence>): Promise<void> {
    const fence = normalizeProgressFence(fenceInput);
    checkProgressFence(fence, true);

    await runProgressOpenChange(this.#database, fence, fence, (rows) =>
      sealProgressRow(rows, fence),
    );
    await runProgressStoredCleanup(this.#database, fence);
  }

  listPending(ownerInput: Readonly<ProgressAccountOwner>): Promise<readonly ProgressOutboxRow[]> {
    const owner = normalizeProgressOwner(ownerInput);

    return runProgressChange(this.#database, "readonly", undefined, (rows) => ({
      value: accountProgressRows(rows, owner).filter((row) => row.state.kind !== "stored"),
    }));
  }

  listPendingPage(
    ownerInput: Readonly<ProgressAccountOwner>,
    limit: number,
    after?: Readonly<ProgressPendingPageCursor>,
  ): Promise<readonly ProgressOutboxRow[]> {
    const owner = normalizeProgressOwner(ownerInput);

    return runProgressPendingPage(
      this.#database,
      owner,
      normalizePageLimit(limit),
      normalizePageCursor(after),
    );
  }

  listJournalPending(
    ownerInput: Readonly<ProgressAccountOwner>,
    journalId: ProgressOutboxRow["journalId"],
  ): Promise<readonly ProgressOutboxRow[]> {
    const owner = normalizeProgressOwner(ownerInput);

    return runProgressJournalPending(this.#database, {
      ...owner,
      journalId: JournalIdSchema.parse(journalId),
    });
  }

  nextRetryAt(
    ownerInput: Readonly<ProgressAccountOwner>,
    afterMs: number,
  ): Promise<number | undefined> {
    const owner = normalizeProgressOwner(ownerInput);

    if (!Number.isSafeInteger(afterMs) || afterMs < 0) {
      throw progressError("contract", "Progress-Retry-Zeit muss eine nichtnegative Ganzzahl sein.");
    }

    return runProgressNextRetryAt(this.#database, owner, afterMs);
  }

  purgeOwner(ownerInput: Readonly<ProgressAccountOwner>): Promise<void> {
    return runProgressOwnerPurge(this.#database, normalizeProgressOwner(ownerInput));
  }

  async markSending(input: Readonly<ProgressMarkSending>): Promise<ProgressOutboxRow> {
    const row = await runProgressMarkSending(this.#database, input);

    return row;
  }

  markStored(input: Readonly<ProgressMarkStored>): Promise<ProgressOutboxRow> {
    return runProgressMarkStored(this.#database, input);
  }

  async markBlocked(input: Readonly<ProgressMarkBlocked>): Promise<ProgressOutboxRow> {
    const row = await runProgressMarkBlocked(this.#database, input);

    return row;
  }

  async requeue(
    row: Readonly<ProgressOutboxRow>,
    fence: Readonly<ProgressWriteFence>,
    nowMs: number,
  ): Promise<ProgressOutboxRow> {
    const queued = await runProgressRequeue(this.#database, row, fence, nowMs);

    return queued;
  }

  state(ownerInput: Readonly<ProgressAccountOwner>): Promise<ProgressOutboxView> {
    const owner = normalizeProgressOwner(ownerInput);

    return runProgressView(this.#database, owner);
  }

  view(owner: Readonly<ProgressAccountOwner>): Promise<ProgressOutboxView> {
    return this.state(owner);
  }
}

export function createProgressOutboxDatabase(
  database: Readonly<ProgressIndexedDatabase>,
): ProgressOutbox {
  return new IndexedProgressOutbox(database);
}

export function openProgressOutboxDatabase(
  factory: IDBFactory = indexedDB,
): Promise<ProgressOutbox> {
  return openProgressOutboxIndexed(factory).then(createProgressOutboxDatabase);
}
