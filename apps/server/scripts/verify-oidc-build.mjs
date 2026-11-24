import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createOidcProvider } from "../src/testing/oidc-provider.spec.ts";

const origin = "http://127.0.0.1:5182";

async function randomPort() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = z.object({ port: z.number() }).parse(reservation.address());
  await new Promise((resolve) => {
    reservation.close(resolve);
  });

  return address.port;
}

async function waitForHealth(api, attempts = 100) {
  if (attempts === 0) throw new Error("compiled server did not become healthy");

  const response = await fetch(`${api}/healthz`, { signal: AbortSignal.timeout(1000) }).catch(
    () => {},
  );

  if (response?.ok === true) return;
  await delay(50);

  return waitForHealth(api, attempts - 1);
}

async function verifyFlow(api) {
  const capability = await fetch(`${api}/v1/auth/config`);
  assert.deepEqual(await capability.json(), { mode: "oidc" });
  const started = await fetch(`${api}/v1/auth/oidc/test/start`, { redirect: "manual" });
  assert.equal(started.status, 302);
  const cookie = z.string().parse(started.headers.get("set-cookie")?.split(";")[0]);

  const authorize = await fetch(z.string().url().parse(started.headers.get("location")), {
    redirect: "manual",
  });

  assert.equal(authorize.status, 302);

  const callback = await fetch(z.string().url().parse(authorize.headers.get("location")), {
    redirect: "manual",
    headers: { Cookie: cookie },
  });

  assert.equal(callback.status, 302);
  const finish = new URL(z.string().url().parse(callback.headers.get("location")));
  assert.equal(`${finish.origin}${finish.pathname}`, `${origin}/auth/finish`);

  const exchanged = await fetch(`${api}/v1/auth/oidc/exchange`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: finish.searchParams.get("code") }),
  });

  assert.equal(exchanged.status, 200);

  const session = z
    .object({
      sessionToken: z.string().min(43),
      user: z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        createdAt: z.string().datetime(),
      }),
    })
    .parse(await exchanged.json());

  const headers = { Authorization: `Bearer ${session.sessionToken}` };
  const me = await fetch(`${api}/v1/me`, { headers });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: session.user });
  assert.equal((await fetch(`${api}/v1/auth/logout`, { method: "POST", headers })).status, 204);
  assert.equal((await fetch(`${api}/v1/me`, { headers })).status, 401);
}

const provider = await createOidcProvider();
const port = await randomPort();
const api = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, ["dist/main.js"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: {
    NODE_ENV: "test",
    AUTH_MODE: "oidc",
    DATABASE_PATH: ":memory:",
    HOST: "127.0.0.1",
    PORT: String(port),
    OIDC_PROVIDERS: "test",
    OIDC_TEST_ISSUER: provider.issuer,
    OIDC_TEST_CLIENT_ID: "test-client",
    OIDC_TEST_CLIENT_SECRET: "test-secret",
    OIDC_TEST_REDIRECT_URI: `${api}/v1/auth/oidc/test/callback`,
    CLIENT_ORIGIN: origin,
  },
  stdio: "ignore",
});

try {
  await waitForHealth(api);
  await verifyFlow(api);
  process.stdout.write(
    "Compiled OIDC flow verified against local RS256 provider. No live provider calls.\n",
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }

  await provider.close();
}
