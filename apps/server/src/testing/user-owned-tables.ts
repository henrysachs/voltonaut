import { z } from "zod";
import type { DatabaseReader } from "./test-app.spec.js";

const TableNameSchema = z.object({ name: z.string() });

const UserForeignKeySchema = z.object({
  table: z.string(),
  from: z.string(),
  to: z.string().nullable(),
});

export function userOwnedTables(db: DatabaseReader): readonly string[] {
  const tables = z
    .array(TableNameSchema)
    .parse(
      db.$client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all(),
    )
    .map((table) => table.name);

  return tables.filter((table) =>
    z
      .array(UserForeignKeySchema)
      .parse(
        db.$client
          .prepare('SELECT "table", "from", "to" FROM pragma_foreign_key_list(?)')
          .all(table),
      )
      .some((key) => key.table === "users" && key.from === "user_id" && key.to === "id"),
  );
}
