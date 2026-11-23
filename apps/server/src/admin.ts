import { z } from "zod";
import { AdminUsersQuerySchema, AccountUserIdSchema } from "@voltonaut/shared";
import { createDatabase } from "./database/drizzle.provider.js";
import { parseServerConfig } from "./config.js";
import { accountsTables } from "./schema.js";
import { AuthDirectory } from "./auth/auth-directory.js";
import { AccountsService } from "./accounts/accounts.service.js";

const CommandSchema = z.union([
  z.tuple([z.literal("list")]),
  z.tuple([z.literal("list"), AccountUserIdSchema]),
  z.tuple([z.enum(["grant", "revoke"]), AccountUserIdSchema]),
]);

export function runAdminCommand(
  args: readonly string[],
  accounts: Readonly<AccountsService>,
): string {
  const command = CommandSchema.parse(args);

  if (command[0] === "list")
    return JSON.stringify(accounts.list(AdminUsersQuerySchema.parse({ cursor: command[1] })));
  const userId = command[1];

  if (userId === undefined) throw new Error("existing user ID required");
  const status = accounts.setRole(userId, { role: command[0] === "grant" ? "admin" : "user" });

  return JSON.stringify({ userId, status });
}

export function adminMain(args: readonly string[]): void {
  CommandSchema.parse(args);
  const config = parseServerConfig(process.env, process.env["NODE_ENV"] ?? "development");
  const db = createDatabase(config);

  try {
    const directory = new AuthDirectory(db);
    const accounts = new AccountsService(db, accountsTables, directory);
    process.stdout.write(`${runAdminCommand(args, accounts)}\n`);
  } finally {
    db.$client.close();
  }
}
