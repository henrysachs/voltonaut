import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { buildServerProcess } from "./testing/server-process.spec.js";

let directory = "";

const PROVIDER_LIST = {
  NODE_ENV: "production",
  AUTH_MODE: "oidc",
  CLIENT_ORIGIN: "https://voltonaut.stammkneipe.dev",
  OIDC_PROVIDERS: "cloudflare",
  OIDC_CLOUDFLARE_ISSUER: "https://login.example.com/oidc",
  OIDC_CLOUDFLARE_CLIENT_ID: "synthetic-client",
  OIDC_CLOUDFLARE_CLIENT_SECRET: "synthetic-secret-must-not-print",
  AUTH_TOMBSTONE_HMAC_KEY: "a".repeat(64),
  OIDC_CLOUDFLARE_REDIRECT_URI:
    "https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/cloudflare/callback",
};

const LEGACY_SINGLE_SET = {
  NODE_ENV: "production",
  AUTH_MODE: "oidc",
  CLIENT_ORIGIN: "https://voltonaut.stammkneipe.dev",
  OIDC_ISSUER: "https://login.example.com/oidc",
  OIDC_CLIENT_ID: "synthetic-client",
  OIDC_CLIENT_SECRET: "synthetic-secret-must-not-print",
  OIDC_REDIRECT_URI: "https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback",
};

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

beforeAll(async () => {
  directory = await buildServerProcess();
  await writeFile(
    join(directory, "no-server.mjs"),
    `
    import { Server } from 'node:net';
    import timers from 'node:timers';
    const forbidden = () => { throw new Error('check-config opened listener or scheduler'); };
    Server.prototype.listen = forbidden;
    globalThis.setInterval = forbidden;
    timers.setInterval = forbidden;
  `,
  );
  await writeFile(
    join(directory, "module-graph.mjs"),
    `
    import { registerHooks } from 'node:module';
    const loaded = [];
    registerHooks({ load(url, context, next) { loaded.push(url); return next(url, context); } });
    process.on('exit', () => { process.stderr.write(JSON.stringify(loaded)); });
  `,
  );
}, 30_000);

afterAll(async () => {
  if (directory !== "") await rm(directory, { recursive: true, force: true });
});

function checkConfig(env: Readonly<Record<string, string>>, ...args: readonly string[]) {
  return runCheckConfig(["--import", join(directory, "no-server.mjs")], env, args);
}

function runCheckConfig(
  imports: readonly string[],
  env: Readonly<Record<string, string>>,
  args: readonly string[],
) {
  return new Promise<CliResult>((resolveResult) => {
    execFile(
      process.execPath,
      [...imports, join(directory, "main.js"), "check-config", ...args],
      {
        cwd: directory,
        env: { ...env, DATABASE_PATH: join(directory, "must-not-exist.db") },
        timeout: 10_000,
      },
      (error: Readonly<{ code?: number | string | null }> | null, stdout, stderr) => {
        resolveResult({ code: Number(error?.code ?? 0), stdout, stderr });
      },
    );
  });
}

it("accepts the provider-list configuration without opening a listener or database", async () => {
  expect(await checkConfig(PROVIDER_LIST)).toEqual({ code: 0, stdout: "config: ok\n", stderr: "" });
  expect(existsSync(join(directory, "must-not-exist.db"))).toBe(false);
});

it("loads only the configuration graph, not the Nest app or the database driver", async () => {
  const result = await runCheckConfig(
    ["--import", join(directory, "module-graph.mjs")],
    PROVIDER_LIST,
    [],
  );

  expect(result.code).toBe(0);

  const loaded = z.array(z.string()).parse(JSON.parse(result.stderr));

  const heavy = loaded.filter((url) =>
    /\/node_modules\/(@nestjs|drizzle-orm|better-sqlite3|openid-client|rxjs|reflect-metadata)\//u.test(
      url,
    ),
  );

  expect(heavy).toEqual([]);
  // 13 modules when measured (E0-16); the full app graph is about 970.
  expect(loaded.length).toBeLessThan(30);
});

it("rejects the removed single OIDC set without printing any value", async () => {
  expect(await checkConfig(LEGACY_SINGLE_SET)).toEqual({
    code: 1,
    stdout: "",
    stderr: "config: invalid\n",
  });
});

it("rejects extra arguments", async () => {
  const result = await checkConfig(PROVIDER_LIST, "extra");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("usage:");
  expect(result.stderr).not.toContain("synthetic-secret-must-not-print");
});
