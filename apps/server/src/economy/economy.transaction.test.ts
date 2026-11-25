import { afterEach, expect, it } from "vitest";

import {
  VoltsDebitCommandSchema,
  VoltsRideRangeCommandSchema,
  type VoltsDebitReceipt,
} from "@voltonaut/shared";
import { createTestApp, getDatabase } from "../testing/test-app.spec.js";
import { seedOwners } from "../testing/migration-harness.spec.js";
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
  seedOwners(getDatabase(testApp.app), [{ id: "owner" }]);
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

  economy.creditRideRange("owner", reward);
  const rows = getDatabase(testApp.app).$client.prepare("SELECT * FROM volts_ledger").all();
  let receiptInside: VoltsDebitReceipt | undefined;
  let balanceInside: number | undefined;

  expect(() =>
    economy.transaction((tx: Readonly<VoltsLedgerTransaction>) => {
      receiptInside = tx.debit("owner", debit);
      balanceInside = tx.balance("owner");
      throw new Error("rollback probe");
    }),
  ).toThrow("rollback probe");

  expect(receiptInside).toMatchObject({ refId: "item-one", amountVolts: 5 });
  expect(balanceInside).toBe(15);
  expect(economy.balance("owner")).toBe(20);
  expect(getDatabase(testApp.app).$client.prepare("SELECT * FROM volts_ledger").all()).toEqual(
    rows,
  );
});
