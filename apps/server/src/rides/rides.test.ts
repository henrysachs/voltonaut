import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  DEFAULT_RIDER_PROFILE,
  ProfileStateSchema,
  RideDetailSchema,
  RideListSchema,
  RideReceiptSchema,
} from "@voltonaut/shared";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import type { TestApp, TestSession } from "../testing/test-app.spec.js";
import { recording } from "../testing/recording.spec.js";

let testApp: TestApp;
let alice: TestSession;
let bob: TestSession;

beforeAll(async () => {
  testApp = await createTestApp();
  alice = await loginTestUser(testApp.app, testApp.mail, "alice@example.com");
  bob = await loginTestUser(testApp.app, testApp.mail, "bob@example.com");
});

afterAll(async () => {
  await testApp.app.close();
});

it("requires a session on every owned endpoint", async () => {
  expect.assertions(0);
  const server = httpServerOf(testApp.app);
  await request(server).get("/v1/me/profile").expect(401);
  await request(server).put("/v1/me/profile").send(DEFAULT_RIDER_PROFILE).expect(401);
  await request(server).post("/v2/rides").send(recording()).expect(401);
  await request(server).get("/v2/rides").expect(401);
  await request(server).get(`/v2/rides/${randomUUID()}`).expect(401);
});

it("keeps independent profiles and updates only the current owner", async () => {
  const server = httpServerOf(testApp.app);
  const missing = await request(server).get("/v1/me/profile").set(bearer(alice.sessionToken));
  expect(ProfileStateSchema.parse(bodyOf(missing))).toEqual({ status: "missing" });

  const first = await request(server)
    .put("/v1/me/profile")
    .set(bearer(alice.sessionToken))
    .send(DEFAULT_RIDER_PROFILE)
    .expect(200);

  expect(ProfileStateSchema.parse(bodyOf(first))).toMatchObject({
    status: "present",
    profile: DEFAULT_RIDER_PROFILE,
  });
  await request(server)
    .put("/v1/me/profile")
    .set(bearer(bob.sessionToken))
    .send({ ...DEFAULT_RIDER_PROFILE, displayName: "Bob" })
    .expect(200);

  const updated = await request(server)
    .put("/v1/me/profile")
    .set(bearer(alice.sessionToken))
    .send({ ...DEFAULT_RIDER_PROFILE, massKg: 80 })
    .expect(200);

  expect(ProfileStateSchema.parse(bodyOf(updated))).toMatchObject({ profile: { massKg: 80 } });

  const other = await request(server)
    .get("/v1/me/profile")
    .set(bearer(bob.sessionToken))
    .expect(200);

  expect(ProfileStateSchema.parse(bodyOf(other))).toMatchObject({
    profile: { displayName: "Bob", massKg: 75 },
  });
});

it("stores unverified recordings and retries canonically", async () => {
  const server = httpServerOf(testApp.app);
  const ride = recording();
  const post = () => request(server).post("/v2/rides").set(bearer(alice.sessionToken));
  const first = await post().send(ride).expect(200);
  expect(RideReceiptSchema.parse(bodyOf(first))).toEqual({
    rideId: ride.rideId,
    storage: "stored",
    assessment: { status: "unverified", reason: "legacy_missing_replay" },
  });

  const retry = await post()
    .send({
      samples: ride.samples,
      metadata: ride.metadata,
      startedAt: ride.startedAt,
      rideId: ride.rideId,
      schemaVersion: 1,
    })
    .expect(200);

  expect(bodyOf(retry)).toEqual(bodyOf(first));

  const conflict = await post()
    .send({ ...ride, startedAt: "2026-11-19T10:00:00.000Z" })
    .expect(409);

  expect(bodyOf(conflict)).toMatchObject({ error: { code: "ride_id_conflict" } });

  const detail = await request(server)
    .get(`/v2/rides/${ride.rideId}`)
    .set(bearer(alice.sessionToken))
    .expect(200);

  expect(RideDetailSchema.parse(bodyOf(detail))).toEqual({
    recording: ride,
    assessment: { status: "unverified", reason: "legacy_missing_replay" },
  });
});

it("hides foreign ride IDs on reads and upload collisions", async () => {
  const server = httpServerOf(testApp.app);
  const ride = recording();

  await request(server).post("/v2/rides").set(bearer(alice.sessionToken)).send(ride).expect(200);

  const foreign = await request(server)
    .get(`/v2/rides/${ride.rideId}`)
    .set(bearer(bob.sessionToken))
    .expect(404);

  const missing = await request(server)
    .get(`/v2/rides/${randomUUID()}`)
    .set(bearer(bob.sessionToken))
    .expect(404);

  expect(bodyOf(foreign)).toEqual(bodyOf(missing));

  const collision = await request(server)
    .post("/v2/rides")
    .set(bearer(bob.sessionToken))
    .send(ride)
    .expect(404);

  expect(bodyOf(collision)).toEqual(bodyOf(missing));
});

it("converges concurrent retries to one row and lists only owned summaries", async () => {
  const ride = recording();
  const server = httpServerOf(testApp.app);

  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      request(server).post("/v2/rides").set(bearer(alice.sessionToken)).send(ride).expect(200),
    ),
  );

  for (const response of responses) {
    expect(RideReceiptSchema.parse(bodyOf(response))).toEqual({
      rideId: ride.rideId,
      storage: "stored",
      assessment: { status: "unverified", reason: "legacy_missing_replay" },
    });
  }

  expect(
    getDatabase(testApp.app)
      .$client.prepare("SELECT count(*) AS total FROM rides WHERE id = ?")
      .get(ride.rideId),
  ).toEqual({ total: 1 });

  const page = await request(server)
    .get("/v2/rides?limit=1")
    .set(bearer(alice.sessionToken))
    .expect(200);

  const parsed = RideListSchema.parse(bodyOf(page));

  expect(parsed.rides).toHaveLength(1);
  expect(JSON.stringify(bodyOf(page))).not.toContain("samples");
  expect(parsed.nextCursor).not.toBeNull();

  const next = await request(server)
    .get(`/v2/rides?limit=1&cursor=${parsed.nextCursor}`)
    .set(bearer(alice.sessionToken))
    .expect(200);

  const nextPage = RideListSchema.parse(bodyOf(next));

  expect(nextPage.rides).toHaveLength(1);
  expect(nextPage.rides[0]?.rideId).not.toBe(parsed.rides[0]?.rideId);

  const other = await request(server).get("/v2/rides").set(bearer(bob.sessionToken)).expect(200);

  expect(RideListSchema.parse(bodyOf(other))).toEqual({ rides: [], nextCursor: null });
});
