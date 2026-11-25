/* oxlint-disable typescript/prefer-readonly-parameter-types -- IndexedDB owner inputs are readonly domain contracts. */
import {
  PROGRESS_OUTBOX_INDEX_RETRY,
  type ProgressIndexedRequest,
} from "./progressOutboxIndexedTypes.js";
import { ProgressOutboxRowSchema, type ProgressAccountOwner } from "./progressOutboxSchema.js";

function queuedRetryRange(owner: Readonly<ProgressAccountOwner>): IDBKeyRange {
  return IDBKeyRange.bound(
    [owner.apiOrigin, owner.userId, "queued", 0],
    [owner.apiOrigin, owner.userId, "queued", Number.MAX_SAFE_INTEGER],
  );
}

class ProgressRetryRequest
  extends EventTarget
  implements ProgressIndexedRequest<number | undefined>
{
  #retryAtMs: number | undefined;

  get result(): number | undefined {
    return this.#retryAtMs;
  }

  resolve(value?: number): void {
    this.#retryAtMs = value;
    this.dispatchEvent(new Event("success"));
  }

  reject(): void {
    this.dispatchEvent(new Event("error"));
  }
}

export function readNextProgressRetry(
  store: IDBObjectStore,
  owner: Readonly<ProgressAccountOwner>,
): ProgressIndexedRequest<number | undefined> {
  const request = new ProgressRetryRequest();

  const cursorRequest = store
    .index(PROGRESS_OUTBOX_INDEX_RETRY)
    .openCursor(queuedRetryRange(owner), "next");

  cursorRequest.addEventListener("success", () => {
    try {
      const cursor = cursorRequest.result;

      if (cursor === null) {
        request.resolve();

        return;
      }

      const row = ProgressOutboxRowSchema.parse(cursor.value);

      if (row.state.kind !== "queued") throw new Error("Progress retry index kind mismatch");
      request.resolve(row.state.retryAtMs);
    } catch {
      try {
        store.transaction.abort();
      } catch {
        // An inactive transaction already rejects the read.
      }

      request.reject();
    }
  });

  cursorRequest.addEventListener("error", () => {
    request.reject();
  });

  return request;
}
