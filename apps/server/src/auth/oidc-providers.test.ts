import request from "supertest";
import { expect, it } from "vitest";
import { AuthConfigResponseSchema, ErrorEnvelopeSchema } from "@voltonaut/shared";
import { bodyOf, getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import {
  PROVIDERS_ORIGIN,
  beginLogin,
  finishLogin,
  loginVia,
  setIdentity,
  setupProviders,
} from "../testing/oidc-providers.spec.js";

it("lists both providers publicly without secrets or issuers", async () => {
  const context = await setupProviders();
  const response = await request(httpServerOf(context.app)).get("/v1/auth/config").expect(200);

  expect(AuthConfigResponseSchema.parse(bodyOf(response))).toEqual({
    mode: "oidc",
    providers: [
      { id: "cloudflare", displayName: "Cloudflare Access" },
      { id: "authentik", displayName: "authentik" },
    ],
  });
  expect(JSON.stringify(bodyOf(response))).not.toMatch(/secret|issuer|127\.0\.0\.1/u);
});

it("logs in through an authentik-style issuer with a trailing slash path", async () => {
  const context = await setupProviders();
  expect(context.authentik.issuer.endsWith("/")).toBe(true);
  setIdentity(context.authentik, "hashed-user-id", "authentik@example.com");
  const session = await loginVia(context.app, "authentik");

  expect(session.user.email).toBe("authentik@example.com");
  expect(context.authentik.control.discoveryCalls).toBe(1);
  expect(context.cloudflare.control.discoveryCalls).toBe(0);
});

it("keeps the same subject at two providers as two separate identities and accounts", async () => {
  const context = await setupProviders();
  setIdentity(context.cloudflare, "same-sub", "cf@example.com");
  setIdentity(context.authentik, "same-sub", "ak@example.com");
  const first = await loginVia(context.app, "cloudflare");
  const second = await loginVia(context.app, "authentik");
  expect(second.user.id).not.toBe(first.user.id);

  const identities = getDatabase(context.app)
    .$client.prepare("SELECT issuer, subject FROM auth_identities")
    .all();

  expect(identities).toHaveLength(2);
  expect((await loginVia(context.app, "cloudflare")).user.id).toBe(first.user.id);
});

it("rejects a callback of provider A that completes the transaction of provider B", async () => {
  const context = await setupProviders();
  const flow = await beginLogin(context.app, "cloudflare");
  const swapped = flow.callback.replace("/oidc/cloudflare/", "/oidc/authentik/");
  expect(swapped).not.toBe(flow.callback);

  const failed = await request(httpServerOf(context.app))
    .get(swapped)
    .set("Cookie", flow.cookie)
    .expect(401);

  expect(ErrorEnvelopeSchema.parse(bodyOf(failed)).error.code).toBe("invalid_oidc_login");
  expect(context.authentik.control.tokenCalls).toBe(0);
  expect(context.cloudflare.control.tokenCalls).toBe(0);
  expect(getDatabase(context.app).$client.prepare("SELECT * FROM users").all()).toEqual([]);
});

it("returns 404 for unknown providers", async () => {
  const context = await setupProviders();
  const server = httpServerOf(context.app);
  const start = await request(server).get("/v1/auth/oidc/unknown/start");
  const callback = await request(server).get("/v1/auth/oidc/unknown/callback?state=x");

  expect([start.status, callback.status]).toEqual([404, 404]);
});

it.each([
  ["false", false],
  ["missing", undefined],
])("creates no user, identity or session when email_verified is %s", async (_label, value) => {
  const context = await setupProviders();
  context.authentik.control.emailVerified = value;
  const location = await finishLogin(context.app, await beginLogin(context.app, "authentik"));

  expect(`${location.origin}${location.pathname}`).toBe(`${PROVIDERS_ORIGIN}/auth/finish`);
  expect([...location.searchParams.entries()]).toEqual([["error", "email_not_verified"]]);
  const db = getDatabase(context.app).$client;

  for (const table of ["users", "auth_identities", "sessions", "oidc_handoffs"])
    expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
});

it("accepts unverified email only for a provider that explicitly opts out", async () => {
  const context = await setupProviders({ OIDC_AUTHENTIK_REQUIRE_EMAIL_VERIFIED: "false" });
  context.authentik.control.emailVerified = false;
  context.cloudflare.control.emailVerified = false;
  await loginVia(context.app, "authentik");
  const location = await finishLogin(context.app, await beginLogin(context.app, "cloudflare"));

  expect([...location.searchParams.keys()]).toEqual(["error"]);
});

it("keeps health and the other provider working while one discovery fails", async () => {
  const context = await setupProviders();
  const server = httpServerOf(context.app);
  context.authentik.control.failDiscovery = true;
  await request(server).get("/healthz").expect(200);
  const failed = await request(server).get("/v1/auth/oidc/authentik/start").expect(503);

  expect(JSON.stringify(bodyOf(failed))).not.toContain("private-provider-diagnostic");
  await request(server).get("/healthz").expect(200);
  setIdentity(context.cloudflare, "cf-sub", "cf@example.com");
  expect((await loginVia(context.app, "cloudflare")).user.email).toBe("cf@example.com");
  context.authentik.control.failDiscovery = false;
  setIdentity(context.authentik, "ak-sub", "ak@example.com");
  expect((await loginVia(context.app, "authentik")).user.email).toBe("ak@example.com");
});

it("reports an identity conflict across providers as finish error without linking", async () => {
  const context = await setupProviders();
  setIdentity(context.cloudflare, "cf-sub", "shared@example.com");
  setIdentity(context.authentik, "ak-sub", "shared@example.com");
  await loginVia(context.app, "cloudflare");
  const location = await finishLogin(context.app, await beginLogin(context.app, "authentik"));

  expect([...location.searchParams.entries()]).toEqual([["error", "identity_conflict"]]);
  const identities = getDatabase(context.app).$client.prepare("SELECT * FROM auth_identities");
  expect(identities.all()).toHaveLength(1);
});
