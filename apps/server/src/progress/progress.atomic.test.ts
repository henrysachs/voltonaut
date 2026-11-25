import { afterEach, expect, it } from "vitest";

import {
  accept,
  batch,
  checkpoint,
  closeProgressApps,
  expectNoProgressWrites,
  fixture,
  grantConsent,
  NOW_MS,
} from "./progress.fixtures.spec.js";

afterEach(closeProgressApps);

it("rolls back ledger credit when the immutable range insert fails", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  f.db.$client.exec(`CREATE TRIGGER fail_progress_range_insert
      BEFORE INSERT ON ride_progress_ranges
      BEGIN SELECT RAISE(ABORT, 'range insert probe'); END`);

  expect(() => accept(f, f.owner, batch([checkpoint()]))).toThrow("range insert probe");
  expectNoProgressWrites(f);
});

it("rolls back the range and ledger when initial journal creation fails", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  f.db.$client.exec(`CREATE TRIGGER fail_progress_journal_insert
      BEFORE INSERT ON ride_progress_journals
      BEGIN SELECT RAISE(ABORT, 'journal insert probe'); END`);

  expect(() => accept(f, f.owner, batch([checkpoint()]))).toThrow("journal insert probe");
  expectNoProgressWrites(f);
});

it("rolls back a newer range and ledger when the journal high-water update fails", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  accept(f, f.owner, batch([checkpoint()]));
  f.db.$client.exec(`CREATE TRIGGER fail_progress_journal_update
      BEFORE UPDATE ON ride_progress_journals
      BEGIN SELECT RAISE(ABORT, 'journal update probe'); END`);

  expect(() =>
    accept(
      f,
      f.owner,
      batch([checkpoint({ sequence: 1, startTick: 1, startedAtMs: NOW_MS + 50 })]),
    ),
  ).toThrow("journal update probe");

  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
  expect(
    f.db.$client.prepare("SELECT last_end_tick, last_sequence FROM ride_progress_journals").get(),
  ).toEqual({ last_end_tick: 1, last_sequence: 0 });
});
