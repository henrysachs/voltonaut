import { expect, it } from "vitest";
import { z } from "zod";
import { createTestApp, getDatabase } from "../testing/test-app.spec.js";
import { userOwnedTables } from "../testing/user-owned-tables.js";

it("installs recreation guards for every table with a user_id foreign key to users", async () => {
  const { app } = await createTestApp();

  try {
    const db = getDatabase(app).$client;
    const ownedTables = userOwnedTables(getDatabase(app));

    expect(ownedTables).toContain("volts_ledger");
    expect(ownedTables.length).toBeGreaterThan(1);

    for (const table of ownedTables) {
      const triggers = z
        .array(z.object({ name: z.string() }))
        .parse(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?")
            .all(table),
        );

      const names = triggers.map((trigger) => trigger.name);
      expect(names).toContain(`${table}_reject_deleted_owner_insert`);
      expect(names).toContain(`${table}_reject_deleted_owner_update`);
    }
  } finally {
    await app.close();
  }
});
