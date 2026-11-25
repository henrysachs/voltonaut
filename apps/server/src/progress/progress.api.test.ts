import request from "supertest";
import { afterEach, expect, it } from "vitest";

import {
  ProgressCheckpointBatchSchema,
  ProgressRangeResponseSchema,
  VoltsRideRangeReceiptSchema,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";

import {
  CONSENT_VERSION,
  JOURNAL_ID,
  NOW_MS,
  OTHER_JOURNAL_ID,
  SESSION_GENERATION,
  batch,
  checkpoint,
  closeProgressApps,
  fixture,
  grantConsent,
  postCheckpoints,
  storedRange,
  type Fixture,
  type StoredProgressRange,
} from "./progress.fixtures.spec.js";
import { bearer, bodyOf } from "../testing/test-app.spec.js";
import { hashToken } from "../auth/tokens.js";

afterEach(closeProgressApps);

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Fixture and Volts receipts are readonly aliases that the rule cannot resolve. */
function requireRange(f: Fixture, journalId: string, startTick: number): StoredProgressRange {
  const range = storedRange(f.db, journalId, startTick);

  if (range === undefined) throw new Error("Expected a stored progress range");

  return range;
}

function expectStoredProgress(f: Fixture, receipt: VoltsRideRangeReceipt): void {
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_journals").all()).toHaveLength(1);
  expect(f.db.$client.prepare("SELECT * FROM rides").all()).toEqual([]);
  expect(
    f.db.$client
      .prepare("SELECT idempotency_key, reward_day, start_tick, end_tick FROM volts_ledger")
      .get(),
  ).toMatchObject({
    idempotency_key: `ride:${JOURNAL_ID}:0`,
    reward_day: "2026-11-25",
    start_tick: 0,
    end_tick: 2,
  });
  expect(
    f.db.$client
      .prepare(
        "SELECT user_id, session_hash, session_generation, consent_version, last_end_tick, last_sequence, last_reward_day FROM ride_progress_journals",
      )
      .get(),
  ).toMatchObject({
    user_id: f.owner.user.id,
    session_hash: hashToken(f.owner.sessionToken),
    session_generation: SESSION_GENERATION,
    consent_version: CONSENT_VERSION,
    last_end_tick: 2,
    last_sequence: 0,
    last_reward_day: "2026-11-25",
  });

  const range = requireRange(f, JOURNAL_ID, 0);

  expect(range).toMatchObject({
    journal_id: JOURNAL_ID,
    user_id: f.owner.user.id,
    start_tick: 0,
    end_tick: 2,
    created_at: NOW_MS,
  });
  expect(range.payload_hash).toMatch(/^[0-9a-f]{64}$/u);
  expect(VoltsRideRangeReceiptSchema.parse(JSON.parse(range.receipt_json))).toEqual(receipt);
}

it("requires auth, rejects strict-body extras and returns an uncached idempotent receipt", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);

  await request(f.server)
    .post("/v1/progress/checkpoints")
    .send(batch([checkpoint()]))
    .expect(401);

  const extra = await request(f.server)
    .post("/v1/progress/checkpoints")
    .set(bearer(f.owner.sessionToken))
    .send({ ...batch([checkpoint()]), rewardFacts: { energyKj: 999 } })
    .expect(422);

  expect(bodyOf(extra)).toMatchObject({ error: { code: "validation_failed" } });
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toEqual([]);

  const normalized = checkpoint({ factCount: 2, startedAtMs: NOW_MS });
  const value = batch([{ ...normalized, journalId: JOURNAL_ID.toUpperCase() }]);
  const response = await postCheckpoints(f.server, f.owner.sessionToken, value).expect(200);
  const receipt = ProgressRangeResponseSchema.parse(bodyOf(response)).range;

  expect(response.headers["cache-control"]).toBe("no-store");
  expect(receipt).toMatchObject({
    journalId: JOURNAL_ID,
    startTick: 0,
    endTick: 2,
    rewardDay: "2026-11-25",
  });

  const retry = await postCheckpoints(f.server, f.owner.sessionToken, batch([normalized])).expect(
    200,
  );

  expect(ProgressRangeResponseSchema.parse(bodyOf(retry))).toEqual({ range: receipt });
  expectStoredProgress(f, receipt);

  const range = requireRange(f, JOURNAL_ID, 0);

  expect(range.payload_json).toBe(JSON.stringify(ProgressCheckpointBatchSchema.parse(value)));
});

it("limits each account to thirty checkpoint requests per minute, including duplicates", async () => {
  const f = await fixture();
  grantConsent(f.db, f.owner);
  grantConsent(f.db, f.other);
  const value = batch([checkpoint()]);

  await Promise.all(
    Array.from({ length: 30 }, () =>
      postCheckpoints(f.server, f.owner.sessionToken, value).expect(200),
    ),
  );

  const limited = await postCheckpoints(f.server, f.owner.sessionToken, value).expect(429);
  expect(bodyOf(limited)).toMatchObject({ error: { code: "rate_limited" } });
  expect(limited.headers["retry-after"]).toBeDefined();

  await postCheckpoints(
    f.server,
    f.other.sessionToken,
    batch([checkpoint({ journalId: OTHER_JOURNAL_ID })]),
  ).expect(200);

  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(2);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toHaveLength(2);
});
