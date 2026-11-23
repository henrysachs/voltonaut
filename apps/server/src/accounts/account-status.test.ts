import { afterEach, expect, it } from "vitest";
import request from "supertest";
import { z } from "zod";
import { AccountStatusSchema, AdminUsersSchema, DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  loginTestUser,
  httpServerOf,
} from "../testing/test-app.spec.js";
import { AccountsService } from "./accounts.service.js";

const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

async function fixture() {
  const { app, mail, config } = await createTestApp();
  cleanup.add(() => app.close());
  const admin = await loginTestUser(app, mail, "operator@example.com");
  const member = await loginTestUser(app, mail, "member@example.com");
  const accounts = app.get<AccountsService>(AccountsService);
  const db = getDatabase(app);

  return { server: httpServerOf(app), admin, member, accounts, db, origin: config.clientOrigin };
}

it("does not accept membership or authorization through the existing profile contract", async () => {
  const f = await fixture();
  await request(f.server)
    .put("/v1/me/profile")
    .set(bearer(f.member.sessionToken))
    .send({
      ...DEFAULT_RIDER_PROFILE,
      membership: { tier: "pro", vip: true },
      authorization: { role: "admin" },
    })
    .expect(422);
  expect(f.accounts.status(f.member.user.id)).toEqual({
    membership: { tier: "normal", vip: false },
    authorization: { role: "user" },
  });
  expect(f.accounts.getProfile(f.member.user.id)).toEqual({ status: "missing" });
});

it("defaults new accounts without a row, requires sessions and rejects every nonadmin tier/VIP combination", async () => {
  const f = await fixture();
  const server = f.server;
  await request(server).get("/v1/me/account-status").expect(401);
  await request(server).get("/v1/admin/users").expect(401);
  await request(server)
    .patch(`/v1/admin/users/${f.member.user.id}/membership`)
    .send({ tier: "pro", vip: true })
    .expect(401);

  const response = await request(server)
    .get("/v1/me/account-status")
    .set(bearer(f.member.sessionToken))
    .expect(200);

  expect(AccountStatusSchema.parse(bodyOf(response))).toEqual({
    membership: { tier: "normal", vip: false },
    authorization: { role: "user" },
  });
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(f.db.$client.prepare("SELECT * FROM account_status").all()).toEqual([]);
});

it.each(
  ["normal", "premium", "pro"].flatMap((tier) => [false, true].map((vip) => ({ tier, vip }))),
)(
  "denies administration for $tier VIP=$vip",
  async (membership: { readonly tier: string; readonly vip: boolean }) => {
    const f = await fixture();
    f.accounts.setRole(f.admin.user.id, { role: "admin" });
    expect(f.accounts.status(f.member.user.id).authorization.role).toBe("user");
    await request(f.server)
      .patch(`/v1/admin/users/${f.member.user.id}/membership`)
      .set(bearer(f.admin.sessionToken))
      .set("Origin", f.origin)
      .send(membership)
      .expect(200);
    await request(f.server).get("/v1/admin/users").set(bearer(f.member.sessionToken)).expect(403);
    await request(f.server)
      .patch(`/v1/admin/users/${f.admin.user.id}/membership`)
      .set(bearer(f.member.sessionToken))
      .set("Origin", f.origin)
      .send({ tier: "pro", vip: true })
      .expect(403);
  },
);

it("validates origin and strict body, rejects nonexistent/deleted targets and observes role revocation", async () => {
  const f = await fixture();
  f.accounts.setRole(f.admin.user.id, { role: "admin" });

  const patch = () =>
    request(f.server)
      .patch(`/v1/admin/users/${f.member.user.id}/membership`)
      .set(bearer(f.admin.sessionToken));

  await patch().send({ tier: "premium", vip: true }).expect(403);
  await patch()
    .set("Origin", "https://evil.invalid")
    .send({ tier: "premium", vip: true })
    .expect(403);
  await patch().set("Origin", f.origin).send({ tier: "pro", vip: true, role: "admin" }).expect(422);
  await patch().set("Origin", f.origin).send({ tier: "premium" }).expect(422);
  await request(f.server)
    .patch("/v1/admin/users/missing/membership")
    .set(bearer(f.admin.sessionToken))
    .set("Origin", f.origin)
    .send({ tier: "pro", vip: true })
    .expect(404);
  f.db.$client.prepare("UPDATE users SET deleted_at = 1 WHERE id = ?").run(f.member.user.id);
  await patch().set("Origin", f.origin).send({ tier: "premium", vip: true }).expect(404);
  f.accounts.requireAdmin(f.admin.user.id);
  f.accounts.setRole(f.admin.user.id, { role: "user" });
  expect(() =>
    f.accounts.setMembership(f.admin.user.id, f.admin.user.id, { tier: "pro", vip: true }),
  ).toThrow("administrator required");
  await request(f.server).get("/v1/admin/users").set(bearer(f.admin.sessionToken)).expect(403);
});

it("paginates bounded safe metadata and preserves independent role/membership writes", async () => {
  const f = await fixture();
  f.accounts.setRole(f.admin.user.id, { role: "admin" });
  f.accounts.setMembership(f.admin.user.id, f.member.user.id, { tier: "pro", vip: true });
  f.accounts.setRole(f.member.user.id, { role: "admin" });
  expect(f.accounts.status(f.member.user.id)).toEqual({
    membership: { tier: "pro", vip: true },
    authorization: { role: "admin" },
  });
  f.accounts.setMembership(f.admin.user.id, f.member.user.id, { tier: "premium", vip: false });
  expect(f.accounts.status(f.member.user.id).authorization.role).toBe("admin");
  f.accounts.setRole(f.member.user.id, { role: "user" });
  expect(f.accounts.status(f.member.user.id).membership).toEqual({ tier: "premium", vip: false });

  const first = await request(f.server)
    .get("/v1/admin/users?limit=1")
    .set(bearer(f.admin.sessionToken))
    .expect(200);

  const page = AdminUsersSchema.parse(bodyOf(first));
  expect(first.headers["cache-control"]).toBe("no-store");
  expect(page.users).toHaveLength(1);
  expect(page.nextCursor).not.toBeNull();

  const second = await request(f.server)
    .get(`/v1/admin/users?limit=1&cursor=${encodeURIComponent(z.string().parse(page.nextCursor))}`)
    .set(bearer(f.admin.sessionToken))
    .expect(200);

  const last = AdminUsersSchema.parse(bodyOf(second));
  expect(last.nextCursor).toBeNull();
  expect(last.users[0]?.id).not.toBe(page.users[0]?.id);
  expect(page.users.map((user) => Object.keys(user).toSorted())).toEqual([
    ["displayName", "email", "id", "membership"],
  ]);
  await request(f.server)
    .get("/v1/admin/users?limit=51")
    .set(bearer(f.admin.sessionToken))
    .expect(422);
});
