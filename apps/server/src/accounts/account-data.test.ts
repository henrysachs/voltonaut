import { expect, it } from "vitest";
import request from "supertest";

import { AccountExportSchema } from "@voltonaut/shared";
import { bearer, bodyOf } from "../testing/test-app.spec.js";
import { userOwnedTables } from "../testing/user-owned-tables.js";
import {
  accountDataFixture,
  assertOwnerPurged,
  assertRecreationBlocked,
  assertTombstone,
  NOW_MS,
  ORIGIN,
  ride,
} from "./account-data.fixture.js";

it("requires authentication and never accepts another account as an export or deletion target", async () => {
  const f = await accountDataFixture();
  await request(f.server).get("/v1/me/export").expect(401);
  await request(f.server).delete("/v1/me").send({ confirmation: f.owner.user.email }).expect(401);
  await request(f.server)
    .get("/v1/me/export?userId=foreign")
    .set(bearer(f.owner.sessionToken))
    .expect(200);
  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .send({ confirmation: f.owner.user.email })
    .expect(403);
  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", "https://foreign.invalid")
    .send({ confirmation: f.owner.user.email })
    .expect(403);
  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: f.other.user.email, userId: f.other.user.id })
    .expect(422);
  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: f.other.user.email })
    .expect(403);
  expect(f.accounts.getProfile(f.owner.user.id).status).toBe("present");
});

async function exportOwner() {
  const f = await accountDataFixture();

  for (let index = 3; index <= 55; index += 1) f.rides.store(f.owner.user.id, ride(index), NOW_MS);

  const response = await request(f.server)
    .get("/v1/me/export")
    .set(bearer(f.owner.sessionToken))
    .expect(200);

  return { f, response, exported: AccountExportSchema.parse(bodyOf(response)) };
}

it("exports every own ride and account record without sessions or credentials", async () => {
  const { f, response, exported } = await exportOwner();

  expect(response.headers["cache-control"]).toBe("no-store");
  expect(exported.account.user).toEqual(f.owner.user);
  expect(exported.account.membership).toEqual({ tier: "premium", vip: true });
  expect(exported.account.identities).toEqual([
    { issuer: "https://identity.example", subject: "owner-subject" },
  ]);
  expect(exported.profile).toMatchObject({
    status: "present",
    profile: { displayName: "Owner" },
  });
  expect(exported.rides).toHaveLength(54);
  expect(exported.rides.every((item) => item.receipt.rideId === item.recording.rideId)).toBe(true);
  expect(exported.rides[0]?.stored).toMatchObject({
    uploadedAt: "2026-11-24T12:00:00.000Z",
    durationMs: 1000,
    source: "sim",
    replaySummary: null,
    tcx: null,
  });
  expect(exported.rides.some((item) => item.recording.rideId === ride(2).rideId)).toBe(false);
  // Purchased items only, never another account's; catalog defaults carry no personal data.
  expect(exported.inventory).toEqual({
    items: [{ itemId: "jersey.stripe", source: "shop", acquiredAt: "2026-11-24T12:00:00.000Z" }],
  });
  expect(exported.strava.deliveries).toHaveLength(1);
  expect(response.text).not.toContain(f.owner.sessionToken);
  expect(response.text).not.toContain("private-ciphertext");
  expect(response.text).not.toContain("owner-handoff");
});

it("exports only the owner's Volts journal and derived balance", async () => {
  const { exported } = await exportOwner();

  const { balance, journal } = exported.progression.volts;

  expect(balance).toBe(17);
  expect(journal).toHaveLength(3);
  expect(journal).toContainEqual(
    expect.objectContaining({
      reason: "ride_reward",
      deltaVolts: 20,
      refId: "20000000-0000-4000-8000-000000000001",
      rewardDay: "2026-11-24",
      startTick: 0,
      endTick: 1,
      candidateVolts: 20,
      cumulativeFacts: {
        activeDistanceM: 0,
        activeElevationGainM: 0,
        activeTimeS: 0,
        elevationGainM: 0,
        energyKj: 20,
      },
      createdAt: "2026-11-24T12:00:00.000Z",
    }),
  );
  expect(journal).toContainEqual(
    expect.objectContaining({
      reason: "purchase",
      deltaVolts: -8,
      refId: "item-one",
      idempotencyKey: "purchase:item-one",
    }),
  );
  expect(journal).toContainEqual(
    expect.objectContaining({
      reason: "operator_grant",
      deltaVolts: 5,
      refId: "acceptance",
      idempotencyKey: "operator:acceptance",
    }),
  );
  expect(JSON.stringify(journal)).not.toContain("20000000-0000-4000-8000-000000000002");
});

it("does not reveal who issued a credit in the owner's export", async () => {
  const { f, exported } = await exportOwner();

  expect(JSON.stringify(exported)).not.toContain(f.other.user.id);
});

it("deletes only the confirmed owner, revokes sessions and blocks silent recreation", async () => {
  const f = await accountDataFixture();

  const deleted = await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: ` ${f.owner.user.email.toUpperCase()} ` })
    .expect(204);

  expect(deleted.headers["cache-control"]).toBe("no-store");
  await request(f.server).get("/v1/me").set(bearer(f.owner.sessionToken)).expect(401);
  await request(f.server).get("/v1/me").set(bearer(f.other.sessionToken)).expect(200);
  assertOwnerPurged(f);
  assertTombstone(f);
  expect(
    f.db.$client.prepare("SELECT entry_id, operator_user_id FROM volts_grant_operators").all(),
  ).toEqual([
    { entry_id: "30000000-0000-4000-8000-000000000004", operator_user_id: f.owner.user.id },
  ]);

  const mailCount = f.mail.readSent().length;
  await request(f.server)
    .post("/v1/auth/magic-link")
    .send({ email: f.owner.user.email })
    .expect(204);
  expect(f.mail.readSent()).toHaveLength(mailCount + 1);
  expect(
    f.db.$client.prepare("SELECT * FROM login_tokens WHERE email = ?").all(f.owner.user.email),
  ).toEqual([]);
  assertRecreationBlocked(f);
});

it("fails the export instead of silently hiding corrupt TCX bytes", async () => {
  const f = await accountDataFixture();
  f.db.$client
    .prepare("UPDATE rides SET export_tcx = '<tcx/>', export_hash = ?, export_version = 'tcx-1'")
    .run("0".repeat(64));

  expect(() => f.rides.exportOwn(f.owner.user.id)).toThrow("stored ride export is corrupt");
});

it("rolls the whole deletion back when any owner purge fails", async () => {
  const f = await accountDataFixture();
  f.db.$client.exec(
    "CREATE TRIGGER fail_ride_delete BEFORE DELETE ON rides BEGIN SELECT RAISE(ABORT, 'forced failure'); END",
  );
  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: f.owner.user.email })
    .expect(500);

  expect(f.accounts.getProfile(f.owner.user.id).status).toBe("present");
  expect(f.rides.list(f.owner.user.id, { limit: 20 }).rides).toHaveLength(1);
  expect(
    f.db.$client.prepare("SELECT deleted_at FROM users WHERE id = ?").get(f.owner.user.id),
  ).toEqual({ deleted_at: null });
  await request(f.server).get("/v1/me").set(bearer(f.owner.sessionToken)).expect(200);
});

it("rolls earlier purge steps back when the final users update fails", async () => {
  const f = await accountDataFixture();

  const tables = [
    "users",
    "auth_identity_tombstones",
    "login_tokens",
    "strava_rate_budget",
    ...userOwnedTables(f.db),
  ];

  const snapshot = () =>
    tables.map((table) => f.db.$client.prepare(`SELECT * FROM ${table}`).all());

  const before = snapshot();
  f.db.$client.exec(
    "CREATE TRIGGER fail_users_update BEFORE UPDATE ON users WHEN NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'forced final failure'); END",
  );

  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: f.owner.user.email })
    .expect(500);

  expect(snapshot()).toEqual(before);
  await request(f.server).get("/v1/me").set(bearer(f.owner.sessionToken)).expect(200);
});
