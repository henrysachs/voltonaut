import request from "supertest";
import { expect, it } from "vitest";
import { bearer, getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import { setup, start, login, noSessions, ORIGIN } from "../testing/oidc-flow.spec.js";
import {
  PROVIDERS_ORIGIN,
  loginVia,
  setIdentity,
  setupProviders,
} from "../testing/oidc-providers.spec.js";
import { beginLink, completeLink, linkCode } from "../testing/oidc-link.spec.js";

/* oxlint-disable typescript/prefer-readonly-parameter-types -- The provider fixture exposes mutable controls used to simulate deleted identities. */
async function expectRejectedLogin(
  context: Readonly<Awaited<ReturnType<typeof setup>>>,
): Promise<void> {
  const flow = await start(context);
  await request(httpServerOf(context.app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(401);
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */

it("keeps deleted email and external identity blocked without recreating an account", async () => {
  const context = await setup();
  const original = await login(context);
  const server = httpServerOf(context.app);
  await request(server)
    .delete("/v1/me")
    .set(bearer(original.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: original.user.email })
    .expect(204);

  await expectRejectedLogin(context);

  context.provider.control.subject = "new-subject-same-email";
  await expectRejectedLogin(context);

  context.provider.control.subject = "local-test-subject";
  context.provider.control.email = "new-email@example.com";
  await expectRejectedLogin(context);

  const db = getDatabase(context.app).$client;
  expect(db.prepare("SELECT id, deleted_at FROM users").all()).toEqual([
    { id: original.user.id, deleted_at: context.time.nowMs },
  ]);
  expect(db.prepare("SELECT * FROM auth_identities").all()).toEqual([]);
  expect(db.prepare("SELECT * FROM auth_identity_tombstones").all()).toHaveLength(1);
  noSessions(context);
});

it("keeps an existing identity active when its changed provider email matches a deleted account", async () => {
  const context = await setup();
  const original = await login(context);
  const server = httpServerOf(context.app);
  context.provider.control.subject = "deleted-subject";
  context.provider.control.email = "blocked@example.com";
  const deleted = await login(context);
  await request(server)
    .delete("/v1/me")
    .set(bearer(deleted.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: deleted.user.email })
    .expect(204);

  context.provider.control.subject = "local-test-subject";
  context.provider.control.email = "blocked@example.com";
  const returning = await login(context);
  expect(returning.user.id).toBe(original.user.id);
  expect(
    getDatabase(context.app)
      .$client.prepare("SELECT id FROM users ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END")
      .all(original.user.id),
  ).toEqual([{ id: original.user.id }, { id: deleted.user.id }]);
});

it("does not link a deleted provider identity to another account", async () => {
  const context = await setupProviders();
  const server = httpServerOf(context.app);
  setIdentity(context.cloudflare, "deleted-cf", "deleted@example.com");
  const deleted = await loginVia(context.app, "cloudflare");
  await request(server)
    .delete("/v1/me")
    .set(bearer(deleted.sessionToken))
    .set("Origin", PROVIDERS_ORIGIN)
    .send({ confirmation: deleted.user.email })
    .expect(204);

  setIdentity(context.authentik, "active-ak", "active@example.com");
  const active = await loginVia(context.app, "authentik");
  setIdentity(context.cloudflare, "deleted-cf", "deleted@example.com");
  const flow = await beginLink(context.app, active.sessionToken, "cloudflare");
  const code = await linkCode(context.app, flow);

  const failed = await completeLink(context.app, {
    sessionToken: active.sessionToken,
    cookie: flow.cookie,
    code,
  });

  expect(failed.status).toBe(401);
  expect(getDatabase(context.app).$client.prepare("SELECT * FROM auth_identities").all()).toEqual([
    {
      issuer: context.authentik.issuer,
      subject: "active-ak",
      user_id: active.user.id,
    },
  ]);
});
