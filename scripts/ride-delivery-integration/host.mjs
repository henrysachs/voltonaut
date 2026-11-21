/// <reference types="node" />
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "../../packages/shared/node_modules/zod/index.js";
import { databaseSnapshot } from "./database.mjs";
import { createDeliveryProvider } from "./provider.mjs";
import { createOidcProvider } from "../../apps/server/src/testing/oidc-provider.spec.ts";

/** @param {string} secret */
export async function createProviders(secret) {
  return { oidc: await createOidcProvider(), provider: await createDeliveryProvider(secret) };
}

/** @param {string} origin */
async function healthy(origin) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Health polling waits for this owned process only.
    const response = await fetch(origin, { signal: AbortSignal.timeout(1000) }).catch(() => null);

    if (response?.ok === true) return;
    // oxlint-disable-next-line no-await-in-loop -- Preserve the real service clock and normal product timeouts.
    await delay(100);
  }

  throw new Error(`Owned service failed to start: ${origin}`);
}

/** @typedef {{readonly root: string; readonly serverOutput: string; readonly environment: Readonly<Record<string, string>>; readonly database: string; readonly provider: Awaited<ReturnType<typeof import('./provider.mjs').createDeliveryProvider>>; readonly oidc: Awaited<ReturnType<typeof import('../../apps/server/src/testing/oidc-provider.spec.ts').createOidcProvider>>}} HostOptions */

/** @param {HostOptions} options */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The host coordinates its owned mutable native provider controls.
function createApi(options) {
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  let log = "";

  async function stop() {
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");

    child.kill("SIGTERM");
    await exited;
  }

  async function start() {
    child = spawn(
      process.execPath,
      [
        "--import",
        join(options.root, "scripts/strava-verification/loopback-network-only.mjs"),
        join(options.serverOutput, "main.js"),
      ],
      {
        cwd: join(options.root, "apps/server"),
        env: options.environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", (chunk) => {
      log += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      log += String(chunk);
    });
    await healthy(`http://127.0.0.1:${options.environment["PORT"]}/healthz`);
  }

  return { start, stop, log: () => log };
}

/** @param {HostOptions} options */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The coordinator controls these owned provider instances.
export async function createHost(options) {
  const api = createApi(options);
  let identity = 0;

  /** @param {string} path */
  async function command(path) {
    if (path === "/identity") {
      identity += 1;
      options.oidc.control.subject = `delivery-synthetic-${identity}`;
      options.oidc.control.email = `delivery-${identity}@example.com`;
      options.provider.oauth.control.athleteId = 100 + identity;
      options.provider.setMode("processing");
    } else if (path === "/restart") {
      await api.stop();
      await api.start();
    } else if (path === "/hold") options.provider.hold();
    else if (path === "/release") options.provider.release();
    else if (path.startsWith("/mode/")) options.provider.setMode(path.slice(6));
    else throw new Error("Unknown local control command");
  }

  const server = controlServer(options, command);

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = z.object({ port: z.number() }).parse(server.address());

  return {
    origin: `http://127.0.0.1:${address.port}`,
    start: api.start,
    async close() {
      await api.stop();
      server.closeAllConnections();
      await new Promise((done) => {
        server.close(done);
      });
    },
    log: api.log,
  };
}

/** @param {{readonly database: string; readonly provider: Awaited<ReturnType<typeof import('./provider.mjs').createDeliveryProvider>>}} options @param {(path: string) => Promise<void>} command */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Provider controls are owned mutable HTTP peers.
function controlServer(options, command) {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Node owns HTTP request/response lifecycle handles.
  return createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

      response.setHeader("Content-Type", "application/json");

      if (request.method === "GET" && path === "/state") {
        response.end(
          JSON.stringify({
            provider: options.provider.snapshot(),
            deliveries: databaseSnapshot(options.database),
          }),
        );

        return;
      }

      assert.equal(request.method, "POST");
      await command(path);
      response.writeHead(204);
      response.end();
    })().catch((error) => {
      response.writeHead(500);
      response.end(JSON.stringify({ error: String(error) }));
    });
  });
}
