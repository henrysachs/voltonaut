import { describe, expect, it } from "vitest";

import {
  DEFAULT_RIDER_PROFILE,
  StoredProfileRecordSchema,
  type StoredProfileRecord,
} from "@voltonaut/shared";

import type { ProfileDatabase } from "./profile-store.js";
import { createProfileStore } from "./profile-store.js";

interface FakeDatabase extends ProfileDatabase {
  readonly entries: Map<string, StoredProfileRecord>;
}

function createFakeDatabase(): FakeDatabase {
  const entries = new Map<string, StoredProfileRecord>();

  return {
    entries,
    loadRecord(): Promise<StoredProfileRecord | undefined> {
      return Promise.resolve(entries.get("current"));
    },
    saveRecord(record): Promise<void> {
      entries.set("current", record);

      return Promise.resolve();
    },
  };
}

describe("profile store", () => {
  it("round-trips a profile through the database seam", async () => {
    const database = createFakeDatabase();
    const store = createProfileStore(database);

    expect(await store.load()).toBeUndefined();

    await store.save(DEFAULT_RIDER_PROFILE);
    const loaded = await store.load();

    expect(loaded).toEqual(DEFAULT_RIDER_PROFILE);
    expect(database.entries.get("current")).toEqual({
      schemaVersion: 1,
      profile: DEFAULT_RIDER_PROFILE,
    });
  });

  it("rejects an unreadable stored version at the database schema boundary", () => {
    expect(
      StoredProfileRecordSchema.safeParse({
        schemaVersion: 99,
        profile: DEFAULT_RIDER_PROFILE,
      }).success,
    ).toBe(false);
  });

  it("saves only profiles that pass the schema", async () => {
    const database = createFakeDatabase();
    const store = createProfileStore(database);

    const bogus = { ...DEFAULT_RIDER_PROFILE, massKg: 5000 };

    await expect(store.save(bogus)).rejects.toThrow("nothing was saved");
    expect(database.entries.has("current")).toBe(false);
  });
});
