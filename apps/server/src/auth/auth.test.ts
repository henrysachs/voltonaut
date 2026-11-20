import request from "supertest";
import { afterEach, expect, it } from "vitest";
import { ErrorEnvelopeSchema, SessionResponseSchema } from "@voltonaut/shared";

import { AuthService, LOGIN_TOKEN_TTL_MS } from "./auth.service.js";
import { hashToken } from "./tokens.js";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import type { TestApp, SupertestResponsePort } from "../testing/test-app.spec.js";

const closers: (() => Promise<void>)[] = [];
const DAY_MS = 86_400_000;
let nowMs = 1_800_000_000_000;

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup() {
  nowMs = 1_800_000_000_000;
  const result = await createTestApp({ clock: { nowMs: () => nowMs } });
  closers.push(() => result.app.close());

  return result;
}

function tokenFor(mail: Readonly<TestApp["mail"]>, email: string): string {
  const token = mail.latestTokenFor(email);

  if (token === undefined) {
    throw new Error("test: expected captured token");
  }

  return token;
}

it("registers and reuses an account, normalizes email, and returns uniform empty 204s", async () => {
  const { app, mail } = await setup();
  const first = await loginTestUser(app, mail, "  Rider@Example.com  ");
  const second = await loginTestUser(app, mail, "rider@example.com");
  expect(first.user.id).toBe(second.user.id);
  expect(second.user.email).toBe("rider@example.com");

  const known = await request(httpServerOf(app))
    .post("/v1/auth/magic-link")
    .send({ email: "rider@example.com" })
    .expect(204);

  const fresh = await request(httpServerOf(app))
    .post("/v1/auth/magic-link")
    .send({ email: "new@example.com" })
    .expect(204);

  expect(known.text).toBe("");
  expect(fresh.text).toBe(known.text);
});

it("hashes both token kinds and permits one exchange even for competing HTTP requests", async () => {
  const { app, mail } = await setup();
  const server = httpServerOf(app);
  await request(server).post("/v1/auth/magic-link").send({ email: "race@example.com" }).expect(204);
  const loginToken = tokenFor(mail, "race@example.com");

  const responses = await Promise.all(
    [0, 1].map(() => request(server).post("/v1/auth/session").send({ loginToken })),
  );

  expect(
    responses
      .map((response: SupertestResponsePort) => response.status)
      .toSorted((left, right) => left - right),
  ).toEqual([200, 401]);

  const session = SessionResponseSchema.parse(
    responses.find((response: SupertestResponsePort) => response.status === 200)?.body,
  );

  const db = getDatabase(app);
  expect(db.$client.prepare("SELECT token_hash FROM login_tokens").all()).toEqual([
    { token_hash: hashToken(loginToken) },
  ]);
  expect(db.$client.prepare("SELECT token_hash FROM sessions").all()).toEqual([
    { token_hash: hashToken(session.sessionToken) },
  ]);
  expect(mail.readSent()[0]?.linkUrl).toContain("/#login=");
});

it("rolls token consumption and account creation back if session insertion fails", async () => {
  const { app, mail } = await setup();
  const server = httpServerOf(app);
  await request(server)
    .post("/v1/auth/magic-link")
    .send({ email: "rollback@example.com" })
    .expect(204);
  const loginToken = tokenFor(mail, "rollback@example.com");
  const db = getDatabase(app);
  db.$client.exec(
    "CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  const failed = await request(server).post("/v1/auth/session").send({ loginToken }).expect(500);
  expect(ErrorEnvelopeSchema.parse(bodyOf(failed)).error).toEqual({
    code: "internal_error",
    message: "internal server error",
  });
  expect(db.$client.prepare("SELECT id FROM users").all()).toEqual([]);
  expect(db.$client.prepare("SELECT used_at FROM login_tokens").all()).toEqual([{ used_at: null }]);
  db.$client.exec("DROP TRIGGER reject_session");
  await request(server).post("/v1/auth/session").send({ loginToken }).expect(200);
});

it("rejects expired links exactly at the 15 minute boundary and invalid bodies", async () => {
  const { app, mail } = await setup();
  const server = httpServerOf(app);
  await request(server)
    .post("/v1/auth/magic-link")
    .send({ email: "expiry@example.com" })
    .expect(204);
  nowMs += LOGIN_TOKEN_TTL_MS;

  const response = await request(server)
    .post("/v1/auth/session")
    .send({ loginToken: tokenFor(mail, "expiry@example.com") })
    .expect(401);

  expect(ErrorEnvelopeSchema.parse(bodyOf(response)).error.code).toBe("invalid_login_token");
  await request(server).post("/v1/auth/session").send({ loginToken: "unknown" }).expect(401);

  await Promise.all(
    [{}, { email: "invalid" }].map(async (body: { readonly email?: string }) => {
      const invalid = await request(server).post("/v1/auth/magic-link").send(body).expect(422);
      expect(ErrorEnvelopeSchema.parse(bodyOf(invalid)).error.code).toBe("validation_failed");
    }),
  );

  await request(server).post("/v1/auth/session").send({}).expect(422);
  await request(server)
    .post("/v1/auth/session")
    .set("Content-Type", "application/json")
    .send("{")
    .expect(400);
});

it("protects logout, expires sessions, and revokes a logged-out bearer", async () => {
  const { app, mail } = await setup();
  const server = httpServerOf(app);

  await Promise.all(
    ["", "Basic abc", "Bearer ", "Bearer garbage"].map(async (authorization) => {
      const response = await request(server)
        .post("/v1/auth/logout")
        .set("Authorization", authorization)
        .expect(401);

      expect(ErrorEnvelopeSchema.parse(bodyOf(response)).error.code).toBe("unauthorized");
    }),
  );

  const session = await loginTestUser(app, mail, "logout@example.com");
  await request(server).post("/v1/auth/logout").set(bearer(session.sessionToken)).expect(204);
  await request(server).post("/v1/auth/logout").set(bearer(session.sessionToken)).expect(401);
  const expiring = await loginTestUser(app, mail, "expiry-session@example.com");
  nowMs += 30 * DAY_MS;
  await request(server).post("/v1/auth/logout").set(bearer(expiring.sessionToken)).expect(401);
});

it("slides session expiry and never authenticates deleted accounts", async () => {
  const { app, mail } = await setup();
  const session = await loginTestUser(app, mail, "slide@example.com");
  const auth = app.get<AuthService>(AuthService);
  nowMs += 29 * DAY_MS;
  expect(auth.validateSession(session.sessionToken, nowMs)).toEqual({
    userId: session.user.id,
    email: session.user.email,
    sessionTokenHash: hashToken(session.sessionToken),
  });
  nowMs += 29 * DAY_MS;
  expect(auth.validateSession(session.sessionToken, nowMs)?.userId).toBe(session.user.id);
  expect(auth.validateSession(session.sessionToken, nowMs + 30 * DAY_MS)).toBeUndefined();
  getDatabase(app)
    .$client.prepare("UPDATE users SET deleted_at = ? WHERE id = ?")
    .run(nowMs, session.user.id);
  expect(auth.validateSession(session.sessionToken, nowMs)).toBeUndefined();
  await request(httpServerOf(app))
    .post("/v1/auth/magic-link")
    .send({ email: session.user.email })
    .expect(204);
  await request(httpServerOf(app))
    .post("/v1/auth/session")
    .send({ loginToken: tokenFor(mail, session.user.email) })
    .expect(401);
});

it("returns the authenticated account but exposes no development mailbox or rides", async () => {
  const { app, mail } = await setup();
  const session = await loginTestUser(app, mail, "scope@example.com");

  const responses = await Promise.all(
    ["/v1/me", "/v1/rides", "/dev/mailbox"].map((path) =>
      request(httpServerOf(app)).get(path).set(bearer(session.sessionToken)),
    ),
  );

  expect(responses.map((response: SupertestResponsePort) => response.status)).toEqual([
    200, 404, 404,
  ]);
});
