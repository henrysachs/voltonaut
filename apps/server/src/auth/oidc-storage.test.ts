import request from "supertest";
import { expect, it } from "vitest";
import { ErrorEnvelopeSchema } from "@voltonaut/shared";
import { setup, start, handoff, login, noSessions, ORIGIN } from "../testing/oidc-flow.spec.js";
import { getDatabase, httpServerOf, bodyOf, bearer } from "../testing/test-app.spec.js";
import { hashToken } from "./tokens.js";

it("keeps existing legacy owner and session on an OIDC email collision", async () => {
  const context = await setup();
  const db = getDatabase(context.app);
  const userId = crypto.randomUUID();
  const sessionToken = "legacy-session";
  db.$client
    .prepare(
      "INSERT INTO users (id, email, created_at, deleted_at) VALUES (?, 'rider@example.com', 0, NULL)",
    )
    .run(userId);
  db.$client
    .prepare("INSERT INTO sessions VALUES (?, ?, 0, 0, ?, NULL)")
    .run(hashToken(sessionToken), userId, context.time.nowMs + 86_400_000);
  const flow = await start(context);

  const failed = await request(httpServerOf(context.app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(302);

  expect(new URL(String(failed.headers["location"])).searchParams.get("error")).toBe(
    "identity_conflict",
  );
  expect(db.$client.prepare("SELECT id FROM users").all()).toEqual([{ id: userId }]);
  expect(db.$client.prepare("SELECT * FROM auth_identities").all()).toEqual([]);
  await request(httpServerOf(context.app)).get("/v1/me").set(bearer(sessionToken)).expect(200);
});

it("enforces unique issuer/subject and foreign keys independently of application code", async () => {
  const context = await setup();
  const session = await login(context);
  const client = getDatabase(context.app).$client;
  const otherId = crypto.randomUUID();
  client
    .prepare(
      "INSERT INTO users (id, email, created_at, deleted_at) VALUES (?, 'other@example.com', 0, NULL)",
    )
    .run(otherId);
  expect(() =>
    client
      .prepare("INSERT INTO auth_identities VALUES (?, 'local-test-subject', ?)")
      .run(context.provider.issuer, otherId),
  ).toThrow("UNIQUE");
  expect(() =>
    client
      .prepare("INSERT INTO auth_identities VALUES ('https://other.example', 'sub', 'missing')")
      .run(),
  ).toThrow("FOREIGN KEY");
  expect(client.prepare("SELECT user_id FROM auth_identities").all()).toEqual([
    { user_id: session.user.id },
  ]);
});

it("never recreates a deleted identity account or issues a session for a deleted handoff owner", async () => {
  const context = await setup();
  const flow = await handoff(context);
  const db = getDatabase(context.app);
  db.$client.prepare("UPDATE users SET deleted_at = ?").run(context.time.nowMs);
  await request(httpServerOf(context.app))
    .post("/v1/auth/oidc/exchange")
    .set("Origin", ORIGIN)
    .set("Cookie", flow.cookie)
    .send({ code: flow.code })
    .expect(401);
  const next = await start(context);
  await request(httpServerOf(context.app))
    .get(next.callback)
    .set("Cookie", next.cookie)
    .expect(401);
  expect(db.$client.prepare("SELECT * FROM users").all()).toHaveLength(1);
  noSessions(context);
});

it("rolls handoff consumption back on local session insertion failure without partial sessions", async () => {
  const context = await setup();
  const flow = await handoff(context);
  const db = getDatabase(context.app);
  db.$client.exec(
    "CREATE TRIGGER reject_oidc_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  const server = httpServerOf(context.app);
  await request(server)
    .post("/v1/auth/oidc/exchange")
    .set("Origin", ORIGIN)
    .set("Cookie", flow.cookie)
    .send({ code: flow.code })
    .expect(500);
  noSessions(context);
  db.$client.exec("DROP TRIGGER reject_oidc_session");
  await request(server)
    .post("/v1/auth/oidc/exchange")
    .set("Origin", ORIGIN)
    .set("Cookie", flow.cookie)
    .send({ code: flow.code })
    .expect(200);
  await request(server)
    .post("/v1/auth/oidc/exchange")
    .set("Origin", ORIGIN)
    .set("Cookie", flow.cookie)
    .send({ code: flow.code })
    .expect(401);
  expect(db.$client.prepare("SELECT * FROM sessions").all()).toHaveLength(1);
});

it("cleans expired artifacts in bounded batches and caps outstanding anonymous artifacts", async () => {
  const context = await setup();
  const client = getDatabase(context.app).$client;

  const insert = client.prepare(
    "INSERT INTO oidc_transactions (state_hash, binding_hash, nonce, verifier, expires_at) VALUES (?, 'binding', 'nonce', 'verifier', ?)",
  );

  const seed = client.transaction(() => {
    for (let index = 0; index < 250; index += 1) insert.run(`expired-${index}`, 0);
  });

  seed();
  await start(context);
  expect(client.prepare("SELECT * FROM oidc_transactions WHERE expires_at = 0").all()).toHaveLength(
    150,
  );

  const fill = client.transaction(() => {
    for (let index = 0; index < 1000; index += 1)
      insert.run(`active-${index}`, context.time.nowMs + 300_000);
  });

  fill();
  await request(httpServerOf(context.app)).get("/v1/auth/oidc/test/start").expect(429);
  expect(context.provider.control.discoveryCalls).toBe(1);
  noSessions(context);
});

it("rate limits anonymous starts before adding database rows", async () => {
  const context = await setup();
  const server = httpServerOf(context.app);

  await Promise.all(
    Array.from({ length: 100 }, () => request(server).get("/v1/auth/oidc/test/start").expect(302)),
  );

  const response = await request(server).get("/v1/auth/oidc/test/start").expect(429);
  expect(ErrorEnvelopeSchema.parse(bodyOf(response)).error.code).toBe("rate_limited");
  expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  expect(
    getDatabase(context.app).$client.prepare("SELECT * FROM oidc_transactions").all(),
  ).toHaveLength(100);
});
