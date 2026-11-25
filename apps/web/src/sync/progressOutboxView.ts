/* oxlint-disable typescript/prefer-readonly-parameter-types -- View inputs are readonly contracts; Oxlint does not follow imported aliases. */
import { asProgressError, progressError } from "./progressOutboxFence.js";
import { watchProgressTransaction } from "./progressOutboxTransaction.js";
import {
  PROGRESS_OUTBOX_STORE_NAME,
  type ProgressIndexedDatabase,
  type ProgressIndexedRequest,
  type ProgressIndexedStore,
} from "./progressOutboxIndexedTypes.js";
import { PROGRESS_OUTBOX_MAX_ROWS, type ProgressAccountOwner } from "./progressOutboxSchema.js";
import type { ProgressOutboxCounts, ProgressOutboxView } from "./progressOutbox.js";

type ProgressViewCounts = Readonly<Omit<ProgressOutboxCounts, "remaining">>;

class ProgressViewReadCollector {
  readonly #ready: () => void;
  #pending = 6;
  #rows = 0;
  #queued = 0;
  #sending = 0;
  #blocked = 0;
  #stored = 0;
  #open = 0;

  constructor(
    store: ProgressIndexedStore,
    owner: Readonly<ProgressAccountOwner>,
    ready: () => void,
  ) {
    this.#ready = ready;
    this.listen(store.accountCount(owner), (value) => {
      this.#rows = value;
    });
    this.listen(store.stateCount(owner, "queued"), (value) => {
      this.#queued = value;
    });
    this.listen(store.stateCount(owner, "sending"), (value) => {
      this.#sending = value;
    });
    this.listen(store.stateCount(owner, "blocked"), (value) => {
      this.#blocked = value;
    });
    this.listen(store.stateCount(owner, "stored"), (value) => {
      this.#stored = value;
    });
    this.listen(store.openCount(owner), (value) => {
      this.#open = value;
    });
  }

  value(): ProgressViewCounts {
    return {
      rows: this.#rows,
      queued: this.#queued,
      sending: this.#sending,
      blocked: this.#blocked,
      stored: this.#stored,
      open: this.#open,
    };
  }

  private listen(request: ProgressIndexedRequest<number>, set: (value: number) => void): void {
    request.addEventListener("success", () => {
      set(request.result);
      this.#pending -= 1;

      if (this.#pending === 0) this.#ready();
    });
  }
}

export function progressOutboxView(counts: ProgressViewCounts): ProgressOutboxView {
  const complete = {
    ...counts,
    remaining: Math.max(0, PROGRESS_OUTBOX_MAX_ROWS - counts.rows),
  };

  return counts.rows >= PROGRESS_OUTBOX_MAX_ROWS
    ? { kind: "blocked", cause: "capacity", counts: complete }
    : { kind: "ready", counts: complete };
}

export async function runProgressView(
  database: Readonly<ProgressIndexedDatabase>,
  owner: Readonly<ProgressAccountOwner>,
): Promise<ProgressOutboxView> {
  const transaction = database.transaction(PROGRESS_OUTBOX_STORE_NAME, "readonly");
  const watch = watchProgressTransaction(transaction);
  let completed: { readonly value: ProgressOutboxView } | undefined;

  try {
    const collector = new ProgressViewReadCollector(
      transaction.objectStore(PROGRESS_OUTBOX_STORE_NAME),
      owner,
      () => {
        try {
          completed = { value: progressOutboxView(collector.value()) };
        } catch (cause) {
          watch.fail(asProgressError(cause));
        }
      },
    );
  } catch (cause) {
    watch.fail(asProgressError(cause));
  }

  await watch.done;

  if (completed === undefined) {
    throw progressError("storage", "Progress-Transaktion ohne Ergebnis.");
  }

  return completed.value;
}
