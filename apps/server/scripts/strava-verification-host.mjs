import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { LocalStravaProvider } from "../src/testing/strava-provider.spec.ts";
import { createOidcProvider } from "../src/testing/oidc-provider.spec.ts";

async function reservePort() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = z.object({ port: z.number() }).parse(reservation.address());
  await new Promise((done) => {
    reservation.close(done);
  });

  return port;
}

/** @param {string} root @param {string} serverDirectory */
export async function createVerificationHost(root, serverDirectory) {
  const origin = "http://127.0.0.1:5197";
  const temporary = mkdtempSync(join(tmpdir(), "voltonaut-strava-proof-"));
  const databasePath = join(temporary, "proof.db");
  const secret = randomBytes(32).toString("hex");
  const provider = new LocalStravaProvider("123", secret);
  const oidc = await createOidcProvider();
  await provider.listen();
  const port = await reservePort();
  const api = `http://127.0.0.1:${port}`;

  const environment = {
    NODE_ENV: "test",
    AUTH_MODE: "oidc",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_PATH: databasePath,
    CLIENT_ORIGIN: origin,
    CORS_ORIGINS: origin,
    OIDC_ISSUER: oidc.issuer,
    OIDC_CLIENT_ID: "test-client",
    OIDC_CLIENT_SECRET: "test-secret",
    OIDC_REDIRECT_URI: `${api}/v1/auth/oidc/callback`,
    THROTTLER_SESSION_IP_PER_MIN: "1000",
    STRAVA_MODE: "enabled",
    STRAVA_CLIENT_ID: "123",
    STRAVA_CLIENT_SECRET: secret,
    STRAVA_REDIRECT_URI: `${api}/v1/strava/callback`,
    STRAVA_TOKEN_KEY: randomBytes(32).toString("hex"),
    STRAVA_TEST_PROVIDER_ORIGIN: provider.origin,
  };

  const fixture = await startFixture(root, api);

  return {
    origin,
    api,
    databasePath,
    provider,
    oidc,
    fixture,
    temporary,
    environment,
    serverDirectory,
    preload: join(root, "apps/server/scripts/loopback-network-only.mjs"),
  };
}

/** @param {string} root @param {string} api */
async function startFixture(root, api) {
  const html = readFileSync(join(root, "apps/server/scripts/strava-fixture.html"), "utf8").replace(
    "__API__",
    api,
  );

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Node owns the mutable HTTP handles in this boundary adapter.
  const fixture = createServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    res.end(html);
  });

  fixture.listen(5197, "127.0.0.1");
  await once(fixture, "listening");

  return fixture;
}

/** @param {Readonly<Awaited<ReturnType<typeof createVerificationHost>>>} host */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The harness passes native process/server handles without copying them.
export function startVerificationServer(host) {
  return spawn(process.execPath, ["--import", host.preload, "dist/main.js"], {
    cwd: host.serverDirectory,
    env: host.environment,
    stdio: "ignore",
  });
}

/** @param {Readonly<import("node:child_process").ChildProcess>} child */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Stopping the owned child requires Node's mutable process handle.
export async function stopVerificationServer(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
}

/** @param {Readonly<Awaited<ReturnType<typeof createVerificationHost>>>} host */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The host includes owned native server handles, not transferable values.
export function verifyStartupRejections(host) {
  for (const overrides of [
    { STRAVA_TOKEN_KEY: "invalid" },
    { NODE_ENV: "production", AUTH_MODE: "disabled" },
    {
      NODE_ENV: "production",
      AUTH_MODE: "magic-link",
      MAIL_PROVIDER: "memory",
      STRAVA_MODE: "disabled",
    },
  ]) {
    const result = spawnSync(process.execPath, ["--import", host.preload, "dist/main.js"], {
      cwd: host.serverDirectory,
      env: { ...host.environment, ...overrides },
      stdio: "ignore",
      timeout: 5000,
    });

    if (result.status === 0 || result.error !== undefined)
      throw new Error("startup must reject invalid configuration without timeout");
  }
}

/** @param {Readonly<Awaited<ReturnType<typeof createVerificationHost>>>} host */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Closing the harness requires its original native server handles.
export async function closeVerificationHost(host) {
  host.fixture.closeAllConnections();
  await new Promise((done) => {
    host.fixture.close(done);
  });
  await host.provider.close();
  await host.oidc.close();
  rmSync(host.temporary, { recursive: true, force: true });
}
