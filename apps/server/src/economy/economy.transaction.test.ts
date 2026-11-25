import { afterEach, expect, it } from "vitest";

import {
  VoltsDebitCommandSchema,
  VoltsRideRangeCommandSchema,
  type VoltsDebitReceipt,
} from "@voltonaut/shared";
import { createTestApp, getDatabase, loginTestUser } from "../testing/test-app.spec.js";
import type { VoltsLedgerTransaction } from "./economy.codec.js";
import { EconomyService } from "./economy.service.js";

const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

it("rolls back a debit when the transaction callback throws", async () => {
  const testApp = await createTestApp({ clock: { nowMs: () => 0 } });
  cleanup.add(() => testApp.app.close());
  const owner = await loginTestUser(testApp.app, testApp.mail, "owner@example.com");
  const economy = testApp.app.get<EconomyService>(EconomyService);

  const reward = VoltsRideRangeCommandSchema.parse({
    journalId: "30000000-0000-4000-8000-000000000001",
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
  });

  const debit = VoltsDebitCommandSchema.parse({
    idempotencyKey: "purchase:item-one",
    refId: "item-one",
    amountVolts: 5,
  });

  economy.creditRideRange(owner.user.id, reward);
  const rows = getDatabase(testApp.app).$client.prepare("SELECT * FROM volts_ledger").all();
  let receiptInside: VoltsDebitReceipt | undefined;
  let balanceInside: number | undefined;

  expect(() =>
    economy.transaction((tx: Readonly<VoltsLedgerTransaction>) => {
      receiptInside = tx.debit(owner.user.id, debit);
      balanceInside = tx.balance(owner.user.id);
      throw new Error("rollback probe");
    }),
  ).toThrow("rollback probe");

  expect(receiptInside).toMatchObject({ refId: "item-one", amountVolts: 5 });
  expect(balanceInside).toBe(15);
  expect(economy.balance(owner.user.id)).toBe(20);
  expect(getDatabase(testApp.app).$client.prepare("SELECT * FROM volts_ledger").all()).toEqual(
    rows,
  );
});
