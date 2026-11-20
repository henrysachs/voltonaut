import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const directory = resolve(process.argv[2] ?? "");

assert.ok(existsSync(join(directory, "dist/main.js")), "pass the pnpm deploy output directory");

assert.ok(existsSync(join(directory, "drizzle/meta/_journal.json")), "packaged migration journal");

const temporary = mkdtempSync(join(tmpdir(), "voltonaut-package-"));
const databasePath = join(temporary, "auth.db");
const listener = createServer();

listener.listen(0, "127.0.0.1");

await once(listener, "listening");

const address = z.object({ port: z.number() }).parse(listener.address());

const port = address.port;

listener.close();

await once(listener, "close");

const environment = {
  PATH: process.env["PATH"],
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: `${port}`,
  DATABASE_PATH: databasePath,
  MAIL_PROVIDER: "resend",
  RESEND_API_KEY: "package-smoke-placeholder-never-used",
};

const server = spawn(process.execPath, ["dist/main.js"], {
  cwd: directory,
  env: environment,
  stdio: "ignore",
});

const exited = once(server, "exit");

async function waitForHealth(attempt = 0): Promise<Response> {
  const url = `http://127.0.0.1:${port}/healthz`;

  try {
    return await fetch(url);
  } catch {
    assert.equal(server.exitCode, null, "packaged server stays alive");
    assert.ok(attempt < 100, "packaged server starts within five seconds");
    await setTimeout(50);

    return waitForHealth(attempt + 1);
  }
}

try {
  const response = await waitForHealth();

  assert.equal(response.status, 200);
  z.object({
    status: z.literal("ok"),
    uptimeS: z.number().nonnegative(),
    version: z.literal("0.1.0"),
  })
    .strict()
    .parse(await response.json());

  const logout = await fetch(`http://127.0.0.1:${port}/v1/auth/logout`, { method: "POST" });

  assert.equal(logout.status, 401);
  assert.deepEqual(await logout.json(), {
    error: { code: "unauthorized", message: "missing bearer token" },
  });

  server.kill("SIGTERM");
  await exited;

  const db = new DatabaseSync(databasePath);

  z.object({ journal_mode: z.literal("wal") }).parse(db.prepare("PRAGMA journal_mode").get());
  assert.deepEqual(
    z
      .array(z.object({ name: z.string() }))
      .parse(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all(),
      ),
    ["__drizzle_migrations", "login_tokens", "profiles", "rides", "sessions", "users"].map(
      (name) => ({ name }),
    ),
  );
  z.object({ count: z.literal(2) }).parse(
    db.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get(),
  );
  db.close();

  const missingMail = spawnSync(process.execPath, ["dist/main.js"], {
    cwd: directory,
    env: { ...environment, RESEND_API_KEY: "" },
    stdio: "ignore",
    timeout: 5000,
  });

  assert.notEqual(missingMail.status, 0, "production rejects missing mail configuration");
  assert.equal(missingMail.error, undefined, "production fails rather than timing out");
  process.stdout.write(
    "Package smoke passed. Packaged migrations, WAL, public health, bearer guard, SIGTERM and fail-closed mail. No external network calls.\n",
  );
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    await exited;
  }

  rmSync(temporary, { recursive: true, force: true });
}
