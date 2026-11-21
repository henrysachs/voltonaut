import { gzipSync } from "node:zlib";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  DEFAULT_RIDER_PROFILE,
  ErrorEnvelopeSchema,
  MAX_LOCAL_RIDE_MS,
  RideReceiptSchema,
} from "@voltonaut/shared";
import { MAX_JSON_BODY_BYTES } from "../app.setup.js";
import {
  bearer,
  bodyOf,
  createTestApp,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import type { TestApp, TestSession } from "../testing/test-app.spec.js";
import { recording } from "../testing/recording.spec.js";

let testApp: TestApp;
let session: TestSession;

beforeAll(async () => {
  testApp = await createTestApp();
  session = await loginTestUser(testApp.app, testApp.mail, "bounds@example.com");
});

afterAll(async () => {
  await testApp.app.close();
});

it.each([
  { ...DEFAULT_RIDER_PROFILE, massKg: 29 },
  { ...DEFAULT_RIDER_PROFILE, massKg: 201 },
  { ...DEFAULT_RIDER_PROFILE, heightCm: 119 },
  { ...DEFAULT_RIDER_PROFILE, heightCm: 221 },
  { ...DEFAULT_RIDER_PROFILE, ftpW: 1001 },
  { ...DEFAULT_RIDER_PROFILE, maxHrBpm: 59 },
  { ...DEFAULT_RIDER_PROFILE, displayName: "" },
  { ...DEFAULT_RIDER_PROFILE, displayName: "x".repeat(41) },
  { ...DEFAULT_RIDER_PROFILE, userId: "someone-else" },
  { ...DEFAULT_RIDER_PROFILE, bike: { ...DEFAULT_RIDER_PROFILE.bike, massKg: 31 } },
  { ...DEFAULT_RIDER_PROFILE, bike: { ...DEFAULT_RIDER_PROFILE.bike, chainringTeeth: 27 } },
  { ...DEFAULT_RIDER_PROFILE, bike: { ...DEFAULT_RIDER_PROFILE.bike, cogTeeth: 24 } },
  { ...DEFAULT_RIDER_PROFILE, bike: { ...DEFAULT_RIDER_PROFILE.bike, wheelCircM: 1.8 } },
  { ...DEFAULT_RIDER_PROFILE, bike: { ...DEFAULT_RIDER_PROFILE.bike, extra: true } },
])(
  "rejects profile bounds and unknown fields %#",
  async (profile: Readonly<typeof DEFAULT_RIDER_PROFILE>) => {
    const response = await request(httpServerOf(testApp.app))
      .put("/v1/me/profile")
      .set(bearer(session.sessionToken))
      .send(profile)
      .expect(422);

    expect(ErrorEnvelopeSchema.parse(bodyOf(response)).error.code).toBe("validation_failed");
  },
);

it.each([
  "limit=0",
  "limit=51",
  "limit=1.5",
  "limit=abc",
  "limit=1&limit=2",
  "cursor=oops",
  "userId=other",
])("rejects malformed query %s", async (query) => {
  const response = await request(httpServerOf(testApp.app))
    .get(`/v2/rides?${query}`)
    .set(bearer(session.sessionToken))
    .expect(422);

  expect(ErrorEnvelopeSchema.parse(bodyOf(response)).error.code).toBe("validation_failed");
});

it("rejects malformed recording fields", async () => {
  const server = httpServerOf(testApp.app);
  const ride = recording();

  const invalid = [
    JSON.stringify({ ...ride, schemaVersion: 2 }),
    JSON.stringify({ ...ride, userId: "other" }),
    JSON.stringify({ ...ride, samples: [] }),
    JSON.stringify({
      ...ride,
      samples: Array.from({ length: 21_603 }, () => ({
        elapsedMs: 0,
        distanceM: 0,
        powerW: 150,
        gap: true,
      })),
    }),
    JSON.stringify({
      ...ride,
      samples: [
        { elapsedMs: 0, distanceM: 0, powerW: 2001, gap: true },
        { elapsedMs: MAX_LOCAL_RIDE_MS + 1, distanceM: 1, gap: true },
      ],
    }),
    JSON.stringify({
      ...ride,
      metadata: { ...ride.metadata, profile: { ...DEFAULT_RIDER_PROFILE, extra: true } },
    }),
    JSON.stringify({
      ...ride,
      metadata: {
        ...ride.metadata,
        profile: { ...DEFAULT_RIDER_PROFILE, bike: { ...DEFAULT_RIDER_PROFILE.bike, extra: true } },
      },
    }),
  ];

  await Promise.all(
    invalid.map(async (payload) => {
      const response = await request(server)
        .post("/v2/rides")
        .set(bearer(session.sessionToken))
        .set("Content-Type", "application/json")
        .send(payload)
        .expect(422);

      expect(ErrorEnvelopeSchema.parse(bodyOf(response)).error.code).toBe("validation_failed");
    }),
  );
});

it("rejects malformed ride paths", async () => {
  const path = await request(httpServerOf(testApp.app))
    .get("/v2/rides/not-a-uuid")
    .set(bearer(session.sessionToken))
    .expect(422);

  expect(ErrorEnvelopeSchema.parse(bodyOf(path)).error.code).toBe("validation_failed");
});

it("accepts a normal hour recording beyond Nest's default 100 KiB", async () => {
  const ride = {
    ...recording(),
    samples: Array.from({ length: 3601 }, (_, index) => ({
      elapsedMs: index * 1000,
      distanceM: index * 5,
      powerW: 150,
      cadenceRpm: 80,
      gap: false,
    })),
  };

  expect(Buffer.byteLength(JSON.stringify(ride))).toBeGreaterThan(100 * 1024);

  const response = await request(httpServerOf(testApp.app))
    .post("/v2/rides")
    .set(bearer(session.sessionToken))
    .send(ride)
    .expect(200);

  expect(RideReceiptSchema.parse(bodyOf(response)).assessment.status).toBe("unverified");
});

it("rejects oversized and malformed JSON without returning the raw body", async () => {
  const server = httpServerOf(testApp.app);

  const oversized = await request(server)
    .post("/v2/rides")
    .set(bearer(session.sessionToken))
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ privateValue: "x".repeat(MAX_JSON_BODY_BYTES) }))
    .expect(413);

  expect(ErrorEnvelopeSchema.parse(bodyOf(oversized)).error.code).toBe("payload_too_large");
  expect(JSON.stringify(bodyOf(oversized))).not.toContain("privateValue");

  const malformed = await request(server)
    .post("/v2/rides")
    .set(bearer(session.sessionToken))
    .set("Content-Type", "application/json")
    .send('{"secret":"do-not-return",')
    .expect(400);

  expect(ErrorEnvelopeSchema.parse(bodyOf(malformed)).error.code).toBe("validation_failed");
  expect(JSON.stringify(bodyOf(malformed))).not.toContain("do-not-return");
});

it("rejects compressed JSON rather than accepting an unbounded inflation", async () => {
  const response = await request(httpServerOf(testApp.app))
    .post("/v2/rides")
    .set(bearer(session.sessionToken))
    .set("Content-Type", "application/json")
    .set("Content-Encoding", "gzip")
    .send(gzipSync(JSON.stringify(recording())))
    .expect(415);

  expect(ErrorEnvelopeSchema.parse(bodyOf(response)).error.code).toBe("unsupported_media_type");
});

it("rejects plain-text JSON with 415 before body validation", async () => {
  const response = await request(httpServerOf(testApp.app))
    .post("/v2/rides")
    .set(bearer(session.sessionToken))
    .set("Content-Type", "text/plain")
    .send(JSON.stringify(recording()))
    .expect(415);

  expect(ErrorEnvelopeSchema.parse(bodyOf(response)).error.code).toBe("unsupported_media_type");

  const anonymous = await request(httpServerOf(testApp.app))
    .post("/v2/rides")
    .set("Content-Type", "text/plain")
    .send(JSON.stringify(recording()))
    .expect(401);

  expect(ErrorEnvelopeSchema.parse(bodyOf(anonymous)).error.code).toBe("unauthorized");
});

it("accepts application/json with a legitimate charset", async () => {
  const response = await request(httpServerOf(testApp.app))
    .post("/v2/rides")
    .set(bearer(session.sessionToken))
    .set("Content-Type", "application/json; charset=utf-8")
    .send(JSON.stringify(recording()))
    .expect(200);

  expect(RideReceiptSchema.parse(bodyOf(response)).storage).toBe("stored");
});
