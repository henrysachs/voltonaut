import { DEFAULT_RIDER_PROFILE, type StoredProfileRecord } from "@voltonaut/shared";

const releases = new Map<string, () => Promise<void>>();

export function holdDatabase(name: "voltonaut" | "voltonaut-account-outbox"): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.addEventListener("error", () => {
      reject(new Error("Native lock setup failed"));
    });
    request.addEventListener("success", () => {
      const database = request.result;

      const transaction = database.transaction(
        name === "voltonaut" ? "profile" : "outbox",
        "readwrite",
      );

      const store = transaction.objectStore(name === "voltonaut" ? "profile" : "outbox");
      let state: "held" | "released" = "held";

      const complete = new Promise<void>((done) => {
        transaction.addEventListener("complete", () => {
          database.close();
          done();
        });
      });

      releases.set(name, () => {
        state = "released";

        return complete;
      });

      function keep(): void {
        const read = store.get("native-test-lock");
        read.addEventListener("success", () => {
          resolve();

          if (state === "held") keep();
        });
      }

      keep();
    });
  });
}

export async function releaseDatabase(name: string): Promise<void> {
  const release = releases.get(name);

  if (release === undefined) throw new Error("Native test lock missing");
  await release();
  releases.delete(name);
}

export async function savedName(): Promise<string | undefined> {
  const { openProfileDatabase } = await import("../src/sync/profile-database.js");

  return (await (await openProfileDatabase(indexedDB)).loadRecord())?.profile.displayName;
}

export interface PendingInput {
  readonly apiOrigin: string;
  readonly userId: string;
}

export async function queuePending(owner: PendingInput): Promise<void> {
  const { openAccountOutbox } = await import("../src/sync/accountOutboxDatabase.js");
  const { newOutboxRow } = await import("../src/sync/accountOutbox.js");
  await (
    await openAccountOutbox()
  ).claim(
    newOutboxRow(owner, { ...DEFAULT_RIDER_PROFILE, displayName: "Pending Local" }, Date.now()),
  );
}

export async function pendingName(owner: PendingInput): Promise<string | undefined> {
  const { openAccountOutbox } = await import("../src/sync/accountOutboxDatabase.js");
  const rows = await (await openAccountOutbox()).list(owner);
  const row = rows.find((entry) => entry.kind === "profile");

  return row?.payload && "displayName" in row.payload ? row.payload.displayName : undefined;
}

export async function selectionStatus(): Promise<{
  readonly held: boolean;
  readonly pending: boolean;
}> {
  const state = await navigator.locks.query();

  return {
    held:
      state.held?.some(
        (lock: Readonly<LockInfo>) => lock.name === "voltonaut-profile-selection",
      ) === true,
    pending:
      state.pending?.some(
        (lock: Readonly<LockInfo>) => lock.name === "voltonaut-profile-selection",
      ) === true,
  };
}

export async function corruptOutbox(owner: PendingInput): Promise<void> {
  const { newOutboxRow, outboxKey } = await import("../src/sync/accountOutbox.js");
  await queuePending(owner);
  const row = newOutboxRow(owner, DEFAULT_RIDER_PROFILE, Date.now());
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("voltonaut-account-outbox", 1);
    request.addEventListener("success", () => {
      const database = request.result;
      const transaction = database.transaction("outbox", "readwrite");
      transaction
        .objectStore("outbox")
        .put({ ...row, state: { kind: "invalid" } }, [...outboxKey(row)]);
      transaction.addEventListener("complete", () => {
        database.close();
        resolve();
      });
      transaction.addEventListener("abort", () => {
        database.close();
        reject(new Error("Native corruption setup failed"));
      });
    });
    request.addEventListener("error", () => {
      reject(new Error("Native corruption database failed"));
    });
  });
}

export async function queuedRevocation() {
  const { openProfileDatabase } = await import("../src/sync/profile-database.js");
  const database = await openProfileDatabase(indexedDB);
  await database.saveRecord({
    schemaVersion: 1,
    profile: { ...DEFAULT_RIDER_PROFILE, displayName: "Previous" },
  });
  await holdDatabase("voltonaut");
  const controller = new AbortController();

  const writing = database.saveRecord(
    { schemaVersion: 1, profile: { ...DEFAULT_RIDER_PROFILE, displayName: "Revoked" } },
    { signal: controller.signal, current: () => !controller.signal.aborted },
  );

  const result = writing.then(() => "stored").catch(() => "aborted");
  controller.abort();
  await releaseDatabase("voltonaut");

  return { outcome: await result, name: await savedName() };
}

export async function abortAfterPut(mode: "signal" | "transaction") {
  const { openProfileDatabase } = await import("../src/sync/profile-database.js");
  const database = await openProfileDatabase(indexedDB);
  await database.saveRecord({
    schemaVersion: 1,
    profile: { ...DEFAULT_RIDER_PROFILE, displayName: "Previous" },
  });
  const controller = new AbortController();
  // oxlint-disable-next-line typescript/unbound-method -- The captured native method is called with its original IDBObjectStore receiver below.
  const put = IDBObjectStore.prototype.put;
  const descriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, "put");
  IDBObjectStore.prototype.put = function (
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The native put implementation requires its mutable IDBObjectStore receiver.
    this: IDBObjectStore,
    record: StoredProfileRecord,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The native IndexedDB key contract includes mutable array keys.
    key?: IDBValidKey,
  ) {
    const request = put.call(this, record, key);
    request.addEventListener(
      "success",
      () => {
        if (mode === "signal") controller.abort();
        else request.transaction?.abort();
      },
      { once: true },
    );

    return request;
  };

  try {
    const outcome = await database
      .saveRecord(
        { schemaVersion: 1, profile: { ...DEFAULT_RIDER_PROFILE, displayName: "Uncommitted" } },
        { signal: controller.signal, current: () => !controller.signal.aborted },
      )
      .then(() => "stored")
      .catch(() => "aborted");

    return { outcome, name: await savedName() };
  } finally {
    if (descriptor !== undefined)
      Object.defineProperty(IDBObjectStore.prototype, "put", descriptor);
  }
}
