import { execFile } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { AccountStatusSchema, AdminUsersSchema, VoltsGrantReceiptSchema } from "@voltonaut/shared";
import { buildServerProcess } from "./testing/server-process.spec.js";
import { createDatabase } from "./database/drizzle.provider.js";
import { testServerConfig } from "./config.js";
import { z } from "zod";

const ResultSchema = z.object({ userId: z.string(), status: AccountStatusSchema });

const CreditSchema = z.object({
  userId: z.string(),
  receipt: VoltsGrantReceiptSchema,
  voltsBalance: z.number(),
});

let directory = "";

beforeAll(async () => {
  directory = await buildServerProcess();
  await writeFile(
    join(directory, "no-server.mjs"),
    `
    import { Server } from 'node:net';
    import timers from 'node:timers';
    const forbidden = () => { throw new Error('CLI opened listener or scheduler'); };
    Server.prototype.listen = forbidden;
    globalThis.setInterval = forbidden;
    timers.setInterval = forbidden;
  `,
  );
}, 30000);

afterAll(async () => {
  if (directory !== "") await rm(directory, { recursive: true, force: true });
});

function cli(
  path: string,
  ...args: readonly string[]
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolveResult, reject) => {
    execFile(
      process.execPath,
      ["--import", join(directory, "no-server.mjs"), join(directory, "main.js"), ...args],
      {
        cwd: directory,
        env: {
          NODE_ENV: "test",
          AUTH_MODE: "disabled",
          STRAVA_MODE: "disabled",
          DATABASE_PATH: path,
          DRIZZLE_MIGRATIONS_DIR: resolve("apps/server/drizzle"),
        },
        timeout: 10000,
      },
      (error: Readonly<Error> | null, stdout, stderr) => {
        if (error === null) resolveResult({ stdout, stderr });
        else reject(error);
      },
    );
  });
}

it("runs the compiled production entrypoint without HTTP or scheduler and grants only explicit existing IDs", async () => {
  const path = join(directory, "operator.db");
  const config = testServerConfig({ database: { path, migrationsDir: "drizzle" } });
  const db = createDatabase(config);
  db.$client.prepare("INSERT INTO users VALUES ('existing','operator@example.com',123,NULL)").run();
  db.$client.prepare("INSERT INTO account_status VALUES ('existing','pro',1,'user')").run();
  db.$client.close();
  const listed = await cli(path, "admin", "list");
  expect(AdminUsersSchema.parse(JSON.parse(listed.stdout)).users).toEqual([
    {
      id: "existing",
      email: "operator@example.com",
      displayName: null,
      membership: { tier: "pro", vip: true },
    },
  ]);
  expect(listed.stderr).toBe("");
  const granted = await cli(path, "admin", "grant", "existing");
  expect(ResultSchema.parse(JSON.parse(granted.stdout)).status).toEqual({
    membership: { tier: "pro", vip: true },
    authorization: { role: "admin" },
  });
  const revoked = await cli(path, "admin", "revoke", "existing");
  expect(ResultSchema.parse(JSON.parse(revoked.stdout)).status.authorization.role).toBe("user");
  await expect(cli(path, "admin", "grant", "missing")).rejects.toThrow("account not found");
  await expect(cli(path, "admin", "grant")).rejects.toThrow("ZodError");
  await expect(cli(path, "admin", "grant", "existing", "extra")).rejects.toThrow("ZodError");
  await expect(cli(path, "unexpected")).rejects.toThrow("usage:");
  const reopened = createDatabase(config);
  expect(reopened.$client.prepare("SELECT id FROM users").all()).toEqual([{ id: "existing" }]);
  expect(reopened.$client.prepare("SELECT tier,vip,role FROM account_status").get()).toEqual({
    tier: "pro",
    vip: 1,
    role: "user",
  });
  reopened.$client.close();
}, 30000);

it("credits Volts to an existing account once per reference through the compiled CLI", async () => {
  const path = join(directory, "credit.db");
  const config = testServerConfig({ database: { path, migrationsDir: "drizzle" } });
  const db = createDatabase(config);
  db.$client.prepare("INSERT INTO users VALUES ('existing','operator@example.com',123,NULL)").run();
  db.$client.close();

  const first = CreditSchema.parse(
    JSON.parse((await cli(path, "admin", "credit", "existing", "7000", "acceptance-e7")).stdout),
  );

  const again = CreditSchema.parse(
    JSON.parse((await cli(path, "admin", "credit", "existing", "7000", "acceptance-e7")).stdout),
  );

  expect(first).toMatchObject({
    userId: "existing",
    receipt: { refId: "acceptance-e7", amountVolts: 7000 },
    voltsBalance: 7000,
  });
  expect(again).toEqual(first);
  await expect(cli(path, "admin", "credit", "existing", "9000", "acceptance-e7")).rejects.toThrow(
    "ledger conflict",
  );
  await expect(cli(path, "admin", "credit", "missing", "10", "other")).rejects.toThrow(
    "account not found",
  );
  await expect(cli(path, "admin", "credit", "existing", "-5", "neg")).rejects.toThrow("ZodError");
  await expect(cli(path, "admin", "credit", "existing", "5", "bad ref")).rejects.toThrow(
    "ZodError",
  );

  const reopened = createDatabase(config);
  expect(
    reopened.$client.prepare("SELECT reason, delta_volts, ref_id FROM volts_ledger").all(),
  ).toEqual([{ reason: "operator_grant", delta_volts: 7000, ref_id: "acceptance-e7" }]);
  reopened.$client.close();
}, 30000);
