import { expect, it } from "vitest";
import { seedOwners, upgradeFrom } from "../testing/migration-harness.spec.js";

/** Every column a 0014 journal row has; the upgraded row must hold the same values. */
const STORED_JOURNALS =
  "SELECT journal_id, user_id, session_hash, session_generation, consent_version, source, clock_scale, physics_revision, route_id, route_revision, physics_json, started_at_ms, last_end_tick, last_sequence, last_ended_at_ms, last_reward_day, cumulative_facts_json, created_at FROM ride_progress_journals ORDER BY journal_id";

const SNAPSHOT = [
  "SELECT * FROM users ORDER BY id",
  STORED_JOURNALS,
  "SELECT * FROM ride_progress_ranges ORDER BY id",
  "SELECT * FROM progress_consents ORDER BY user_id",
] as const;

const JOURNAL_COLUMNS =
  "journal_id,user_id,session_hash,session_generation,consent_version,source,clock_scale,physics_revision,physics_json,started_at_ms,last_end_tick,last_sequence,last_ended_at_ms,last_reward_day,cumulative_facts_json,created_at";

const JOURNAL_VALUES = "'session',1,1,'ble',1.0,'engine-v1','{}',0,1,0,50,'1970-01-01','{}',7";

const SEED = `
  INSERT INTO progress_consents (user_id,version,enabled,session_hash,session_generation,updated_at)
    VALUES ('owner',1,1,'session',1,3);
  INSERT INTO ride_progress_journals (${JOURNAL_COLUMNS},route_id,route_revision)
    VALUES ('a-journal','owner',${JOURNAL_VALUES},'test-loop','1');
  INSERT INTO ride_progress_journals (${JOURNAL_COLUMNS},route_id,route_revision)
    VALUES ('b-journal','owner',${JOURNAL_VALUES},'flat-loop','1');
  INSERT INTO ride_progress_ranges (id,journal_id,user_id,start_tick,end_tick,payload_hash,payload_json,cumulative_facts_json,receipt_json,created_at)
    VALUES ('r-1','a-journal','owner',0,1,'${"a".repeat(64)}','{"routeId":"test-loop"}','{}','{}',8);
`;

function insertJournal(id: string, user: string, reference: string): string {
  return `INSERT INTO ride_progress_journals (${JOURNAL_COLUMNS},route_id,route_revision,world_id,world_revision,path_id) VALUES ('${id}','${user}',${JOURNAL_VALUES},${reference})`;
}

function upgraded() {
  const upgrade = upgradeFrom("0014_avatar_loadouts", (old) => {
    seedOwners(old, [
      { id: "owner", email: "owner@example.com", createdAt: 1 },
      { id: "gone", email: "gone@example.com", createdAt: 1, deletedAt: 5 },
    ]);
    old.$client.exec(SEED);

    return SNAPSHOT.map((query) => old.$client.prepare(query).all());
  });

  return { before: upgrade.seeded, next: upgrade.open() };
}

it("keeps every stored progress row and adds no world fields to single-route journals", () => {
  const { before, next } = upgraded();

  expect(before[1]).toHaveLength(2);
  expect(SNAPSHOT.map((query) => next.$client.prepare(query).all())).toEqual(before);
  expect(
    next.$client
      .prepare(
        "SELECT journal_id, world_id, world_revision, path_id FROM ride_progress_journals ORDER BY journal_id",
      )
      .all(),
  ).toEqual([
    { journal_id: "a-journal", world_id: null, world_revision: null, path_id: null },
    { journal_id: "b-journal", world_id: null, world_revision: null, path_id: null },
  ]);
  expect(next.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("restores the journal indexes and account-deletion guards after the rebuild", () => {
  const { next } = upgraded();

  expect(
    next.$client
      .prepare(
        "SELECT type, name FROM sqlite_master WHERE tbl_name = 'ride_progress_journals' AND type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
      )
      .all(),
  ).toEqual([
    { type: "index", name: "ride_progress_journals_owner_created_id_idx" },
    { type: "index", name: "ride_progress_journals_owner_session_idx" },
    { type: "trigger", name: "ride_progress_journals_reject_deleted_owner_insert" },
    { type: "trigger", name: "ride_progress_journals_reject_deleted_owner_update" },
  ]);
  expect(() =>
    next.$client
      .prepare(insertJournal("c-journal", "gone", "NULL,NULL,'test-loop','1','test-loop'"))
      .run(),
  ).toThrow("account is deleted");
});

it("stores a world path journal and refuses anything but exactly one complete reference", () => {
  const { next } = upgraded();

  next.$client
    .prepare(insertJournal("w-journal", "owner", "NULL,NULL,'test-loop','1','test-loop'"))
    .run();

  for (const reference of [
    "'test-loop','1','test-loop','1','test-loop'",
    "NULL,NULL,NULL,NULL,NULL",
    "'test-loop',NULL,NULL,NULL,NULL",
    "NULL,NULL,'test-loop','1',NULL",
    "NULL,NULL,'test-loop',NULL,'test-loop'",
    "NULL,NULL,'','1','test-loop'",
    "NULL,'1',NULL,NULL,NULL",
  ]) {
    expect(() =>
      next.$client.prepare(insertJournal(`x-${reference.length}`, "owner", reference)).run(),
    ).toThrow("CHECK constraint failed");
  }

  expect(
    next.$client.prepare("SELECT COUNT(*) AS journals FROM ride_progress_journals").get(),
  ).toEqual({ journals: 3 });
});
