import { afterEach, expect, it } from "vitest";

import { VoltsRideRangeCommandSchema } from "@voltonaut/shared";
import { createTestApp, getDatabase, loginTestUser } from "../testing/test-app.spec.js";
import { EconomyService } from "./economy.service.js";

const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

function rangeInput(journalId: string) {
  return VoltsRideRangeCommandSchema.parse({
    journalId,
    startTick: 0,
    endTick: 10,
    rewardDay: "2026-11-24",
    cumulativeFacts: {
      activeDistanceM: 0,
      activeElevationGainM: 0,
      activeTimeS: 0,
      elevationGainM: 0,
      energyKj: 10,
    },
  });
}

it("enforces global ride range indexes but allows a purchase with the same reference", async () => {
  const testApp = await createTestApp({ clock: { nowMs: () => 0 } });
  cleanup.add(() => testApp.app.close());
  const owner = await loginTestUser(testApp.app, testApp.mail, "owner@example.com");
  const other = await loginTestUser(testApp.app, testApp.mail, "other@example.com");
  const economy = testApp.app.get<EconomyService>(EconomyService);
  const db = getDatabase(testApp.app).$client;
  const journalId = "60000000-0000-4000-8000-000000000001";

  economy.creditRideRange(owner.user.id, rangeInput(journalId));

  const clone = db.prepare(`
    INSERT INTO volts_ledger (
      id, user_id, delta_volts, reason, ref_id, idempotency_key, payload_hash,
      reward_day, start_tick, end_tick, candidate_volts, cumulative_work_volts,
      cumulative_climb_volts, cumulative_facts_json, created_at
    )
    SELECT ?, ?, delta_volts, reason, ref_id, ?, payload_hash,
           reward_day, ?, ?, candidate_volts, cumulative_work_volts,
           cumulative_climb_volts, cumulative_facts_json, created_at
    FROM volts_ledger WHERE ref_id = ?
  `);

  expect(() =>
    clone.run("duplicate-start", other.user.id, "ride:duplicate-start", 0, 20, journalId),
  ).toThrow("volts_ledger.ref_id, volts_ledger.start_tick");
  expect(() =>
    clone.run("duplicate-end", owner.user.id, "ride:duplicate-end", 5, 10, journalId),
  ).toThrow("volts_ledger.ref_id, volts_ledger.end_tick");

  db.prepare(`
    INSERT INTO volts_ledger (
      id, user_id, delta_volts, reason, ref_id, idempotency_key, payload_hash,
      reward_day, start_tick, end_tick, candidate_volts, cumulative_work_volts,
      cumulative_climb_volts, cumulative_facts_json, created_at
    ) VALUES (?, ?, ?, 'purchase', ?, ?, 'hash', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0)
  `).run("purchase-same-ref", owner.user.id, -1, journalId, "purchase:same-ref");

  expect(
    db.prepare("SELECT reason FROM volts_ledger WHERE id = 'purchase-same-ref'").get(),
  ).toEqual({
    reason: "purchase",
  });
});
