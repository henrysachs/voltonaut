import request from "supertest";
import { expect, it } from "vitest";
import { z } from "zod";
import { createOidcTokenGate as createProtocolGate } from "../testing/oidc-token-gate.spec.js";
import {
  bearer,
  bodyOf,
  getDatabase,
  httpServerOf,
  createTestApp,
  loginTestUser,
} from "../testing/test-app.spec.js";
import {
  setupStrava,
  startStrava,
  pendingStrava,
  confirmStrava,
  disconnectStrava,
  STRAVA_ORIGIN,
} from "../testing/strava-flow.spec.js";

it("keeps default-disabled authenticated status honest and rejects grant start", async () => {
  const { app, mail } = await createTestApp();

  try {
    const user = await loginTestUser(app, mail, "disabled@example.com");

    const status = await request(httpServerOf(app))
      .get("/v1/strava/connection")
      .set(bearer(user.sessionToken))
      .expect(200);

    expect(bodyOf(status)).toEqual({ status: "disabled" });
    await request(httpServerOf(app))
      .post("/v1/strava/connect-start")
      .set(bearer(user.sessionToken))
      .set("Origin", "http://localhost:5173")
      .send({ action: "connect" })
      .expect(404);
  } finally {
    await app.close();
  }
});

it("rolls confirmation consumption back when the database write fails", async () => {
  const context = await setupStrava();
  const flow = await pendingStrava(context);
  const db = getDatabase(context.app);
  db.$client.exec(
    "CREATE TRIGGER reject_confirm BEFORE UPDATE ON strava_connections WHEN NEW.status = 'connected' BEGIN SELECT RAISE(ABORT, 'local test failure'); END",
  );
  await confirmStrava(context, flow.code, flow.cookie).expect(500);
  expect(db.$client.prepare("SELECT status FROM strava_connections").get()).toEqual({
    status: "pending",
  });
  db.$client.exec("DROP TRIGGER reject_confirm");
  await confirmStrava(context, flow.code, flow.cookie).expect(200);
});

it("keeps no partial pending connection after an insertion failure and consumes the callback", async () => {
  const context = await setupStrava();
  const flow = await startStrava(context);
  const db = getDatabase(context.app);
  db.$client.exec(
    "CREATE TRIGGER reject_pending BEFORE INSERT ON strava_connections BEGIN SELECT RAISE(ABORT, 'local test failure'); END",
  );
  await request(httpServerOf(context.app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(500);
  expect(db.$client.prepare("SELECT * FROM strava_connections").all()).toEqual([]);
  expect(db.$client.prepare("SELECT * FROM strava_transactions").all()).toEqual([]);
  await request(httpServerOf(context.app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(401);
  expect(context.provider.control.tokenCalls).toBe(1);
});

it("blocks unusable ciphertext without deleting the only revocation credential", async () => {
  const context = await setupStrava();
  const flow = await pendingStrava(context);
  const db = getDatabase(context.app);
  db.$client.exec("UPDATE strava_connections SET encrypted_tokens = '{}'");
  await confirmStrava(context, flow.code, flow.cookie).expect(401);

  const status = await request(httpServerOf(context.app))
    .get("/v1/strava/connection")
    .set(bearer(context.owner.sessionToken))
    .expect(200);

  expect(bodyOf(status)).toEqual({ status: "credentials_unavailable" });
  expect(bodyOf(await disconnectStrava(context).expect(200))).toEqual({
    status: "revocation_pending",
  });
  expect(db.$client.prepare("SELECT encrypted_tokens FROM strava_connections").get()).toEqual({
    encrypted_tokens: "{}",
  });
  expect(context.provider.control.revokeCalls).toBe(0);
});

it("reserves capacity while callback HTTP is in flight and disconnect prevents late activation", async () => {
  const context = await setupStrava();
  const flow = await startStrava(context);
  const gate = createProtocolGate(1);
  context.provider.control.tokenGate = gate;

  const pending = request(httpServerOf(context.app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .then((response: { readonly status: number }) => response.status);

  await gate.ready;
  const db = getDatabase(context.app);
  const insertUser = db.$client.prepare("INSERT INTO users VALUES (?, ?, 0, NULL)");

  const insertTransaction = db.$client.prepare(
    "INSERT INTO strava_transactions VALUES (?, ?, 'binding', ?, NULL)",
  );

  db.transaction(() => {
    for (let index = 0; index < 999; index += 1) {
      insertUser.run(`capacity-${index}`, `capacity-${index}@example.com`);
      insertTransaction.run(`capacity-${index}`, `capacity-${index}`, context.time.nowMs + 600_000);
    }
  });
  await request(httpServerOf(context.app))
    .post("/v1/strava/connect-start")
    .set(bearer(context.other.sessionToken))
    .set("Origin", STRAVA_ORIGIN)
    .send({ action: "connect" })
    .expect(429);
  expect(bodyOf(await disconnectStrava(context).expect(200))).toEqual({ status: "disconnected" });
  gate.release();
  expect(await pending).toBe(401);
  expect(db.$client.prepare("SELECT * FROM strava_connections").all()).toEqual([]);
});

it("commits bounded cleanup even when capacity still rejects the new start", async () => {
  const context = await setupStrava();
  const db = getDatabase(context.app);
  db.$client.exec(
    "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1100) INSERT INTO users SELECT 'load-'||i, 'load-'||i||'@example.com', 0, NULL FROM n",
  );
  db.$client
    .prepare(
      "INSERT INTO strava_transactions SELECT id, id, 'binding', CASE WHEN rowid<=102 THEN ? ELSE ? END, NULL FROM users WHERE id LIKE 'load-%'",
    )
    .run(context.time.nowMs - 1, context.time.nowMs + 600_000);
  await request(httpServerOf(context.app))
    .post("/v1/strava/connect-start")
    .set(bearer(context.owner.sessionToken))
    .set("Origin", STRAVA_ORIGIN)
    .send({ action: "connect" })
    .expect(429);
  expect(
    z
      .object({ total: z.number() })
      .parse(db.$client.prepare("SELECT COUNT(*) AS total FROM strava_transactions").get()).total,
  ).toBe(1000);
});

it("serializes concurrent revocation requests before a successful retry", async () => {
  const context = await setupStrava();
  const flow = await pendingStrava(context);
  await confirmStrava(context, flow.code, flow.cookie).expect(200);
  context.provider.control.revokeFault = "stall";
  const replies = await Promise.all([0, 1].map(() => disconnectStrava(context).expect(200)));
  expect(replies.map((reply: Parameters<typeof bodyOf>[0]) => bodyOf(reply))).toEqual([
    { status: "revocation_pending" },
    { status: "revocation_pending" },
  ]);
  expect(context.provider.control.revokeCalls).toBe(1);
  context.provider.control.revokeFault = "none";
  expect(bodyOf(await disconnectStrava(context).expect(200))).toEqual({ status: "disconnected" });
});
