import { afterEach, expect, it } from "vitest";

import {
  VoltsDebitCommandSchema,
  VoltsDebitReceiptSchema,
  VoltsRideRangeCommandSchema,
  type ErrorCode,
  type VoltsDebitCommand,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { createTestApp, getDatabase } from "../testing/test-app.spec.js";
import { seedOwners } from "../testing/migration-harness.spec.js";
import { EconomyService } from "./economy.service.js";

const NOW_MS = Date.parse("2026-11-24T12:00:00.000Z");
const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

function debitCommand(
  idempotencyKey: string,
  refId: string,
  amountVolts: number,
): VoltsDebitCommand {
  return VoltsDebitCommandSchema.parse({ idempotencyKey, refId, amountVolts });
}

function expectApiError(action: () => void, code: ErrorCode): void {
  let thrown: unknown;

  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ApiError);
  expect(thrown).toMatchObject({ code, status: 409 });
}

function creditReward(
  economy: Readonly<Pick<EconomyService, "creditRideRange">>,
  userId: string,
): void {
  economy.creditRideRange(
    userId,
    VoltsRideRangeCommandSchema.parse({
      journalId: "70000000-0000-4000-8000-000000000001",
      startTick: 0,
      endTick: 1,
      rewardDay: "2026-11-24",
      cumulativeFacts: {
        activeDistanceM: 0,
        activeElevationGainM: 0,
        activeTimeS: 0,
        elevationGainM: 0,
        energyKj: 20,
      },
    }),
  );
}

it("debits atomically, preserves insufficient attempts and enforces debit idempotency", async () => {
  const testApp = await createTestApp({ clock: { nowMs: () => NOW_MS } });
  cleanup.add(() => testApp.app.close());
  seedOwners(getDatabase(testApp.app), [{ id: "owner" }]);
  const economy = testApp.app.get<EconomyService>(EconomyService);
  const db = getDatabase(testApp.app).$client;

  creditReward(economy, "owner");

  const command = debitCommand("purchase:item-one", "item-one", 8);
  const receipt = VoltsDebitReceiptSchema.parse(economy.debit("owner", command));
  const rows = db.prepare("SELECT * FROM volts_ledger").all();

  expect(receipt).toEqual({ entryId: receipt.entryId, refId: "item-one", amountVolts: 8 });
  expect(economy.balance("owner")).toBe(12);
  expect(db.prepare("SELECT * FROM volts_ledger WHERE reason = 'purchase'").all()).toMatchObject([
    {
      id: receipt.entryId,
      delta_volts: -8,
      idempotency_key: "purchase:item-one",
      reward_day: null,
      start_tick: null,
      end_tick: null,
      candidate_volts: null,
      cumulative_work_volts: null,
      cumulative_climb_volts: null,
      cumulative_facts_json: null,
      created_at: NOW_MS,
    },
  ]);

  expectApiError(() => {
    economy.debit("owner", debitCommand("purchase:item-two", "item-two", 13));
  }, "insufficient_volts");
  expect(economy.balance("owner")).toBe(12);
  expect(db.prepare("SELECT * FROM volts_ledger").all()).toEqual(rows);
  expect(economy.debit("owner", command)).toEqual(receipt);

  expectApiError(() => {
    economy.debit("owner", debitCommand("purchase:item-one", "item-one", 9));
  }, "ledger_conflict");
  expect(db.prepare("SELECT * FROM volts_ledger").all()).toEqual(rows);
});
