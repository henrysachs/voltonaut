import request from "supertest";
import { expect, it } from "vitest";
import { setup, start, ORIGIN } from "../testing/oidc-flow.spec.js";
import { getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import type { SupertestResponsePort } from "../testing/test-app.spec.js";
import { z } from "zod";
import { createOidcTokenGate } from "../testing/oidc-token-gate.spec.js";

function seedTransactions(
  app: Parameters<typeof getDatabase>[0],
  count: number,
  expiresAt: number,
): void {
  const client = getDatabase(app).$client;

  const insert = client.prepare(
    "INSERT INTO oidc_transactions (state_hash, binding_hash, nonce, verifier, expires_at) VALUES (?, 'binding', 'nonce', 'verifier', ?)",
  );

  client.transaction(() => {
    for (let index = 0; index < count; index += 1) insert.run(`active-${index}`, expiresAt);
  })();
}

it("keeps in-flight callbacks in the capacity bound and atomically replaces claims with handoffs", async () => {
  const context = await setup();
  const first = await start(context);
  const second = await start(context);
  const client = getDatabase(context.app).$client;
  seedTransactions(context.app, 998, context.time.nowMs + 300_000);
  const gate = createOidcTokenGate(2);
  context.provider.control.tokenGate = gate;
  const server = httpServerOf(context.app);

  const callbacks = Promise.all(
    [first, second].map((flow: Readonly<typeof first>) =>
      request(server)
        .get(flow.callback)
        .set("Cookie", flow.cookie)
        .then((response: SupertestResponsePort) => response),
    ),
  );

  try {
    await gate.ready;
    expect(client.prepare("SELECT * FROM oidc_transactions").all()).toHaveLength(1000);
    expect(
      client.prepare("SELECT * FROM oidc_transactions WHERE claimed_at IS NOT NULL").all(),
    ).toHaveLength(2);
    await request(server).get("/v1/auth/oidc/test/start").expect(429);
  } finally {
    gate.release();
    context.provider.control.tokenGate = undefined;
    await callbacks;
  }

  const completed = await callbacks;
  expect(completed.map((response: { readonly status: number }) => response.status)).toEqual([
    302, 302,
  ]);
  expect(client.prepare("SELECT * FROM oidc_transactions").all()).toHaveLength(998);
  expect(client.prepare("SELECT * FROM oidc_handoffs").all()).toHaveLength(2);
  await request(server).get("/v1/auth/oidc/test/start").expect(429);
  const firstLocation = new URL(z.string().url().parse(completed[0]?.headers["location"]));
  await request(server)
    .post("/v1/auth/oidc/exchange")
    .set("Origin", ORIGIN)
    .set("Cookie", first.cookie)
    .send({ code: firstLocation.searchParams.get("code") })
    .expect(200);
  await request(server).get("/v1/auth/oidc/test/start").expect(302);
  expect(client.prepare("SELECT * FROM oidc_transactions").all()).toHaveLength(999);
  expect(client.prepare("SELECT * FROM oidc_handoffs").all()).toHaveLength(1);
});

it("expires an in-flight reservation without allowing a late callback to create a handoff", async () => {
  const context = await setup();
  const flow = await start(context);
  const client = getDatabase(context.app).$client;
  seedTransactions(context.app, 999, context.time.nowMs + 300_000);
  const gate = createOidcTokenGate(1);
  context.provider.control.tokenGate = gate;
  const server = httpServerOf(context.app);

  const callback = request(server)
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .then((response: SupertestResponsePort) => response);

  try {
    await gate.ready;
    context.time.nowMs += 300_000;
    await request(server).get("/v1/auth/oidc/test/start").expect(302);
    expect(client.prepare("SELECT * FROM oidc_transactions").all()).toHaveLength(901);
  } finally {
    gate.release();
    context.provider.control.tokenGate = undefined;
    await callback;
  }

  expect((await callback).status).toBe(401);
  expect(client.prepare("SELECT * FROM oidc_handoffs").all()).toHaveLength(0);
  expect(client.prepare("SELECT * FROM sessions").all()).toHaveLength(0);
});

it("commits bounded expired cleanup despite rejected starts and recovers legacy overcapacity", async () => {
  const context = await setup();
  const client = getDatabase(context.app).$client;
  const userId = crypto.randomUUID();
  client.prepare("INSERT INTO users VALUES (?, 'legacy@example.com', 0, NULL)").run(userId);

  const transaction = client.prepare(
    "INSERT INTO oidc_transactions (state_hash, binding_hash, nonce, verifier, expires_at) VALUES (?, 'binding', 'nonce', 'verifier', 0)",
  );

  const handoff = client.prepare("INSERT INTO oidc_handoffs VALUES (?, 'binding', ?, 0)");
  client.transaction(() => {
    for (let index = 0; index < 1000; index += 1) transaction.run(`expired-${index}`);

    for (let index = 0; index < 250; index += 1) handoff.run(`expired-${index}`, userId);
  })();
  const server = httpServerOf(context.app);
  await request(server).get("/v1/auth/oidc/test/start").expect(429);
  expect(client.prepare("SELECT * FROM oidc_transactions").all()).toHaveLength(900);
  expect(client.prepare("SELECT * FROM oidc_handoffs").all()).toHaveLength(150);
  await request(server).get("/v1/auth/oidc/test/start").expect(302);
  expect(client.prepare("SELECT * FROM oidc_transactions").all()).toHaveLength(801);
  expect(client.prepare("SELECT * FROM oidc_handoffs").all()).toHaveLength(50);
  await request(server).get("/v1/auth/oidc/test/start").expect(302);
  expect(client.prepare("SELECT * FROM oidc_transactions").all()).toHaveLength(702);
  expect(client.prepare("SELECT * FROM oidc_handoffs").all()).toHaveLength(0);
});
