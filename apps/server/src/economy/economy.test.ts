import request from "supertest";
import { afterEach, expect, it } from "vitest";

import {
  VoltsBalanceResponseSchema,
  VoltsRideRangeCommandSchema,
  VoltsRideRangeReceiptSchema,
  type ErrorCode,
  type VoltsRideRangeCommand,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import type { DatabaseReader } from "../testing/test-app.spec.js";
import { EconomyService } from "./economy.service.js";

const NOW_MS = Date.parse("2026-11-24T12:00:00.000Z");
const REWARD_DAY = "2026-11-24";
const NEXT_REWARD_DAY = "2026-11-25";
const JOURNAL_ONE = "10000000-0000-4000-8000-000000000001";
const JOURNAL_TWO = "10000000-0000-4000-8000-000000000002";
const JOURNAL_THREE = "10000000-0000-4000-8000-000000000003";
const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

async function fixture() {
  const testApp = await createTestApp({ clock: { nowMs: () => NOW_MS } });
  cleanup.add(() => testApp.app.close());
  const owner = await loginTestUser(testApp.app, testApp.mail, "owner@example.com");

  return {
    server: httpServerOf(testApp.app),
    owner,
    economy: testApp.app.get<EconomyService>(EconomyService),
    db: getDatabase(testApp.app),
  };
}

function rangeCommand(
  journalId: string,
  startTick: number,
  endTick: number,
  energyKj: number,
  elevationGainM = 0,
  rewardDay = REWARD_DAY,
): VoltsRideRangeCommand {
  return VoltsRideRangeCommandSchema.parse({
    journalId,
    startTick,
    endTick,
    rewardDay,
    cumulativeFacts: {
      activeDistanceM: 0,
      activeElevationGainM: 0,
      activeTimeS: 0,
      elevationGainM,
      energyKj,
    },
  });
}

async function readBalance(
  server: Readonly<ReturnType<typeof httpServerOf>>,
  sessionToken: string,
): Promise<number> {
  const response = await request(server).get("/v1/me/volts").set(bearer(sessionToken)).expect(200);

  return VoltsBalanceResponseSchema.parse(bodyOf(response)).voltsBalance;
}

const DAILY_SUM_SQL =
  "SELECT SUM(delta_volts) AS total FROM volts_ledger WHERE user_id = ? AND reward_day = ? AND reason = 'ride_reward'";

function expectDailyTotal(
  db: DatabaseReader,
  userId: string,
  rewardDay: string,
  total: number,
): void {
  expect(db.$client.prepare(DAILY_SUM_SQL).get(userId, rewardDay)).toEqual({ total });
}

function expectApiError(
  action: () => VoltsRideRangeReceipt,
  status: number,
  code: ErrorCode,
): void {
  let thrown: unknown;

  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ApiError);
  expect(thrown).toMatchObject({ code, status });
}

it("requires bearer auth and returns a strict uncached zero balance", async () => {
  const f = await fixture();

  await request(f.server).get("/v1/me/volts").expect(401);

  const response = await request(f.server)
    .get("/v1/me/volts")
    .set(bearer(f.owner.sessionToken))
    .expect(200);

  expect(bodyOf(response)).toEqual({ voltsBalance: 0 });
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toEqual([]);
});

it("telescopes contiguous cumulative components and retries the immutable first receipt", async () => {
  const f = await fixture();
  const firstInput = rangeCommand(JOURNAL_ONE, 0, 1, 2.9, 3);
  const secondInput = rangeCommand(JOURNAL_ONE, 1, 2, 5.9, 6);

  const first = VoltsRideRangeReceiptSchema.parse(
    f.economy.creditRideRange(f.owner.user.id, firstInput),
  );

  const second = f.economy.creditRideRange(f.owner.user.id, secondInput);
  const retry = f.economy.creditRideRange(f.owner.user.id, firstInput);

  expect(first).toMatchObject({
    journalId: JOURNAL_ONE,
    startTick: 0,
    endTick: 1,
    rewardDay: REWARD_DAY,
    cumulativeWorkVolts: 2,
    cumulativeClimbVolts: 4,
    candidateVolts: 6,
    awardedVolts: 6,
    withheldVolts: 0,
  });
  expect(second).toMatchObject({
    startTick: 1,
    endTick: 2,
    cumulativeWorkVolts: 5,
    cumulativeClimbVolts: 9,
    candidateVolts: 8,
    awardedVolts: 8,
    withheldVolts: 0,
  });
  expect(second.cumulativeWorkVolts - first.cumulativeWorkVolts).toBe(3);
  expect(second.cumulativeClimbVolts - first.cumulativeClimbVolts).toBe(5);
  expect(first.candidateVolts + second.candidateVolts).toBe(14);
  expect(retry).toEqual(first);
  expect(await readBalance(f.server, f.owner.sessionToken)).toBe(14);
  expect(
    f.db.$client
      .prepare("SELECT id, idempotency_key, delta_volts FROM volts_ledger ORDER BY start_tick")
      .all(),
  ).toEqual([
    { id: first.entryId, idempotency_key: `ride:${JOURNAL_ONE}:0`, delta_volts: 6 },
    { id: second.entryId, idempotency_key: `ride:${JOURNAL_ONE}:1`, delta_volts: 8 },
  ]);
});

it("rejects gaps, overlaps, cumulative regressions and reward-day regressions without rows", async () => {
  const f = await fixture();
  f.economy.creditRideRange(f.owner.user.id, rangeCommand(JOURNAL_ONE, 0, 10, 2.9, 3));
  const rows = f.db.$client.prepare("SELECT * FROM volts_ledger").all();

  expectApiError(
    () => f.economy.creditRideRange(f.owner.user.id, rangeCommand(JOURNAL_ONE, 11, 12, 5.9, 6)),
    409,
    "ledger_conflict",
  );
  expectApiError(
    () => f.economy.creditRideRange(f.owner.user.id, rangeCommand(JOURNAL_ONE, 5, 15, 5.9, 6)),
    409,
    "ledger_conflict",
  );
  expectApiError(
    () => f.economy.creditRideRange(f.owner.user.id, rangeCommand(JOURNAL_ONE, 10, 20, 2, 2)),
    409,
    "ledger_conflict",
  );
  expectApiError(
    () =>
      f.economy.creditRideRange(
        f.owner.user.id,
        rangeCommand(JOURNAL_ONE, 10, 20, 5.9, 6, "2026-11-23"),
      ),
    409,
    "ledger_conflict",
  );
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toEqual(rows);
});

it("shares the daily cap across ranges and journals, advances zero awards and resets next day", async () => {
  const f = await fixture();

  const first = f.economy.creditRideRange(f.owner.user.id, rangeCommand(JOURNAL_ONE, 0, 1, 2000));
  const second = f.economy.creditRideRange(f.owner.user.id, rangeCommand(JOURNAL_ONE, 1, 2, 3500));
  const zero = f.economy.creditRideRange(f.owner.user.id, rangeCommand(JOURNAL_ONE, 2, 3, 3501));

  const advanced = f.economy.creditRideRange(
    f.owner.user.id,
    rangeCommand(JOURNAL_ONE, 3, 4, 3502),
  );

  const otherJournal = f.economy.creditRideRange(
    f.owner.user.id,
    rangeCommand(JOURNAL_TWO, 0, 1, 500),
  );

  const nextDay = f.economy.creditRideRange(
    f.owner.user.id,
    rangeCommand(JOURNAL_THREE, 0, 1, 500, 0, NEXT_REWARD_DAY),
  );

  expect(first.awardedVolts).toBe(2000);
  expect(second).toMatchObject({ candidateVolts: 1500, awardedVolts: 1000, withheldVolts: 500 });
  expect(zero).toMatchObject({ candidateVolts: 1, awardedVolts: 0, withheldVolts: 1 });
  expect(f.economy.creditRideRange(f.owner.user.id, rangeCommand(JOURNAL_ONE, 2, 3, 3501))).toEqual(
    zero,
  );
  expect(advanced).toMatchObject({ startTick: 3, endTick: 4, candidateVolts: 1, awardedVolts: 0 });
  expect(otherJournal).toMatchObject({ candidateVolts: 500, awardedVolts: 0, withheldVolts: 500 });
  expect(nextDay).toMatchObject({
    rewardDay: NEXT_REWARD_DAY,
    candidateVolts: 500,
    awardedVolts: 500,
    withheldVolts: 0,
  });
  expectDailyTotal(f.db, f.owner.user.id, REWARD_DAY, 3000);
  expectDailyTotal(f.db, f.owner.user.id, NEXT_REWARD_DAY, 500);
  expect(await readBalance(f.server, f.owner.sessionToken)).toBe(3500);
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toHaveLength(6);
});
