/* oxlint-disable typescript/prefer-readonly-parameter-types -- Keyed append inputs are readonly contracts; Oxlint does not follow imported aliases. */
import type { RideProgressCheckpoint } from "@voltonaut/shared";

import {
  asProgressError,
  checkProgressFence,
  progressError,
  progressSessionError,
} from "./progressOutboxFence.js";
import { applyProgressWrites, watchProgressTransaction } from "./progressOutboxIndexed.js";
import {
  PROGRESS_OUTBOX_STORE_NAME,
  type ProgressAppendRead,
  type ProgressIndexedDatabase,
  type ProgressIndexedRequest,
  type ProgressIndexedStore,
} from "./progressOutboxIndexedTypes.js";
import type { ProgressOutboxRow } from "./progressOutboxSchema.js";
import type { ProgressWriteFence } from "./progressOutbox.js";
import type { ProgressChange } from "./progressOutboxRows.js";

class AppendReadCollector {
  readonly #ready: () => void;
  #pending = 4;
  #accountCount = 0;
  #openRows: readonly ProgressOutboxRow[] = [];
  #sequenceRows: readonly ProgressOutboxRow[] = [];
  #lastRow: ProgressOutboxRow | undefined;

  constructor(
    store: ProgressIndexedStore,
    fence: Readonly<ProgressWriteFence>,
    checkpoint: RideProgressCheckpoint,
    ready: () => void,
  ) {
    this.#ready = ready;
    this.listen(store.accountCount(fence), (value) => {
      this.#accountCount = value;
    });
    this.listen(store.openRows(fence), (value) => {
      this.#openRows = value;
    });
    this.listen(store.sequenceRows(fence, checkpoint.sequence), (value) => {
      this.#sequenceRows = value;
    });
    this.listen(store.lastJournalRow(fence), (value) => {
      this.#lastRow = value?.value;
    });
  }

  value(): ProgressAppendRead {
    return {
      accountCount: this.#accountCount,
      openRows: this.#openRows,
      sequenceRows: this.#sequenceRows,
      lastRow: this.#lastRow,
    };
  }

  private listen<T>(request: ProgressIndexedRequest<T>, set: (value: T) => void): void {
    request.addEventListener("success", () => {
      set(request.result);
      this.#pending -= 1;

      if (this.#pending === 0) this.#ready();
    });
  }
}

export async function runProgressAppend<T>(
  database: Readonly<ProgressIndexedDatabase>,
  fence: Readonly<ProgressWriteFence>,
  checkpoint: RideProgressCheckpoint,
  decide: (read: Readonly<ProgressAppendRead>) => ProgressChange<T>,
): Promise<T> {
  checkProgressFence(fence);
  const transaction = database.transaction(PROGRESS_OUTBOX_STORE_NAME, "readwrite");
  const watch = watchProgressTransaction(transaction, fence);
  const store = transaction.objectStore(PROGRESS_OUTBOX_STORE_NAME);
  let completed: { readonly value: T } | undefined;

  const collector = new AppendReadCollector(store, fence, checkpoint, () => {
    try {
      if (fence.signal.aborted || !fence.current()) {
        watch.fail(progressSessionError());

        return;
      }

      const change = decide(collector.value());
      completed = { value: change.value };
      applyProgressWrites(transaction, change, fence, watch);
    } catch (cause) {
      watch.fail(asProgressError(cause));
    }
  });

  await watch.done;

  if (completed === undefined) throw progressError("storage", "Progress-Anhang ohne Ergebnis.");

  return completed.value;
}
