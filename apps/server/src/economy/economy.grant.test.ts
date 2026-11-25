import { afterEach, expect, it } from "vitest";

import {
  VoltsDebitCommandSchema,
  VoltsGrantCommandSchema,
  type ErrorCode,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { createTestApp, getDatabase, loginTestUser } from "../testing/test-app.spec.js";
import { economyTables } from "../schema.js";
import { OperatorGrants } from "./economy.grant.js";
import { EconomyService } from "./economy.service.js";

const NOW_MS = Date.parse("2026-11-25T12:00:00.000Z");
const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

function grant(reference: string, amountVolts: number) {
  return VoltsGrantCommandSchema.parse({
    idempotencyKey: `operator:${reference}`,
    refId: reference,
    amountVolts,
  });
}

function apiErrorCode(action: () => void): ErrorCode | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof ApiError ? error.code : undefined;
  }

  return undefined;
}

async function grantApp() {
  const testApp = await createTestApp({ clock: { nowMs: () => NOW_MS } });
  cleanup.add(() => testApp.app.close());
  const owner = await loginTestUser(testApp.app, testApp.mail, "owner@example.com");

  const db = getDatabase(testApp.app);

  return {
    userId: owner.user.id,
    economy: testApp.app.get<EconomyService>(EconomyService),
    grants: new OperatorGrants(db, economyTables, { nowMs: () => NOW_MS }),
    db: db.$client,
  };
}

it("credits an operator grant once and replays it without a second booking", async () => {
  const { userId, economy, grants, db } = await grantApp();

  const receipt = grants.grant(userId, grant("acceptance-2026-11-25", 7000));

  expect(receipt).toEqual({
    entryId: receipt.entryId,
    refId: "acceptance-2026-11-25",
    amountVolts: 7000,
  });
  expect(grants.grant(userId, grant("acceptance-2026-11-25", 7000))).toEqual(receipt);
  expect(economy.balance(userId)).toBe(7000);
  expect(
    db.prepare("SELECT reason, delta_volts, idempotency_key, reward_day FROM volts_ledger").all(),
  ).toEqual([
    {
      reason: "operator_grant",
      delta_volts: 7000,
      idempotency_key: "operator:acceptance-2026-11-25",
      reward_day: null,
    },
  ]);
});

it("rejects a different amount under the same reference without booking", async () => {
  const { userId, economy, grants } = await grantApp();

  grants.grant(userId, grant("acceptance", 7000));

  expect(
    apiErrorCode(() => {
      grants.grant(userId, grant("acceptance", 9000));
    }),
  ).toBe("ledger_conflict");
  expect(economy.balance(userId)).toBe(7000);
});

it("lets granted Volts pay for a purchase", async () => {
  const { userId, economy, grants } = await grantApp();

  grants.grant(userId, grant("acceptance", 2000));
  economy.debit(
    userId,
    VoltsDebitCommandSchema.parse({
      idempotencyKey: "purchase:a",
      refId: "helmet.aero",
      amountVolts: 1500,
    }),
  );

  expect(economy.balance(userId)).toBe(500);
});

it("keeps operator grants positive and free of ride fields in SQLite itself", async () => {
  const { userId, db } = await grantApp();

  const insert = (delta: number, rewardDay: string | null) => () =>
    db
      .prepare(
        "INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,reward_day,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        `id-${delta}-${rewardDay}`,
        userId,
        delta,
        "operator_grant",
        "ref",
        `operator:${delta}-${rewardDay}`,
        "hash",
        rewardDay,
        NOW_MS,
      );

  expect(insert(0, null)).toThrow("CHECK constraint failed");
  expect(insert(-5, null)).toThrow("CHECK constraint failed");
  expect(insert(5, "2026-11-25")).toThrow("CHECK constraint failed");
  expect(insert(5, null)).not.toThrow();
});

it("requires the operator: key prefix", () => {
  expect(
    VoltsGrantCommandSchema.safeParse({ idempotencyKey: "purchase:x", refId: "x", amountVolts: 1 })
      .success,
  ).toBe(false);
});
