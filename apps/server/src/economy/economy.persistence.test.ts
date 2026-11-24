import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, expect, it } from "vitest";

import {
  VoltsBalanceResponseSchema,
  VoltsDebitCommandSchema,
  VoltsRideRangeCommandSchema,
  type ErrorCode,
  type VoltsDebitCommand,
  type VoltsRideRangeCommand,
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
const JOURNAL_ID = "20000000-0000-4000-8000-000000000001";
const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

async function fixture() {
  const testApp = await createTestApp({ clock: { nowMs: () => NOW_MS } });
  cleanup.add(() => testApp.app.close());

  const owner = await loginTestUser(testApp.app, testApp.mail, "owner@example.com");
  const other = await loginTestUser(testApp.app, testApp.mail, "other@example.com");

  return {
    server: httpServerOf(testApp.app),
    owner,
    other,
    economy: testApp.app.get<EconomyService>(EconomyService),
    db: getDatabase(testApp.app),
  };
}

function rangeCommand(
  journalId = JOURNAL_ID,
  startTick = 0,
  endTick = 1,
  energyKj = 2.9,
  elevationGainM = 3,
): VoltsRideRangeCommand {
  return VoltsRideRangeCommandSchema.parse({
    journalId,
    startTick,
    endTick,
    rewardDay: REWARD_DAY,
    cumulativeFacts: {
      activeDistanceM: 0,
      activeElevationGainM: 0,
      activeTimeS: 0,
      elevationGainM,
      energyKj,
    },
  });
}

function debitCommand(amountVolts = 4): VoltsDebitCommand {
  return VoltsDebitCommandSchema.parse({
    idempotencyKey: "purchase:persisted-item",
    refId: "persisted-item",
    amountVolts,
  });
}

async function readBalance(
  server: Readonly<ReturnType<typeof httpServerOf>>,
  sessionToken: string,
): Promise<number> {
  const response = await request(server).get("/v1/me/volts").set(bearer(sessionToken)).expect(200);

  return VoltsBalanceResponseSchema.parse(bodyOf(response)).voltsBalance;
}

function expectApiError(action: () => void, status: number, code: ErrorCode): void {
  let thrown: unknown;

  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ApiError);
  expect(thrown).toMatchObject({ code, status });
}

function expectRejectedUpdates(
  db: DatabaseReader,
  statements: readonly string[],
  entryId: string,
  reason: string,
): void {
  for (const statement of statements) {
    expect(() => db.$client.prepare(statement).run(entryId)).toThrow(reason);
  }
}

function expectLedgerConstraints(db: DatabaseReader, rewardId: string, debitId: string): void {
  expect(db.$client.prepare("PRAGMA foreign_key_list(volts_ledger)").all()).toMatchObject([
    { table: "users", from: "user_id", to: "id" },
  ]);
  expect(() =>
    db.$client
      .prepare("UPDATE volts_ledger SET user_id = ? WHERE id = ?")
      .run("missing-owner", rewardId),
  ).toThrow("FOREIGN KEY");
  expect(() =>
    db.$client.prepare("UPDATE volts_ledger SET reason = ? WHERE id = ?").run("bonus", rewardId),
  ).toThrow("CHECK");

  expectRejectedUpdates(
    db,
    [
      "UPDATE volts_ledger SET reward_day = NULL WHERE id = ?",
      "UPDATE volts_ledger SET end_tick = start_tick WHERE id = ?",
      "UPDATE volts_ledger SET cumulative_work_volts = NULL WHERE id = ?",
      "UPDATE volts_ledger SET cumulative_facts_json = NULL WHERE id = ?",
      "UPDATE volts_ledger SET delta_volts = -1 WHERE id = ?",
    ],
    rewardId,
    "CHECK",
  );
  expectRejectedUpdates(
    db,
    [
      `UPDATE volts_ledger SET reward_day = '${REWARD_DAY}' WHERE id = ?`,
      "UPDATE volts_ledger SET cumulative_work_volts = 0 WHERE id = ?",
      "UPDATE volts_ledger SET cumulative_facts_json = '{}' WHERE id = ?",
      "UPDATE volts_ledger SET delta_volts = 0 WHERE id = ?",
    ],
    debitId,
    "CHECK",
  );
  expect(() =>
    db.$client
      .prepare(
        "UPDATE volts_ledger SET idempotency_key = (SELECT idempotency_key FROM volts_ledger WHERE id = ?) WHERE id = ?",
      )
      .run(rewardId, debitId),
  ).toThrow("UNIQUE");
}

async function writeBeforeRestart(path: string) {
  const first = await createTestApp({
    config: { database: { path, migrationsDir: "drizzle" } },
    clock: { nowMs: () => NOW_MS },
  });

  try {
    const session = await loginTestUser(first.app, first.mail, "durable@example.com");
    const economy = first.app.get<EconomyService>(EconomyService);
    const firstInput = rangeCommand();
    const secondInput = rangeCommand(JOURNAL_ID, 1, 2, 5.9, 6);
    const debitInput = debitCommand();

    const firstReceipt = economy.creditRideRange(session.user.id, firstInput);
    const secondReceipt = economy.creditRideRange(session.user.id, secondInput);
    const debit = economy.debit(session.user.id, debitInput);

    const rows = getDatabase(first.app)
      .$client.prepare("SELECT * FROM volts_ledger ORDER BY rowid")
      .all();

    const balance = await readBalance(httpServerOf(first.app), session.sessionToken);

    return {
      session,
      firstInput,
      secondInput,
      debitInput,
      firstReceipt,
      secondReceipt,
      debit,
      rows,
      balance,
    };
  } finally {
    await first.app.close();
  }
}

it("preserves range receipts, balance and entries and their idempotency after SQLite reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-economy-"));
  const path = join(directory, "economy.db");

  try {
    const saved = await writeBeforeRestart(path);

    const second = await createTestApp({
      config: { database: { path, migrationsDir: "drizzle" } },
      clock: { nowMs: () => NOW_MS },
    });

    try {
      const economy = second.app.get<EconomyService>(EconomyService);
      const db = getDatabase(second.app);
      const firstRetry = economy.creditRideRange(saved.session.user.id, saved.firstInput);
      const secondRetry = economy.creditRideRange(saved.session.user.id, saved.secondInput);
      const debitRetry = economy.debit(saved.session.user.id, saved.debitInput);

      expect(await readBalance(httpServerOf(second.app), saved.session.sessionToken)).toBe(
        saved.balance,
      );
      expect(firstRetry).toEqual(saved.firstReceipt);
      expect(secondRetry).toEqual(saved.secondReceipt);
      expect(debitRetry).toEqual(saved.debit);
      expect(db.$client.prepare("SELECT * FROM volts_ledger ORDER BY rowid").all()).toEqual(
        saved.rows,
      );
    } finally {
      await second.app.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("enforces ledger foreign keys, range metadata checks and owner/key uniqueness", async () => {
  const f = await fixture();
  const reward = f.economy.creditRideRange(f.owner.user.id, rangeCommand());
  const debit = f.economy.debit(f.owner.user.id, debitCommand());
  const before = f.db.$client.prepare("SELECT * FROM volts_ledger ORDER BY rowid").all();

  expectLedgerConstraints(f.db, reward.entryId, debit.entryId);
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger ORDER BY rowid").all()).toEqual(before);
});

it("hides a journal owned by another account without creating a range row", async () => {
  const f = await fixture();
  const owned = f.economy.creditRideRange(f.owner.user.id, rangeCommand());

  expectApiError(
    () => {
      f.economy.creditRideRange(f.other.user.id, rangeCommand(JOURNAL_ID, 1, 2, 5.9, 6));
    },
    404,
    "not_found",
  );
  expect(f.economy.balance(f.other.user.id)).toBe(0);
  expect(f.economy.balance(f.owner.user.id)).toBe(owned.awardedVolts);
  expect(f.db.$client.prepare("SELECT COUNT(*) AS total FROM volts_ledger").get()).toEqual({
    total: 1,
  });
});
