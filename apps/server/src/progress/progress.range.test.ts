import { afterEach, expect, it } from "vitest";

import type { ProgressCheckpointBatch } from "@voltonaut/shared";

import {
  accept,
  batch,
  checkpoint,
  closeProgressApps,
  contiguousPair,
  expectApiError,
  fact,
  fixture,
  grantConsent,
  metadata,
  NOW_MS,
  quality,
  storedRange,
  type Fixture,
} from "./progress.fixtures.spec.js";
import { validateProgressBatch } from "./progress.validation.js";

afterEach(closeProgressApps);

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Fixture is a readonly test-handle alias.
function rejectRange(f: Fixture, value: Readonly<ProgressCheckpointBatch>): void {
  expectApiError(() => accept(f, f.owner, value), 409, "ledger_conflict");
}

it("returns the original receipt for any earlier range after newer ranges commit", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  const firstBatch = batch([checkpoint()]);
  const secondBatch = batch([checkpoint({ sequence: 1, startTick: 1, startedAtMs: NOW_MS + 50 })]);

  const first = accept(f, f.owner, firstBatch);
  const second = accept(f, f.owner, secondBatch);

  expect(accept(f, f.owner, firstBatch)).toEqual(first);
  expect(accept(f, f.owner, secondBatch)).toEqual(second);
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(2);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(2);
  expect(
    f.db.$client.prepare("SELECT last_end_tick, last_sequence FROM ride_progress_journals").get(),
  ).toEqual({ last_end_tick: 2, last_sequence: 1 });
  expect(storedRange(f.db, first.journalId, 0)?.receipt_json).toContain(first.entryId);
  expect(storedRange(f.db, second.journalId, 1)?.receipt_json).toContain(second.entryId);
});

it("returns the stored receipt when a wider retry extends the exact stored checkpoint prefix", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  const firstCheckpoint = checkpoint();

  const secondCheckpoint = checkpoint({
    sequence: 1,
    startTick: 1,
    startedAtMs: firstCheckpoint.endedAtMs,
  });

  const first = accept(f, f.owner, batch([firstCheckpoint]));

  const retry = accept(f, f.owner, batch([firstCheckpoint, secondCheckpoint]));

  expect(retry).toEqual(first);
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
  expect(
    f.db.$client.prepare("SELECT last_end_tick, last_sequence FROM ride_progress_journals").get(),
  ).toEqual({ last_end_tick: 1, last_sequence: 0 });

  const second = accept(f, f.owner, batch([secondCheckpoint]));

  expect(second.startTick).toBe(1);
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(2);
});

it("returns the stored receipt when a shorter retry matches the stored checkpoint prefix", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  const [firstCheckpoint, secondCheckpoint] = contiguousPair();

  const first = accept(f, f.owner, batch([firstCheckpoint, secondCheckpoint]));

  const retry = accept(f, f.owner, batch([firstCheckpoint]));

  expect(retry).toEqual(first);
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
  expect(
    f.db.$client.prepare("SELECT last_end_tick, last_sequence FROM ride_progress_journals").get(),
  ).toEqual({ last_end_tick: 2, last_sequence: 1 });
});

it("rejects a shorter retry whose matching checkpoint prefix differs", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  const [firstCheckpoint, secondCheckpoint] = contiguousPair();

  accept(f, f.owner, batch([firstCheckpoint, secondCheckpoint]));

  const changedFirst = checkpoint({ quality: { ...quality, dataAgeS: 1 } });

  expectApiError(() => accept(f, f.owner, batch([changedFirst])), 409, "ledger_conflict");
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
});

it("rejects a wider retry whose stored checkpoint prefix differs", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  const firstCheckpoint = checkpoint();

  const secondCheckpoint = checkpoint({
    sequence: 1,
    startTick: 1,
    startedAtMs: firstCheckpoint.endedAtMs,
  });

  accept(f, f.owner, batch([firstCheckpoint]));

  const changedFirst = checkpoint({ quality: { ...quality, dataAgeS: 1 } });

  expectApiError(
    () => accept(f, f.owner, batch([changedFirst, secondCheckpoint])),
    409,
    "ledger_conflict",
  );
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
});

it("rejects a changed raw payload even when its aggregate reward facts are identical", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  const original = checkpoint();
  const changed = checkpoint({ quality: { ...quality, dataAgeS: 1 } });
  const originalBatch = batch([original]);
  const changedBatch = batch([changed]);

  expect(validateProgressBatch(originalBatch, NOW_MS).range.deltaFacts).toEqual(
    validateProgressBatch(changedBatch, NOW_MS).range.deltaFacts,
  );
  const receipt = accept(f, f.owner, originalBatch);

  expectApiError(() => accept(f, f.owner, changedBatch), 409, "ledger_conflict");
  expect(accept(f, f.owner, originalBatch)).toEqual(receipt);
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
});

it("rejects cross-range sequence gaps without advancing tick or sequence high-water", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  accept(f, f.owner, batch([checkpoint()]));

  expectApiError(
    () =>
      accept(
        f,
        f.owner,
        batch([checkpoint({ sequence: 2, startTick: 1, startedAtMs: NOW_MS + 50 })]),
      ),
    409,
    "ledger_conflict",
  );

  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
  expect(
    f.db.$client.prepare("SELECT last_end_tick, last_sequence FROM ride_progress_journals").get(),
  ).toEqual({ last_end_tick: 1, last_sequence: 0 });
});

it("rejects tick gaps, overlaps, time regressions and journal metadata changes", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  const firstBatch = batch([checkpoint()]);
  const first = accept(f, f.owner, firstBatch);

  expect(accept(f, f.owner, firstBatch)).toEqual(first);
  rejectRange(f, batch([checkpoint({ sequence: 1, startTick: 2, startedAtMs: NOW_MS + 50 })]));
  rejectRange(f, batch([checkpoint({ facts: [fact({ powerW: 300 })] })]));
  rejectRange(f, batch([checkpoint({ sequence: 1, startTick: 1, startedAtMs: NOW_MS - 1 })]));
  rejectRange(
    f,
    batch([
      checkpoint({
        sequence: 1,
        startTick: 1,
        startedAtMs: NOW_MS + 50,
        physics: { ...metadata.physics, massKg: 80 },
      }),
    ]),
  );

  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
});

it("rejects invalid retry facts before reading the immutable range receipt", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  accept(f, f.owner, batch([checkpoint()]));

  expectApiError(
    () => accept(f, f.owner, batch([checkpoint({ facts: [fact({ energyKj: 1 })] })])),
    422,
    "validation_failed",
  );
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(1);
});
