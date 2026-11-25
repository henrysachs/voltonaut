import { afterEach, expect, it } from "vitest";

import {
  VoltsDebitCommandSchema,
  VoltsGrantCommandSchema,
  type ErrorCode,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { createTestApp, getDatabase } from "../testing/test-app.spec.js";
import { seedOwners } from "../testing/migration-harness.spec.js";
import { economyTables } from "../schema.js";
import { OperatorGrants } from "./economy.grant.js";
import { EconomyService } from "./economy.service.js";

const NOW_MS = Date.parse("2026-11-25T12:00:00.000Z");
const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

function grant(reference: string, amountVolts: number, operatorUserId: string) {
  return VoltsGrantCommandSchema.parse({
    idempotencyKey: `operator:${reference}`,
    refId: reference,
    amountVolts,
    operatorUserId,
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
  seedOwners(getDatabase(testApp.app), [{ id: "owner" }, { id: "operator" }]);

  const db = getDatabase(testApp.app);

  return {
    userId: "owner",
    operatorId: "operator",
    economy: testApp.app.get<EconomyService>(EconomyService),
    grants: new OperatorGrants(db, economyTables, { nowMs: () => NOW_MS }),
    db: db.$client,
  };
}

it("credits an operator grant once and replays it without a second booking", async () => {
  const { userId, economy, grants, db, operatorId } = await grantApp();

  const receipt = grants.grant(userId, grant("acceptance-2026-11-25", 7000, operatorId));

  expect(receipt).toEqual({
    entryId: receipt.entryId,
    refId: "acceptance-2026-11-25",
    amountVolts: 7000,
    operator: { kind: "recorded", userId: operatorId },
  });
  expect(grants.grant(userId, grant("acceptance-2026-11-25", 7000, operatorId))).toEqual(receipt);
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
  const { userId, economy, grants, operatorId } = await grantApp();

  grants.grant(userId, grant("acceptance", 7000, operatorId));

  expect(
    apiErrorCode(() => {
      grants.grant(userId, grant("acceptance", 9000, operatorId));
    }),
  ).toBe("ledger_conflict");
  expect(economy.balance(userId)).toBe(7000);
});

it("lets granted Volts pay for a purchase", async () => {
  const { userId, economy, grants, operatorId } = await grantApp();

  grants.grant(userId, grant("acceptance", 2000, operatorId));
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
    VoltsGrantCommandSchema.safeParse({
      idempotencyKey: "purchase:x",
      refId: "x",
      amountVolts: 1,
      operatorUserId: "admin",
    }).success,
  ).toBe(false);
});

it("rejects a credit that would push the balance past the safe integer range", async () => {
  const { userId, economy, grants, operatorId } = await grantApp();
  const nearMax = Number.MAX_SAFE_INTEGER - 10;

  grants.grant(userId, grant("edge", nearMax, operatorId));

  expect(() => grants.grant(userId, grant("overflow", 11, operatorId))).toThrow(
    "safe integer range",
  );
  expect(economy.balance(userId)).toBe(nearMax);
});

it("records the operator and rejects a replay by another operator", async () => {
  const { userId, grants, db, operatorId } = await grantApp();

  const receipt = grants.grant(userId, grant("audited", 500, operatorId));

  expect(
    db.prepare("SELECT entry_id, operator_user_id, provenance FROM volts_grant_operators").all(),
  ).toEqual([{ entry_id: receipt.entryId, operator_user_id: operatorId, provenance: "recorded" }]);
  expect(
    apiErrorCode(() => {
      grants.grant(userId, grant("audited", 500, userId));
    }),
  ).toBe("ledger_conflict");
});

it("keeps the operator audit immutable and consistent in SQLite itself", async () => {
  const { userId, grants, db, operatorId } = await grantApp();
  const receipt = grants.grant(userId, grant("immutable", 500, operatorId));

  expect(() =>
    db.prepare("UPDATE volts_grant_operators SET operator_user_id = ?").run(userId),
  ).toThrow("operator audit is immutable");
  expect(() =>
    db
      .prepare(
        "INSERT INTO volts_grant_operators (entry_id, operator_user_id, provenance, recorded_at) VALUES (?, NULL, 'recorded', 1)",
      )
      .run(receipt.entryId),
  ).toThrow("CHECK constraint failed");
});

it("rejects a deleted operator account", async () => {
  const { userId, economy, grants, db, operatorId } = await grantApp();

  db.prepare("UPDATE users SET deleted_at = 1, email = 'gone@voltonaut.invalid' WHERE id = ?").run(
    operatorId,
  );

  expect(() => grants.grant(userId, grant("late", 500, operatorId))).toThrow(
    "operator account is deleted",
  );
  expect(economy.balance(userId)).toBe(0);
  expect(db.prepare("SELECT COUNT(*) AS count FROM volts_ledger").get()).toEqual({ count: 0 });
});

it("makes a ledger rebuild fail loudly instead of dropping the operator audit", async () => {
  const { userId, grants, db, operatorId } = await grantApp();

  grants.grant(userId, grant("rebuild", 500, operatorId));

  // Migrations run with foreign keys on inside one transaction; a cascade would empty the audit here.
  expect(() => db.transaction(() => db.exec("DROP TABLE volts_ledger"))()).toThrow(
    "FOREIGN KEY constraint failed",
  );
  expect(db.prepare("SELECT COUNT(*) AS count FROM volts_grant_operators").get()).toEqual({
    count: 1,
  });
});

it("replays a grant from before the audit for any operator as unknown", async () => {
  const { userId, grants, db, operatorId } = await grantApp();
  const first = grants.grant(userId, grant("legacy", 500, operatorId));

  db.prepare("DELETE FROM volts_grant_operators").run();
  db.prepare(
    "INSERT INTO volts_grant_operators (entry_id, operator_user_id, provenance, recorded_at) VALUES (?, NULL, 'unknown_before_audit', 1)",
  ).run(first.entryId);

  expect(grants.grant(userId, grant("legacy", 500, userId)).operator).toEqual({
    kind: "unknown_before_audit",
  });
});
