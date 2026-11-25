/* oxlint-disable typescript/prefer-readonly-parameter-types -- IndexedDB owner inputs are readonly domain contracts. */
import type { ProgressIndexedRequest } from "./progressOutboxIndexedTypes.js";
import type { ProgressPendingPageCursor } from "./progressOutbox.js";
import {
  ProgressOutboxRowSchema,
  type ProgressAccountOwner,
  type ProgressOutboxRow,
} from "./progressOutboxSchema.js";

function pendingPageRange(
  owner: Readonly<ProgressAccountOwner>,
  after?: Readonly<ProgressPendingPageCursor>,
): IDBKeyRange {
  const lower =
    after === undefined
      ? [owner.apiOrigin, owner.userId]
      : [owner.apiOrigin, owner.userId, after.journalId, after.startTick];

  return IDBKeyRange.bound(lower, [owner.apiOrigin, owner.userId, []], after !== undefined, true);
}

export function readPendingProgressPage(
  store: IDBObjectStore,
  owner: Readonly<ProgressAccountOwner>,
  limit: number,
  after?: Readonly<ProgressPendingPageCursor>,
): ProgressIndexedRequest<ProgressOutboxRow[]> {
  const events = new EventTarget();
  const rows: ProgressOutboxRow[] = [];
  const request = Object.assign(events, { result: rows });

  const cursorRequest = store.openCursor(pendingPageRange(owner, after), "next");

  cursorRequest.addEventListener("success", () => {
    try {
      const cursor = cursorRequest.result;

      if (cursor === null || rows.length >= limit) {
        events.dispatchEvent(new Event("success"));

        return;
      }

      const row = ProgressOutboxRowSchema.parse(cursor.value);

      if (row.state.kind !== "stored") rows.push(row);
      cursor.continue();
    } catch {
      try {
        store.transaction.abort();
      } catch {
        // An inactive transaction already rejects the read.
      }

      events.dispatchEvent(new Event("error"));
    }
  });

  return request;
}
