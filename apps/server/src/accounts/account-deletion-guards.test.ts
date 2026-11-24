import { expect, it } from "vitest";
import { z } from "zod";
import { createTestApp, getDatabase } from "../testing/test-app.spec.js";

it("installs recreation guards for every current account-owned table", async () => {
  const { app } = await createTestApp();

  try {
    const db = getDatabase(app).$client;

    const ownedTables = [
      "profiles",
      "account_status",
      "rides",
      "auth_identities",
      "oidc_handoffs",
      "sessions",
      "strava_transactions",
      "strava_connections",
      "strava_deliveries",
    ];

    const placeholders = ownedTables.map(() => "?").join(",");

    const tables = z
      .array(z.object({ name: z.string() }))
      .parse(
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders}) ORDER BY name`,
          )
          .all(...ownedTables),
      );

    expect(tables.map((table) => table.name)).toEqual([...ownedTables].toSorted());

    for (const table of tables) {
      const triggers = z
        .array(z.object({ name: z.string() }))
        .parse(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?")
            .all(table.name),
        );

      const names = triggers.map((trigger) => trigger.name);
      expect(names).toContain(`${table.name}_reject_deleted_owner_insert`);
      expect(names).toContain(`${table.name}_reject_deleted_owner_update`);
    }
  } finally {
    await app.close();
  }
});
