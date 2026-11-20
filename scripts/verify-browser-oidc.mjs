import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createOidcProvider } from "../apps/server/src/testing/oidc-provider.spec.ts";

const root = join(import.meta.dirname, "..");
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const temporary = join(tmpdir(), "opencode");

await mkdir(temporary, { recursive: true });

const artifacts = await mkdtemp(join(temporary, "browser-oidc-"));
const webOrigin = "http://127.0.0.1:5187";

async function randomPort() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();

  if (address instanceof Object) {
    await new Promise((resolve) => {
      reservation.close(resolve);
    });

    return address.port;
  }

  throw new Error("Missing local port");
}

/** @param {string} api */
async function waitForHealth(api, attempts = 100) {
  if (attempts === 0) throw new Error("Local service did not become healthy");
  const response = await fetch(api, { signal: AbortSignal.timeout(1000) }).catch(() => {});

  if (response?.ok === true) return;
  await delay(50);
  await waitForHealth(api, attempts - 1);
}

/** @param {import('node:child_process').ChildProcess} child */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Node owns ChildProcess and its mutable EventEmitter lifecycle.
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}

/** @param {string} api */
async function configureVite(api) {
  const config = join(artifacts, "vite.config.mjs");
  await writeFile(
    config,
    `export default ${JSON.stringify({ root: join(root, "apps/web"), cacheDir: join(artifacts, "vite-cache"), server: { host: "127.0.0.1", port: 5187, strictPort: true } })}`,
  );

  return spawn(
    process.execPath,
    [join(requireWeb.resolve("vite/package.json"), "..", "bin/vite.js"), "--config", config],
    {
      cwd: root,
      env: { PATH: process.env["PATH"], VITE_API_ORIGIN: api },
      stdio: "ignore",
    },
  );
}

/** @param {string} api @param {string} phase */
async function runBrowser(api, phase) {
  const config = join(artifacts, "playwright.config.mjs");
  await writeFile(
    config,
    `export default ${JSON.stringify({ testDir: join(root, "apps/web/verification"), testMatch: "oidc.browser.spec.ts", timeout: 60000, workers: 1, reporter: "list", outputDir: join(artifacts, "results"), use: { headless: true, launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } } })}`,
  );

  const runner = spawn(
    process.execPath,
    [requireWeb.resolve("@playwright/test/cli"), "test", "--config", config, "--grep", phase],
    {
      cwd: root,
      env: {
        PATH: process.env["PATH"],
        HOME: process.env["HOME"],
        TMPDIR: process.env["TMPDIR"],
        API_ORIGIN: api,
        AUTH_ARTIFACTS: artifacts,
      },
      stdio: "inherit",
    },
  );

  const exited = await once(runner, "exit");
  assert.equal(exited[0], 0, "Browser verification failed");
}

async function verifyBundle() {
  const directory = join(root, "apps/web/dist");
  const files = await readdir(directory, { recursive: true });

  const contents = await Promise.all(
    files.flatMap((file) =>
      /\.(?:js|html)$/u.test(file) ? [readFile(join(directory, file), "utf8")] : [],
    ),
  );

  assert.ok(contents.length > 0);

  for (const content of contents)
    assert.equal(/test-secret|provider-access-private/u.test(content), false);
}

const provider = await createOidcProvider();
const port = await randomPort();
const api = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, ["dist/main.js"], {
  cwd: join(root, "apps/server"),
  env: {
    NODE_ENV: "test",
    AUTH_MODE: "oidc",
    DATABASE_PATH: ":memory:",
    HOST: "127.0.0.1",
    PORT: String(port),
    OIDC_ISSUER: provider.issuer,
    OIDC_CLIENT_ID: "test-client",
    OIDC_CLIENT_SECRET: "test-secret",
    OIDC_REDIRECT_URI: `${api}/v1/auth/oidc/callback`,
    CLIENT_ORIGIN: webOrigin,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";

child.stdout.setEncoding("utf8");

child.stderr.setEncoding("utf8");

/** @param {string} chunk */
function captureLog(chunk) {
  serverLog += chunk;
}

child.stdout.on("data", captureLog);

child.stderr.on("data", captureLog);

let vite;

try {
  await verifyBundle();
  await waitForHealth(`${api}/healthz`);
  vite = await configureVite(api);
  await waitForHealth(webOrigin);
  await runBrowser(api, "online");
  assert.ok(provider.control.tokenCalls >= 4);
  assert.ok(provider.control.jwksCalls > 0);
  await stopChild(child);
  await runBrowser(api, "offline");
  assert.equal(
    /Bearer |code=|[A-Za-z0-9_-]{43}|provider-access-private|test-secret/u.test(serverLog),
    false,
  );
  await writeFile(
    join(artifacts, "proof.json"),
    JSON.stringify(
      {
        compiledApi: true,
        signedProvider: "RS256",
        tokenCalls: provider.control.tokenCalls,
        jwksCalls: provider.control.jwksCalls,
        checks: [
          "login",
          "restore",
          "logout",
          "memory-session",
          "invalid-handoff",
          "navigation-cancel-and-continue",
          "offline-world-recording-tcx",
        ],
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    `Signed browser OIDC, restore/logout, memory session, navigation guard and offline world/TCX verified. Artifacts: ${artifacts}\n`,
  );
} finally {
  if (vite !== undefined) await stopChild(vite);
  await stopChild(child);
  await provider.close();
}
