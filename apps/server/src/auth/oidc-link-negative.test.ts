import request from "supertest";
import { expect, it } from "vitest";
import { z } from "zod";
import { ErrorEnvelopeSchema } from "@voltonaut/shared";
import { bodyOf, getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import type { SupertestResponsePort } from "../testing/test-app.spec.js";
import {
  PROVIDERS_ORIGIN,
  beginLogin,
  finishLogin,
  loginVia,
  setIdentity,
  setupProviders,
} from "../testing/oidc-providers.spec.js";
import {
  beginLink,
  completeLink,
  identitiesOf,
  linkCode,
  linkProvider,
} from "../testing/oidc-link.spec.js";

function errorCode(response: SupertestResponsePort): string {
  return ErrorEnvelopeSchema.parse(bodyOf(response)).error.code;
}

it("never moves a link to another account after an account switch", async () => {
  const { app, cloudflare, authentik } = await setupProviders();
  setIdentity(cloudflare, "cf-x", "x@example.com");
  const x = await loginVia(app, "cloudflare");
  setIdentity(authentik, "ak-x", "x-ak@example.com");
  const flow = await beginLink(app, x.sessionToken, "authentik");
  const code = await linkCode(app, flow);
  setIdentity(cloudflare, "cf-y", "y@example.com");
  const y = await loginVia(app, "cloudflare");
  const switched = await completeLink(app, { ...flow, code, sessionToken: y.sessionToken });

  expect(switched.status).toBe(401);
  expect(errorCode(switched)).toBe("invalid_oidc_login");

  // The code is used up by that attempt: the original account cannot replay it either.
  const replay = await completeLink(app, { ...flow, code, sessionToken: x.sessionToken });

  expect(replay.status).toBe(401);
  expect(await identitiesOf(app, x.sessionToken)).toHaveLength(1);
  expect(await identitiesOf(app, y.sessionToken)).toHaveLength(1);
});

it("refuses an identity that already belongs to another account and merges nothing", async () => {
  const { app, cloudflare, authentik } = await setupProviders();
  setIdentity(authentik, "ak-owner", "owner@example.com");
  const owner = await loginVia(app, "authentik");
  setIdentity(cloudflare, "cf-other", "other@example.com");
  const other = await loginVia(app, "cloudflare");
  const taken = await linkProvider(app, other.sessionToken, "authentik");

  expect(taken.status).toBe(409);
  expect(errorCode(taken)).toBe("identity_in_use");
  expect((await loginVia(app, "authentik")).user.id).toBe(owner.user.id);
  expect(await identitiesOf(app, other.sessionToken)).toEqual([
    { providerId: "cloudflare", displayName: "Cloudflare Access" },
  ]);
  expect(getDatabase(app).$client.prepare("SELECT * FROM users").all()).toHaveLength(2);
});

it("rejects a link code from another browser and a reused link code", async () => {
  const { app, cloudflare, authentik } = await setupProviders();
  setIdentity(cloudflare, "cf-rider", "rider@example.com");
  const session = await loginVia(app, "cloudflare");
  setIdentity(authentik, "ak-rider", "rider-ak@example.com");
  const flow = await beginLink(app, session.sessionToken, "authentik");
  const code = await linkCode(app, flow);
  const foreignCookie = flow.cookie.replace(/=.*$/u, `=${"b".repeat(43)}`);
  const completion = { cookie: flow.cookie, code, sessionToken: session.sessionToken };
  const foreign = await completeLink(app, { ...completion, cookie: foreignCookie });

  expect(foreign.status).toBe(401);

  // Another browser cannot spend the code; the right browser and session still can, once.
  expect((await completeLink(app, completion)).status).toBe(200);
  expect((await completeLink(app, completion)).status).toBe(401);
});

it("binds the link callback to its provider and keeps link codes out of login", async () => {
  const { app, cloudflare, authentik } = await setupProviders();
  setIdentity(cloudflare, "cf-rider", "rider@example.com");
  const session = await loginVia(app, "cloudflare");
  setIdentity(authentik, "ak-rider", "rider-ak@example.com");
  const flow = await beginLink(app, session.sessionToken, "authentik");
  const swapped = flow.callback.replace("/oidc/authentik/", "/oidc/cloudflare/");

  await request(httpServerOf(app)).get(swapped).set("Cookie", flow.cookie).expect(401);

  const retry = await beginLink(app, session.sessionToken, "authentik");
  const code = await linkCode(app, retry);

  const asLogin = await request(httpServerOf(app))
    .post("/v1/auth/oidc/exchange")
    .set("Origin", PROVIDERS_ORIGIN)
    .set("Cookie", retry.cookie)
    .send({ code });

  expect(asLogin.status).toBe(401);
  expect(getDatabase(app).$client.prepare("SELECT * FROM auth_identities").all()).toHaveLength(1);
});

it("does not accept a login handoff as a link completion", async () => {
  const { app, cloudflare } = await setupProviders();
  setIdentity(cloudflare, "cf-rider", "rider@example.com");
  const session = await loginVia(app, "cloudflare");
  const flow = await beginLogin(app, "cloudflare");
  const finish = await finishLogin(app, flow);
  const code = z.string().parse(finish.searchParams.get("code"));
  const asLink = await completeLink(app, { ...flow, code, sessionToken: session.sessionToken });

  expect(asLink.status).toBe(401);
  expect(errorCode(asLink)).toBe("invalid_oidc_login");
});
