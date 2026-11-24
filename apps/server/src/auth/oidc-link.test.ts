import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { expect, it } from "vitest";
import { DEFAULT_RIDER_PROFILE, ErrorEnvelopeSchema, ProfileStateSchema } from "@voltonaut/shared";
import { bearer, bodyOf, getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import { loginVia, setIdentity, setupProviders } from "../testing/oidc-providers.spec.js";
import {
  beginLink,
  completeLink,
  identitiesOf,
  linkCode,
  linkProvider,
} from "../testing/oidc-link.spec.js";

const CLOUDFLARE = { providerId: "cloudflare", displayName: "Cloudflare Access" };
const AUTHENTIK = { providerId: "authentik", displayName: "authentik" };

async function profileOf(app: Readonly<INestApplication>, sessionToken: string) {
  const profile = await request(httpServerOf(app))
    .get("/v1/me/profile")
    .set(bearer(sessionToken))
    .expect(200);

  return ProfileStateSchema.parse(bodyOf(profile));
}

/** An account created through Cloudflare whose link to authentik reached the link code. */
async function pendingLink() {
  const context = await setupProviders();
  setIdentity(context.cloudflare, "cf-rider", "rider@example.com");
  setIdentity(context.authentik, "ak-rider", "rider-ak@example.com");
  const session = await loginVia(context.app, "cloudflare");
  const flow = await beginLink(context.app, session.sessionToken, "authentik");
  const code = await linkCode(context.app, flow);

  return { ...context, session, flow, code };
}

it("connects a second provider to the same account and keeps its data", async () => {
  const { app, cloudflare, authentik } = await setupProviders();
  setIdentity(cloudflare, "cf-rider", "rider@example.com");
  const first = await loginVia(app, "cloudflare");

  await request(httpServerOf(app))
    .put("/v1/me/profile")
    .set(bearer(first.sessionToken))
    .send(DEFAULT_RIDER_PROFILE)
    .expect(200);

  // Different provider email, unverified: ownership comes from both fresh logins, not the email.
  setIdentity(authentik, "ak-rider", "other-address@example.org");
  authentik.control.emailVerified = false;
  const linked = await linkProvider(app, first.sessionToken, "authentik");

  expect(linked.status).toBe(200);
  expect(bodyOf(linked)).toEqual({ identities: [CLOUDFLARE, AUTHENTIK] });

  const viaAuthentik = await loginVia(app, "authentik");
  const viaCloudflare = await loginVia(app, "cloudflare");

  expect(viaAuthentik.user).toEqual(first.user);
  expect(viaCloudflare.user).toEqual(first.user);
  expect(await profileOf(app, viaAuthentik.sessionToken)).toEqual(
    await profileOf(app, first.sessionToken),
  );
  expect(await identitiesOf(app, viaAuthentik.sessionToken)).toEqual([CLOUDFLARE, AUTHENTIK]);
  expect(getDatabase(app).$client.prepare("SELECT id FROM users").all()).toEqual([
    { id: first.user.id },
  ]);
});

it("treats linking an already connected identity again as unchanged", async () => {
  const { app, cloudflare } = await setupProviders();
  setIdentity(cloudflare, "cf-rider", "rider@example.com");
  const session = await loginVia(app, "cloudflare");
  const again = await linkProvider(app, session.sessionToken, "cloudflare");

  expect(again.status).toBe(200);
  expect(await identitiesOf(app, session.sessionToken)).toEqual([CLOUDFLARE]);
});

it("requires a signed-in session and the canonical origin to start a link", async () => {
  const { app } = await setupProviders();
  const server = httpServerOf(app);
  const anonymous = await request(server).post("/v1/auth/oidc/authentik/link").expect(401);
  const session = await loginVia(app, "cloudflare");

  const foreign = await request(server)
    .post("/v1/auth/oidc/authentik/link")
    .set(bearer(session.sessionToken))
    .set("Origin", "https://evil.example")
    .expect(401);

  expect(ErrorEnvelopeSchema.parse(bodyOf(anonymous)).error.code).toBe("unauthorized");
  expect(ErrorEnvelopeSchema.parse(bodyOf(foreign)).error.code).toBe("invalid_oidc_login");
  expect(getDatabase(app).$client.prepare("SELECT * FROM oidc_transactions").all()).toEqual([]);
});

it("does not link after the requesting session logged out", async () => {
  const { app, session, flow, code } = await pendingLink();

  await request(httpServerOf(app))
    .post("/v1/auth/logout")
    .set(bearer(session.sessionToken))
    .expect(204);

  const failed = await completeLink(app, { ...flow, code, sessionToken: session.sessionToken });

  expect(failed.status).toBe(401);
  expect(getDatabase(app).$client.prepare("SELECT * FROM auth_identities").all()).toHaveLength(1);
});

it("does not link with an expired session", async () => {
  const { app, session, flow, code } = await pendingLink();
  getDatabase(app).$client.prepare("UPDATE sessions SET expires_at = 0").run();
  const failed = await completeLink(app, { ...flow, code, sessionToken: session.sessionToken });

  expect(failed.status).toBe(401);
  expect(getDatabase(app).$client.prepare("SELECT * FROM auth_identities").all()).toHaveLength(1);
});
