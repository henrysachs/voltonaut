import { expect, it } from "vitest";
import { accountDeletionIntents, deletionOwnerKey } from "./accountDeletion.js";

const A = { apiOrigin: "http://localhost:3000", userId: "00000000-0000-4000-8000-000000000001" };
const B = { apiOrigin: "http://localhost:3000", userId: "00000000-0000-4000-8000-000000000002" };

function storageFixture(denied = false) {
  const values = new Map<string, string>();

  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => {
      if (denied) throw new Error("denied");

      return values.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (denied) throw new Error("denied");
      values.set(key, value);
    },
    removeItem: (key: string) => {
      if (denied) throw new Error("denied");
      values.delete(key);
    },
  };

  const intents = accountDeletionIntents(() => storage);

  return { values, storage, intents };
}

it("remembers exact owners idempotently and isolates origins and accounts", () => {
  const f = storageFixture();
  expect(f.intents.remember(A)).toBe(true);
  expect(f.intents.remember(A)).toBe(true);
  expect(f.intents.remember({ ...A, apiOrigin: "http://localhost:4000" })).toBe(true);
  expect(f.intents.remember(B)).toBe(true);
  expect(f.intents.load()).toHaveLength(3);
  expect(f.intents.forget(A)).toBe(true);
  expect(f.intents.load().map((owner) => deletionOwnerKey(owner))).not.toContain(
    deletionOwnerKey(A),
  );
  expect(f.intents.load()).toHaveLength(2);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The test deliberately mutates the storage adapter to interleave two tab writes.
function insertConcurrentMarker(f: Readonly<ReturnType<typeof storageFixture>>): void {
  const write = f.storage.setItem;
  let insertedB = false;
  f.storage.setItem = (key, value) => {
    if (!insertedB) {
      insertedB = true;
      f.intents.remember(B);
    }

    write(key, value);
  };
}

it("does not lose one tab's marker when another tab writes during its setItem", () => {
  const f = storageFixture();
  insertConcurrentMarker(f);

  expect(f.intents.remember(A)).toBe(true);
  expect(
    f.intents
      .load()
      .map((owner) => deletionOwnerKey(owner))
      .toSorted(),
  ).toEqual([deletionOwnerKey(A), deletionOwnerKey(B)].toSorted());
});

it("fails explicitly when durable cleanup cannot be recorded and ignores corrupted markers", () => {
  expect(storageFixture(true).intents.remember(A)).toBe(false);
  const f = storageFixture();
  f.values.set(`voltonaut.account-deletion-cleanup:${deletionOwnerKey(A)}`, "not-json");
  expect(f.intents.load()).toEqual([]);
});
