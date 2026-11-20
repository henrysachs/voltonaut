import { StoredProfileRecordSchema, type StoredProfileRecord } from "@voltonaut/shared";
import { PROFILE_RECORD_KEY, PROFILE_STORE_NAME, type ProfileWriteLease } from "./profile-store.js";

type ProfileTransaction = Readonly<
  Pick<IDBTransaction, "abort" | "addEventListener" | "removeEventListener">
>;

function abortIfPending(transaction: ProfileTransaction): "aborted" | "finished" {
  try {
    transaction.abort();

    return "aborted";
  } catch {
    return "finished";
  }
}

function watchCommit(transaction: ProfileTransaction, lease?: ProfileWriteLease): Promise<void> {
  return new Promise((resolve, reject) => {
    function cleanup(): void {
      lease?.signal.removeEventListener("abort", revoke);
      transaction.removeEventListener("complete", complete);
      transaction.removeEventListener("abort", failed);
    }

    function failed(): void {
      cleanup();
      reject(new Error("Profiltransaktion nicht gespeichert oder widerrufen."));
    }

    function complete(): void {
      if (lease?.signal.aborted === true || lease?.current() === false) {
        failed();

        return;
      }

      cleanup();
      resolve();
    }

    function revoke(): void {
      if (abortIfPending(transaction) === "finished") failed();
    }

    transaction.addEventListener("complete", complete, { once: true });
    transaction.addEventListener("abort", failed, { once: true });
    lease?.signal.addEventListener("abort", revoke, { once: true });

    if (lease?.signal.aborted === true || lease?.current() === false) revoke();
  });
}

export async function writeProfileRecord(
  database: Readonly<Pick<IDBDatabase, "transaction">>,
  record: StoredProfileRecord,
  lease?: ProfileWriteLease,
): Promise<void> {
  const parsed = StoredProfileRecordSchema.parse(record);

  if (lease?.signal.aborted === true || lease?.current() === false)
    throw new Error("Profilauftrag widerrufen.");
  const transaction = database.transaction(PROFILE_STORE_NAME, "readwrite");
  const completion = watchCommit(transaction, lease);

  try {
    const request = transaction.objectStore(PROFILE_STORE_NAME).put(parsed, PROFILE_RECORD_KEY);
    request.addEventListener(
      "success",
      () => {
        if (lease?.current() === false) abortIfPending(transaction);
      },
      { once: true },
    );
  } catch {
    abortIfPending(transaction);
  }

  await completion;
}
