import { StoredProfileRecordSchema, type StoredProfileRecord } from "@voltonaut/shared";

import type { ProfileDatabase } from "./profile-store.js";
import {
  PROFILE_DATABASE_NAME,
  PROFILE_RECORD_KEY,
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORE_NAME,
} from "./profile-store.js";

function requestToPromise<T>(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- IDBRequest is the external DOM contract type; the handlers below are its documented usage.
  request: IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });

    request.addEventListener("error", () => {
      reject(new Error("profile store request failed"));
    });
  });
}

function wrapDatabase(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- IDBDatabase is the external DOM contract type for the IndexedDB glue.
  database: IDBDatabase,
): ProfileDatabase {
  return {
    async loadRecord(): Promise<StoredProfileRecord | undefined> {
      const store = database
        .transaction(PROFILE_STORE_NAME, "readonly")
        .objectStore(PROFILE_STORE_NAME);

      const raw: unknown = await requestToPromise(store.get(PROFILE_RECORD_KEY));
      const parsed = StoredProfileRecordSchema.safeParse(raw);

      return parsed.success ? parsed.data : undefined;
    },

    async saveRecord(record: StoredProfileRecord): Promise<void> {
      const store = database
        .transaction(PROFILE_STORE_NAME, "readwrite")
        .objectStore(PROFILE_STORE_NAME);

      await requestToPromise(store.put(record, PROFILE_RECORD_KEY));
    },
  };
}

/** Opens (and creates on first run) the versioned profile database, DOM API only. */
export function openProfileDatabase(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- IDBFactory is the external DOM contract type; main.ts injects the browser global.
  indexedDB: IDBFactory,
): Promise<ProfileDatabase> {
  return new Promise<ProfileDatabase>((resolve, reject) => {
    const request = indexedDB.open(PROFILE_DATABASE_NAME, PROFILE_SCHEMA_VERSION);
    let unavailable = false;

    const fail = (): void => {
      unavailable = true;
      reject(new Error("profile database could not be opened"));
    };

    const timeout = setTimeout(fail, 1000);

    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(PROFILE_STORE_NAME);
    });

    request.addEventListener("success", () => {
      clearTimeout(timeout);

      if (unavailable) {
        request.result.close();

        return;
      }

      resolve(wrapDatabase(request.result));
    });

    request.addEventListener("error", () => {
      clearTimeout(timeout);
      fail();
    });
    request.addEventListener("blocked", () => {
      clearTimeout(timeout);
      fail();
    });
  });
}
