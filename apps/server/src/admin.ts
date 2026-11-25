import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  AdminUsersQuerySchema,
  AccountUserIdSchema,
  VoltsDebitAmountSchema,
  VoltsGrantCommandSchema,
} from "@voltonaut/shared";
import { createDatabase, type ServerDatabase } from "./database/drizzle.provider.js";
import { parseServerConfig } from "./config.js";
import { accountsTables, economyTables, users } from "./schema.js";
import { AuthDirectory } from "./auth/auth-directory.js";
import { AccountsService } from "./accounts/accounts.service.js";
import { EconomyService } from "./economy/economy.service.js";
import { OperatorGrants } from "./economy/economy.grant.js";

/** Operator reference: becomes `operator:<reference>`, so a repeated credit books once. */
const CreditReferenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u);

const CommandSchema = z.union([
  z.tuple([z.literal("list")]),
  z.tuple([z.literal("list"), AccountUserIdSchema]),
  z.tuple([z.enum(["grant", "revoke"]), AccountUserIdSchema]),
  z.tuple([
    z.literal("credit"),
    AccountUserIdSchema,
    z
      .string()
      .regex(/^[1-9]\d*$/u)
      .transform(Number)
      .pipe(VoltsDebitAmountSchema),
    CreditReferenceSchema,
  ]),
]);

export interface AdminServices {
  readonly accounts: Readonly<AccountsService>;
  readonly economy: Readonly<Pick<EconomyService, "balance">>;
  readonly grants: Readonly<Pick<OperatorGrants, "grant">>;
  readonly userExists: (userId: string) => boolean;
}

/** Operator credit for tests and acceptance until rides earn Volts (spec E7-02 AK7). */
function credit(services: AdminServices, userId: string, amountVolts: number, reference: string) {
  if (!services.userExists(userId)) throw new Error("account not found");

  const receipt = services.grants.grant(
    userId,
    VoltsGrantCommandSchema.parse({
      idempotencyKey: `operator:${reference}`,
      refId: reference,
      amountVolts,
    }),
  );

  return JSON.stringify({ userId, receipt, voltsBalance: services.economy.balance(userId) });
}

export function runAdminCommand(args: readonly string[], services: AdminServices): string {
  const command = CommandSchema.parse(args);
  const { accounts } = services;

  if (command[0] === "credit") return credit(services, command[1], command[2], command[3]);

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
    const clock = { nowMs: () => Date.now() };
    const economy = new EconomyService(db, economyTables, clock);
    const grants = new OperatorGrants(db, economyTables, clock);
    const userExists = (userId: string): boolean => existingUser(db, userId);

    process.stdout.write(`${runAdminCommand(args, { accounts, economy, grants, userExists })}\n`);
  } finally {
    db.$client.close();
  }
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns its mutable driver state; this lookup only reads.
function existingUser(db: ServerDatabase, userId: string): boolean {
  return db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get() !== undefined;
}
