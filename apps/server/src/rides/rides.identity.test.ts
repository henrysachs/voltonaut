import request from "supertest";
import { afterEach, beforeEach, expect, it } from "vitest";

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

const LOWER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPPER_ID = LOWER_ID.toUpperCase();
let testApp: TestApp;
let owner: TestSession;
let other: TestSession;

beforeEach(async () => {
  testApp = await createTestApp();
  owner = await loginTestUser(testApp.app, testApp.mail, "identity-owner@example.com");
  other = await loginTestUser(testApp.app, testApp.mail, "identity-other@example.com");
});

afterEach(async () => {
  await testApp.app.close();
});

it.each([
  { firstId: LOWER_ID, retryId: UPPER_ID },
  { firstId: UPPER_ID, retryId: LOWER_ID },
])(
  "canonicalizes first upload $firstId and reuses the original payload, hash and receipt",
  async ({ firstId, retryId }: { readonly firstId: string; readonly retryId: string }) => {
    const server = httpServerOf(testApp.app);

    const first = await request(server)
      .post("/v2/rides")
      .set(bearer(owner.sessionToken))
      .send(recording(firstId))
      .expect(200);

    const db = getDatabase(testApp.app);

    const stored = db.$client
      .prepare("SELECT id, payload_json, payload_hash, receipt_json, uploaded_at FROM rides")
      .all();

    expect(bodyOf(first)).toMatchObject({ rideId: LOWER_ID, storage: "stored" });
    expect(stored).toHaveLength(1);
    expect(stored).toMatchObject([
      { id: LOWER_ID, payload_json: JSON.stringify(recording(LOWER_ID)) },
    ]);

    const retry = await request(server)
      .post("/v2/rides")
      .set(bearer(owner.sessionToken))
      .send(recording(retryId))
      .expect(200);

    expect(bodyOf(retry)).toEqual(bodyOf(first));
    expect(
      db.$client
        .prepare("SELECT id, payload_json, payload_hash, receipt_json, uploaded_at FROM rides")
        .all(),
    ).toEqual(stored);
  },
);

it("keeps foreign case aliases indistinguishable from missing rides on upload", async () => {
  const server = httpServerOf(testApp.app);

  await request(server)
    .post("/v2/rides")
    .set(bearer(owner.sessionToken))
    .send(recording(LOWER_ID))
    .expect(200);

  const missing = await request(server)
    .get("/v2/rides/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    .set(bearer(other.sessionToken))
    .expect(404);

  const collision = await request(server)
    .post("/v2/rides")
    .set(bearer(other.sessionToken))
    .send(recording(UPPER_ID))
    .expect(404);

  expect(bodyOf(collision)).toEqual(bodyOf(missing));
  expect(getDatabase(testApp.app).$client.prepare("SELECT id FROM rides").all()).toEqual([
    { id: LOWER_ID },
  ]);
});

it("resolves detail aliases for the owner and hides the same aliases from another owner", async () => {
  const server = httpServerOf(testApp.app);

  await request(server)
    .post("/v2/rides")
    .set(bearer(owner.sessionToken))
    .send(recording(LOWER_ID))
    .expect(200);

  const lower = await request(server)
    .get(`/v2/rides/${LOWER_ID}`)
    .set(bearer(owner.sessionToken))
    .expect(200);

  const upper = await request(server)
    .get(`/v2/rides/${UPPER_ID}`)
    .set(bearer(owner.sessionToken))
    .expect(200);

  const foreign = await request(server)
    .get(`/v2/rides/${UPPER_ID}`)
    .set(bearer(other.sessionToken))
    .expect(404);

  expect(bodyOf(upper)).toEqual(bodyOf(lower));
  expect(bodyOf(upper)).toMatchObject({ recording: { rideId: LOWER_ID } });
  expect(bodyOf(foreign)).toMatchObject({ error: { code: "not_found" } });
});

it("canonicalizes cursor case before the owner-scoped SQLite comparison", async () => {
  const server = httpServerOf(testApp.app);

  const ids = [
    LOWER_ID,
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ];

  await Promise.all(
    ids.map((id) =>
      request(server)
        .post("/v2/rides")
        .set(bearer(owner.sessionToken))
        .send(recording(id))
        .expect(200),
    ),
  );

  const lower = await request(server)
    .get(`/v2/rides?limit=1&cursor=${LOWER_ID}`)
    .set(bearer(owner.sessionToken))
    .expect(200);

  const upper = await request(server)
    .get(`/v2/rides?limit=1&cursor=${UPPER_ID}`)
    .set(bearer(owner.sessionToken))
    .expect(200);

  expect(bodyOf(upper)).toEqual(bodyOf(lower));
  expect(bodyOf(upper)).toMatchObject({ rides: [{ rideId: ids[1] }], nextCursor: ids[1] });
});
