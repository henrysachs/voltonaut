import {
  StoredProfileRecordSchema,
  type RiderProfile,
  type StoredProfileRecord,
} from "@voltonaut/shared";

/**
 * Local rider profile cache, IndexedDB v1, plain Web API (ADR-005: deliberately
 * only a cache on the way to the account profile in E5; the migration hook is
 * the record's schemaVersion).
 */
export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_DATABASE_NAME = "voltonaut";
export const PROFILE_STORE_NAME = "profile";
export const PROFILE_RECORD_KEY = "current";

/**
 * Promise-based seam over the IndexedDB database. The DOM adapter (main.ts)
 * owns the raw request plumbing; everything past this boundary is parsed.
 */
export interface ProfileDatabase {
  readonly loadRecord: () => Promise<StoredProfileRecord | undefined>;
  readonly saveRecord: (record: StoredProfileRecord) => Promise<void>;
}

export interface ProfileStore {
  readonly load: () => Promise<RiderProfile | undefined>;
  readonly save: (profile: RiderProfile) => Promise<void>;
}

/**
 * Store over the parsed database seam. The adapter rejects unreadable records;
 * the record version provides E5's local-to-account migration boundary.
 */
export function createProfileStore(database: ProfileDatabase): ProfileStore {
  return {
    async load(): Promise<RiderProfile | undefined> {
      const record = await database.loadRecord();

      return record?.profile;
    },

    async save(profile: RiderProfile): Promise<void> {
      const record: StoredProfileRecord = { schemaVersion: PROFILE_SCHEMA_VERSION, profile };
      const parsed = StoredProfileRecordSchema.safeParse(record);

      if (!parsed.success) {
        throw new RangeError("profile does not pass the schema; nothing was saved");
      }

      await database.saveRecord(record);
    },
  };
}
