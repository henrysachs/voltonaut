import { expect, it } from "vitest";
import { seedOwners, upgradeFrom } from "../testing/migration-harness.spec.js";

const SEED = `
  INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,created_at)
    VALUES ('a-grant','owner',7000,'operator_grant','acceptance','operator:acceptance','hash-a',3);
  INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,created_at)
    VALUES ('b-buy','owner',-1500,'purchase','jersey.stripe','purchase:r','hash-b',4);
`;

const LEDGER_ROWS = "SELECT * FROM volts_ledger ORDER BY id";

it("marks existing grants as operator unknown before the audit instead of inventing one", () => {
  const upgrade = upgradeFrom("0012_progress_consent_journals", (old) => {
    seedOwners(old, [{ id: "owner", email: "owner@example.com", createdAt: 1 }]);
    old.$client.exec(SEED);

    return old.$client.prepare(LEDGER_ROWS).all();
  });

  const next = upgrade.open();

  expect(next.$client.prepare(LEDGER_ROWS).all()).toEqual(upgrade.seeded);
  expect(next.$client.prepare("SELECT * FROM volts_grant_operators").all()).toEqual([
    {
      entry_id: "a-grant",
      operator_user_id: null,
      provenance: "unknown_before_audit",
      recorded_at: 3,
    },
  ]);
  expect(next.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
