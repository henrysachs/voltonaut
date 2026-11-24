import request from "supertest";
import { expect, it } from "vitest";
import { bearer, getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import { setup, start, login, noSessions, ORIGIN } from "../testing/oidc-flow.spec.js";

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

  const sameIdentity = await start(context);
  await request(server).get(sameIdentity.callback).set("Cookie", sameIdentity.cookie).expect(401);

  context.provider.control.subject = "new-subject-same-email";
  const sameEmail = await start(context);
  await request(server).get(sameEmail.callback).set("Cookie", sameEmail.cookie).expect(401);

  context.provider.control.subject = "local-test-subject";
  context.provider.control.email = "new-email@example.com";
  const sameSubject = await start(context);
  await request(server).get(sameSubject.callback).set("Cookie", sameSubject.cookie).expect(401);

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
