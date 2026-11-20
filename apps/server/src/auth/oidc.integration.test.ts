import request from "supertest";
import { expect, it } from "vitest";
import { AuthConfigResponseSchema, MeResponseSchema, ErrorEnvelopeSchema } from "@voltonaut/shared";
import type { TokenFault } from "../testing/oidc-provider.spec.js";
import { getDatabase, httpServerOf, bodyOf, bearer } from "../testing/test-app.spec.js";
import { setup, start, handoff, login, noSessions, ORIGIN } from "../testing/oidc-flow.spec.js";
import { OIDC_HANDOFF_TTL_MS, OIDC_TRANSACTION_TTL_MS } from "./oidc.service.js";

it("completes signed HTTP OIDC without advertised PKCE metadata or mail and reuses stable identity", async () => {
  const context = await setup();
  const server = httpServerOf(context.app);
  const capability = await request(server).get("/v1/auth/config").expect(200);
  expect(AuthConfigResponseSchema.parse(bodyOf(capability))).toEqual({ mode: "oidc" });
  const first = await login(context);
  context.provider.control.email = "changed@example.com";
  const second = await login(context);
  expect(second.user).toEqual(first.user);
  expect(context.provider.control.jwksCalls).toBeGreaterThan(0);
  expect(context.mail.readSent()).toEqual([]);
  const me = await request(server).get("/v1/me").set(bearer(first.sessionToken)).expect(200);
  expect(MeResponseSchema.parse(bodyOf(me))).toEqual({ user: first.user });
  await request(server).post("/v1/auth/logout").set(bearer(first.sessionToken)).expect(204);
  await request(server).get("/v1/me").set(bearer(first.sessionToken)).expect(401);
  context.time.nowMs += 30 * 86_400_000;
  await request(server).get("/v1/me").set(bearer(second.sessionToken)).expect(401);
  await request(server)
    .post("/v1/auth/magic-link")
    .send({ email: "rider@example.com" })
    .expect(404);
  await request(server).post("/v1/auth/session").send({ loginToken: "legacy" }).expect(404);
});

it.each<TokenFault>(["nonce", "audience", "issuer", "signature", "expired", "missing-id-token"])(
  "rejects real signed token fault %s without sessions or handoffs",
  async (fault) => {
    const context = await setup();
    context.provider.control.fault = fault;
    const flow = await start(context);

    const failed = await request(httpServerOf(context.app))
      .get(flow.callback)
      .set("Cookie", flow.cookie)
      .expect(401);

    expect(ErrorEnvelopeSchema.parse(bodyOf(failed)).error.code).toBe("invalid_oidc_login");
    expect(failed.text).not.toContain("provider-access-private");
    noSessions(context);
    expect(getDatabase(context.app).$client.prepare("SELECT * FROM oidc_handoffs").all()).toEqual(
      [],
    );
  },
);

it("rejects foreign browser, missing/duplicate cookie and wrong state before code exchange", async () => {
  const context = await setup();
  const flow = await start(context);
  const server = httpServerOf(context.app);
  await request(server).get(flow.callback).expect(401);
  await request(server)
    .get(flow.callback)
    .set("Cookie", `voltonaut-oidc=${"a".repeat(43)}`)
    .expect(401);
  await request(server)
    .get(flow.callback)
    .set("Cookie", `${flow.cookie}; ${flow.cookie}`)
    .expect(401);
  const wrong = new URL(flow.callback, "http://localhost");
  wrong.searchParams.set("state", "b".repeat(43));
  await request(server)
    .get(`${wrong.pathname}${wrong.search}`)
    .set("Cookie", flow.cookie)
    .expect(401);
  await request(server)
    .get(`${flow.callback}&state=${"b".repeat(43)}`)
    .set("Cookie", flow.cookie)
    .expect(401);
  expect(context.provider.control.tokenCalls).toBe(0);
  noSessions(context);
  await request(server).get(flow.callback).set("Cookie", flow.cookie).expect(302);
});

it("claims a transaction once before competing callbacks and rejects callback replay", async () => {
  const context = await setup();
  const flow = await start(context);
  const server = httpServerOf(context.app);

  const responses = await Promise.all(
    [0, 1].map(() => request(server).get(flow.callback).set("Cookie", flow.cookie)),
  );

  expect(
    responses
      .map((response: { readonly status: number }) => response.status)
      .toSorted((left, right) => left - right),
  ).toEqual([302, 401]);
  expect(context.provider.control.tokenCalls).toBe(1);
  await request(server).get(flow.callback).set("Cookie", flow.cookie).expect(401);
  noSessions(context);
});

it("rejects wrong verifier and permanently consumes the transaction", async () => {
  const context = await setup();
  const flow = await start(context);
  const db = getDatabase(context.app);
  const callback = new URL(flow.callback, "http://localhost");

  db.$client.prepare("UPDATE oidc_transactions SET verifier = ?").run("a".repeat(43));
  const server = httpServerOf(context.app);
  await request(server)
    .get(`${callback.pathname}${callback.search}`)
    .set("Cookie", flow.cookie)
    .expect(401);
  await request(server).get(flow.callback).set("Cookie", flow.cookie).expect(401);
  expect(context.provider.control.tokenCalls).toBe(1);
  noSessions(context);
});

it("rejects wrong code and permanently consumes the transaction", async () => {
  const context = await setup();
  const flow = await start(context);
  const callback = new URL(flow.callback, "http://localhost");
  callback.searchParams.set("code", "wrong-code");
  const server = httpServerOf(context.app);
  await request(server)
    .get(`${callback.pathname}${callback.search}`)
    .set("Cookie", flow.cookie)
    .expect(401);
  await request(server).get(flow.callback).set("Cookie", flow.cookie).expect(401);
  expect(context.provider.control.tokenCalls).toBe(1);
  noSessions(context);
});

it("requires original browser and origin and consumes the handoff exactly once under contention", async () => {
  const context = await setup();
  const flow = await handoff(context);
  const server = httpServerOf(context.app);
  noSessions(context);
  await request(server)
    .post("/v1/auth/oidc/exchange")
    .set("Origin", ORIGIN)
    .send({ code: flow.code })
    .expect(401);
  await request(server)
    .post("/v1/auth/oidc/exchange")
    .set("Origin", "https://foreign.example")
    .set("Cookie", flow.cookie)
    .send({ code: flow.code })
    .expect(401);
  await request(server)
    .post("/v1/auth/oidc/exchange")
    .set("Origin", ORIGIN)
    .set("Cookie", `voltonaut-oidc=${"a".repeat(43)}`)
    .send({ code: flow.code })
    .expect(401);

  const responses = await Promise.all(
    [0, 1].map(() =>
      request(server)
        .post("/v1/auth/oidc/exchange")
        .set("Origin", ORIGIN)
        .set("Cookie", flow.cookie)
        .send({ code: flow.code }),
    ),
  );

  expect(
    responses
      .map((response: { readonly status: number }) => response.status)
      .toSorted((left, right) => left - right),
  ).toEqual([200, 401]);
  expect(getDatabase(context.app).$client.prepare("SELECT * FROM sessions").all()).toHaveLength(1);
});

it("expires transactions and handoffs at their exact business-clock boundaries", async () => {
  const context = await setup();
  const expired = await start(context);
  context.time.nowMs += OIDC_TRANSACTION_TTL_MS;
  await request(httpServerOf(context.app))
    .get(expired.callback)
    .set("Cookie", expired.cookie)
    .expect(401);
  expect(context.provider.control.tokenCalls).toBe(0);
  const flow = await handoff(context);
  context.time.nowMs += OIDC_HANDOFF_TTL_MS;
  await request(httpServerOf(context.app))
    .post("/v1/auth/oidc/exchange")
    .set("Origin", ORIGIN)
    .set("Cookie", flow.cookie)
    .send({ code: flow.code })
    .expect(401);
  noSessions(context);
});

it("preserves existing account and sessions on email collision without auto-linking", async () => {
  const context = await setup();
  const original = await login(context);
  context.provider.control.subject = "another-subject";
  const flow = await start(context);

  const failed = await request(httpServerOf(context.app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(409);

  expect(ErrorEnvelopeSchema.parse(bodyOf(failed)).error.code).toBe("identity_conflict");
  const db = getDatabase(context.app);
  expect(db.$client.prepare("SELECT id FROM users").all()).toEqual([{ id: original.user.id }]);
  expect(db.$client.prepare("SELECT * FROM auth_identities").all()).toHaveLength(1);
  await request(httpServerOf(context.app))
    .get("/v1/me")
    .set(bearer(original.sessionToken))
    .expect(200);
  context.provider.control.subject = "local-test-subject";
  context.provider.control.email = "other-owner@example.com";
  db.$client
    .prepare("INSERT INTO users VALUES (?, ?, 0, NULL)")
    .run(crypto.randomUUID(), "other-owner@example.com");
  expect((await login(context)).user.id).toBe(original.user.id);
  expect(db.$client.prepare("SELECT * FROM users").all()).toHaveLength(2);
});

it.each(["failure", "timeout"])(
  "fails closed on provider %s and never exposes provider diagnostics",
  async (fault) => {
    const context = await setup();
    context.provider.control.failToken = fault === "failure";
    context.provider.control.stallToken = fault === "timeout";
    const flow = await start(context);

    const failed = await request(httpServerOf(context.app))
      .get(flow.callback)
      .set("Cookie", flow.cookie)
      .expect(401);

    expect(failed.text).not.toContain("private-provider-diagnostic");
    await request(httpServerOf(context.app))
      .get(flow.callback)
      .set("Cookie", flow.cookie)
      .expect(401);
    noSessions(context);
  },
);

it("recovers discovery after failure and rejects discovered remote HTTP endpoints", async () => {
  const context = await setup();
  context.provider.control.failDiscovery = true;
  const server = httpServerOf(context.app);
  const failed = await request(server).get("/v1/auth/oidc/start").expect(503);
  expect(failed.text).not.toContain("private-provider-diagnostic");
  expect(getDatabase(context.app).$client.prepare("SELECT * FROM oidc_transactions").all()).toEqual(
    [],
  );
  await request(server).get("/healthz").expect(200);
  context.provider.control.failDiscovery = false;
  context.provider.control.insecureEndpoint = true;
  const flow = await start(context);
  await request(server).get(flow.callback).set("Cookie", flow.cookie).expect(401);
  expect(context.provider.control.tokenCalls).toBe(0);
  noSessions(context);
});

it("sets host-bound cookies, fixed redirects, exact credential CORS and rejects arbitrary start input", async () => {
  const context = await setup();
  const flow = await start(context);
  expect(flow.setCookie).toContain("HttpOnly; SameSite=Lax");
  expect(flow.setCookie).not.toContain("Domain=");
  const server = httpServerOf(context.app);
  await request(server).get("/v1/auth/oidc/start?returnTo=https://evil.example").expect(422);

  const preflight = await request(server)
    .options("/v1/auth/oidc/exchange")
    .set("Origin", ORIGIN)
    .set("Access-Control-Request-Method", "POST")
    .expect(204);

  expect(preflight.headers["access-control-allow-origin"]).toBe(ORIGIN);
  expect(preflight.headers["access-control-allow-credentials"]).toBe("true");

  const foreign = await request(server)
    .get("/v1/auth/config")
    .set("Origin", "https://evil.example")
    .expect(200);

  expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
  expect(foreign.text).not.toContain("test-secret");
  expect(foreign.text).not.toContain(context.provider.issuer);
});
