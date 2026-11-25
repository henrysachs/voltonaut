import { afterEach, expect, it } from "vitest";

import { VoltsRideRangeCommandSchema, type VoltsRideRangeCommand } from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { createTestApp, getDatabase } from "../testing/test-app.spec.js";
import { seedOwners } from "../testing/migration-harness.spec.js";
import { EconomyService } from "./economy.service.js";

const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

function command(
  journalId: string,
  startTick: number,
  endTick: number,
  energyKj: number,
  activeDistanceM = 0,
): VoltsRideRangeCommand {
  return VoltsRideRangeCommandSchema.parse({
    journalId,
    startTick,
    endTick,
    rewardDay: "2026-11-24",
    cumulativeFacts: {
      activeDistanceM,
      activeElevationGainM: 0,
      activeTimeS: 0,
      elevationGainM: 0,
      energyKj,
    },
  });
}

function expectConflict(action: () => void): void {
  expect(action).toThrow(ApiError);
  expect(action).toThrow(expect.objectContaining({ code: "ledger_conflict", status: 409 }));
}

it("requires the first range to start at tick zero", async () => {
  const testApp = await createTestApp({ clock: { nowMs: () => 0 } });
  cleanup.add(() => testApp.app.close());
  seedOwners(getDatabase(testApp.app), [{ id: "owner" }]);
  const economy = testApp.app.get<EconomyService>(EconomyService);

  expectConflict(() => {
    economy.creditRideRange("owner", command("50000000-0000-4000-8000-000000000001", 5, 6, 10));
  });
  expect(getDatabase(testApp.app).$client.prepare("SELECT * FROM volts_ledger").all()).toEqual([]);
});

it("rejects raw cumulative fact regression even when Volts components do not regress", async () => {
  const testApp = await createTestApp({ clock: { nowMs: () => 0 } });
  cleanup.add(() => testApp.app.close());
  seedOwners(getDatabase(testApp.app), [{ id: "owner" }]);
  const economy = testApp.app.get<EconomyService>(EconomyService);
  const journalId = "50000000-0000-4000-8000-000000000002";

  economy.creditRideRange("owner", command(journalId, 0, 1, 5.9, 10));
  const rows = getDatabase(testApp.app).$client.prepare("SELECT * FROM volts_ledger").all();

  expectConflict(() => {
    economy.creditRideRange("owner", command(journalId, 1, 2, 5.1, 9.9));
  });
  expect(getDatabase(testApp.app).$client.prepare("SELECT * FROM volts_ledger").all()).toEqual(
    rows,
  );
});
