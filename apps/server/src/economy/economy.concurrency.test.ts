import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { VoltsRideRangeCommandSchema } from "@voltonaut/shared";
import { testServerConfig } from "../config.js";
import { createDatabase } from "../database/drizzle.provider.js";
import { economyTables } from "../schema.js";
import type { VoltsLedgerTransaction } from "./economy.codec.js";
import { EconomyService } from "./economy.service.js";

const NOW_MS = Date.parse("2026-11-24T12:00:00.000Z");
const USER_ID = "40000000-0000-4000-8000-000000000001";
const JOURNAL_ONE = "40000000-0000-4000-8000-000000000002";
const JOURNAL_TWO = "40000000-0000-4000-8000-000000000003";

function rangeCommand(journalId: string) {
  return VoltsRideRangeCommandSchema.parse({
    journalId,
    startTick: 0,
    endTick: 1,
    rewardDay: "2026-11-24",
    cumulativeFacts: {
      activeDistanceM: 0,
      activeElevationGainM: 0,
      activeTimeS: 0,
      elevationGainM: 0,
      energyKj: 2000,
    },
  });
}

function postWhileLocked(
  first: Readonly<Pick<EconomyService, "transaction">>,
  second: Readonly<Pick<EconomyService, "creditRideRange">>,
  firstJournal: string,
  secondJournal: string,
) {
  const firstCommand = rangeCommand(firstJournal);
  const secondCommand = rangeCommand(secondJournal);
  let busyError: unknown;

  const firstReceipt = first.transaction((tx: Readonly<VoltsLedgerTransaction>) => {
    const receipt = tx.creditRideRange(USER_ID, firstCommand);

    try {
      second.creditRideRange(USER_ID, secondCommand);
    } catch (error) {
      busyError = error;
    }

    return receipt;
  });

  return { firstReceipt, busyError };
}

it("returns SQLITE_BUSY from a second connection and rereads daily usage after commit", () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-economy-lock-"));
  const path = join(directory, "economy.db");
  const config = testServerConfig({ database: { path, migrationsDir: "drizzle" } });
  const firstDb = createDatabase(config);

  try {
    firstDb.$client
      .prepare("INSERT INTO users (id, email, created_at, deleted_at) VALUES (?, ?, ?, NULL)")
      .run(USER_ID, "lock@example.com", NOW_MS);

    const secondDb = createDatabase(config);

    try {
      secondDb.$client.pragma("busy_timeout = 0");
      const clock = { nowMs: () => NOW_MS };
      const firstService = new EconomyService(firstDb, economyTables, clock);
      const secondService = new EconomyService(secondDb, economyTables, clock);

      const { firstReceipt, busyError } = postWhileLocked(
        firstService,
        secondService,
        JOURNAL_ONE,
        JOURNAL_TWO,
      );

      expect(busyError).toMatchObject({ code: "SQLITE_BUSY" });
      expect(firstReceipt.awardedVolts).toBe(2000);

      const secondCommand = rangeCommand(JOURNAL_TWO);
      const secondReceipt = secondService.creditRideRange(USER_ID, secondCommand);

      expect(secondReceipt).toMatchObject({
        candidateVolts: 2000,
        awardedVolts: 1000,
        withheldVolts: 1000,
      });
      expect(firstService.balance(USER_ID)).toBe(3000);
      expect(secondService.balance(USER_ID)).toBe(3000);
      expect(secondDb.$client.prepare("SELECT COUNT(*) AS total FROM volts_ledger").get()).toEqual({
        total: 2,
      });
    } finally {
      secondDb.$client.close();
    }
  } finally {
    firstDb.$client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
