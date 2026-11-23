/// <reference types="node" />
/// <reference lib="es2023" />
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomPort } from "../verify-browser-sync-control.mjs";
import {
  hashTree,
  manifestSource,
  runBuild,
  serveBuild,
  verifySourceManifest,
} from "./artifact.mjs";
import { createHost, createProviders } from "./host.mjs";
import { runBrowser } from "./browser.mjs";
import { verifyBuiltWebhook } from "./webhook.mjs";

const root = resolve(import.meta.dirname, "../..");
const temporary = join(tmpdir(), "opencode");

await mkdir(temporary, { recursive: true });

const artifacts =
  process.env["DELIVERY_CASE_ARTIFACTS"] ??
  (await mkdtemp(join(temporary, "full-ride-delivery-proof-")));

assert.deepEqual(await readdir(artifacts), [], "Case evidence directory must be new and empty");

const webDirectory = join(root, "apps/web");
const serverDirectory = join(root, "apps/server");
const webPort = await randomPort();
const apiPort = await randomPort();
const web = `http://127.0.0.1:${webPort}`;
const api = `http://127.0.0.1:${apiPort}`;
const database = join(artifacts, "actual.sqlite");
const webOutput = join(artifacts, "web-dist");
const serverOutput = join(artifacts, "server-dist");
const secret = randomBytes(32).toString("hex");
const { oidc, provider } = await createProviders(secret);

const host = await createHost({
  root,
  serverOutput,
  database,
  provider,
  oidc,
  environment: {
    NODE_ENV: "test",
    AUTH_MODE: "oidc",
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    DATABASE_PATH: database,
    CLIENT_ORIGIN: web,
    CORS_ORIGINS: web,
    OIDC_ISSUER: oidc.issuer,
    OIDC_CLIENT_ID: "test-client",
    OIDC_CLIENT_SECRET: "test-secret",
    OIDC_REDIRECT_URI: `${api}/v1/auth/oidc/callback`,
    STRAVA_MODE: "enabled",
    STRAVA_CLIENT_ID: "123",
    STRAVA_CLIENT_SECRET: secret,
    STRAVA_REDIRECT_URI: `${api}/v1/strava/callback`,
    STRAVA_TOKEN_KEY: secret,
    STRAVA_WEBHOOK_VERIFY_TOKEN: "b".repeat(64),
    STRAVA_WEBHOOK_SUBSCRIPTION_ID: "123",
    STRAVA_TEST_PROVIDER_ORIGIN: provider.origin,
    RIDE_SOURCE_POLICY: "declared_ble_v1",
  },
});

let staticServer;
const commands = [];

try {
  await manifestSource({
    root,
    artifacts,
    rerun: "mise exec -- node scripts/ride-delivery-integration/verify.mjs",
  });
  const config = join(artifacts, "vite.config.mjs");

  await writeFile(
    config,
    `import base from ${JSON.stringify(join(webDirectory, "vite.config.ts"))};\nexport default { ...base, root: ${JSON.stringify(webDirectory)}, envDir: ${JSON.stringify(artifacts)}, cacheDir: ${JSON.stringify(join(artifacts, "vite-cache"))}, build: { ...base.build, outDir: ${JSON.stringify(webOutput)}, emptyOutDir: true } };\n`,
  );

  const builds = [
    {
      args: [join(webDirectory, "node_modules/vite/bin/vite.js"), "build", "--config", config],
      cwd: webDirectory,
      name: "web-build",
    },
    {
      args: [
        join(serverDirectory, "node_modules/vite/bin/vite.js"),
        "build",
        "--outDir",
        serverOutput,
      ],
      cwd: serverDirectory,
      name: "server-build",
    },
  ];

  for (const build of builds) {
    commands.push(build);
    // oxlint-disable-next-line no-await-in-loop -- Compile each real artifact before starting any service.
    await runBuild(build.args, build.cwd, build.name, artifacts, api);
  }

  await symlink(join(serverDirectory, "node_modules"), join(serverOutput, "node_modules"));
  const webFiles = await hashTree(webOutput);
  const workers = webFiles.filter((file) => /(?:engine|render)-worker-[^/]+\.js$/u.test(file.path));

  assert.ok(workers.some((file) => file.path.includes("engine-worker-")));
  await writeFile(
    join(artifacts, "artifact-manifest.json"),
    JSON.stringify({ web: webFiles, server: await hashTree(serverOutput), workers }, null, 2),
  );
  staticServer = await serveBuild({ output: webOutput, port: webPort, origin: web, artifacts });
  await host.start();
  await verifyBuiltWebhook(api, artifacts);

  const result = await runBrowser({
    root,
    artifacts,
    database,
    web,
    api,
    control: host.origin,
    origins: [web, api, oidc.issuer, provider.origin],
    workers: workers.map((file) => `/${file.path}`),
    filter: process.argv[3],
  });

  commands.push(result);
  await verifySourceManifest(root, artifacts);
  assert.equal(result.status, 0, "Case failures remain red; inspect cases.json");
  assert.deepEqual(provider.snapshot().faults, []);
} finally {
  await host.close();
  await staticServer?.close();
  await writeFile(join(artifacts, "server.log"), host.log());
  await writeFile(join(artifacts, "provider.json"), JSON.stringify(provider.snapshot(), null, 2));
  await writeFile(join(artifacts, "commands.json"), JSON.stringify(commands, null, 2));
  await provider.close();
  await oidc.close();
  process.stdout.write(`Retained actual-artifact evidence: ${artifacts}\n`);
}
