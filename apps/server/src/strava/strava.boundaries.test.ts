import request from "supertest";
import { z } from "zod";
import { expect, it } from "vitest";
import { StravaStatusSchema } from "@voltonaut/shared";
import {
  bearer,
  bodyOf,
  httpServerOf,
  loginTestUser,
  getDatabase,
} from "../testing/test-app.spec.js";
import {
  setupStrava,
  startStrava,
  pendingStrava,
  confirmStrava,
  STRAVA_ORIGIN,
} from "../testing/strava-flow.spec.js";

it("requires a currently valid bearer and preserves the handoff for a new owner session after logout", async () => {
  const context = await setupStrava();
  const flow = await pendingStrava(context);
  await request(httpServerOf(context.app))
    .post("/v1/auth/logout")
    .set(bearer(context.owner.sessionToken))
    .expect(204);
  await confirmStrava(context, flow.code, flow.cookie).expect(401);
  const fresh = await loginTestUser(context.app, context.mail, "owner@example.com");

  const result = await confirmStrava(context, flow.code, flow.cookie, fresh.sessionToken).expect(
    200,
  );

  expect(StravaStatusSchema.parse(bodyOf(result)).status).toBe("connected");
});

it("does not consume confirmation on wrong origin or cookie and rejects schema extras", async () => {
  const context = await setupStrava();
  const flow = await pendingStrava(context);
  const server = httpServerOf(context.app);
  await request(server)
    .post("/v1/strava/confirm")
    .set(bearer(context.owner.sessionToken))
    .set("Origin", "https://evil.example")
    .set("Cookie", flow.cookie)
    .send({ code: flow.code })
    .expect(401);
  await confirmStrava(context, flow.code, flow.cookie.slice(0, -1)).expect(401);
  await request(server)
    .post("/v1/strava/confirm")
    .set(bearer(context.owner.sessionToken))
    .set("Origin", STRAVA_ORIGIN)
    .set("Cookie", flow.cookie)
    .send({ code: flow.code, userId: context.other.user.id })
    .expect(422);
  const confirmed = await confirmStrava(context, flow.code, flow.cookie).expect(200);

  expect(StravaStatusSchema.parse(bodyOf(confirmed)).status).toBe("connected");
});

it("rejects a missing state without claiming the original transaction", async () => {
  const context = await setupStrava();
  const flow = await startStrava(context);
  const callback = new URL(flow.callback, "http://127.0.0.1");
  callback.searchParams.delete("state");
  await request(httpServerOf(context.app))
    .get(`${callback.pathname}${callback.search}`)
    .set("Cookie", flow.cookie)
    .expect(401);
  await request(httpServerOf(context.app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(302);
  expect(context.provider.control.tokenCalls).toBe(1);
});

it("enforces connection-state and owner constraints in SQLite", async () => {
  const context = await setupStrava();
  const db = getDatabase(context.app);
  expect(() =>
    db.$client
      .prepare(
        "INSERT INTO strava_connections(user_id, athlete_id, status, encrypted_tokens, access_expires_at, scope) VALUES ('orphan', '42', 'connected', '{}', 0, 'activity:write')",
      )
      .run(),
  ).toThrow("FOREIGN KEY");
  expect(() =>
    db.$client
      .prepare(
        "INSERT INTO strava_connections(user_id, athlete_id, status, encrypted_tokens, access_expires_at, scope) VALUES (?, '42', 'pending', '{}', 0, 'activity:write')",
      )
      .run(context.owner.user.id),
  ).toThrow("CHECK");
  expect(
    StravaStatusSchema.safeParse({
      status: "connected",
      athleteId: "42",
      scope: "activity:write",
      accessExpiresAt: new Date().toISOString(),
      accessToken: "not-allowed",
    }).success,
  ).toBe(false);
  expect(StravaStatusSchema.safeParse({ status: "disconnected", athleteId: "42" }).success).toBe(
    false,
  );
});

it("returns a denied flow only to its fixed channel after original state and cookie checks", async () => {
  const context = await setupStrava();
  context.provider.control.deny = true;
  const flow = await startStrava(context);
  await request(httpServerOf(context.app)).get(flow.callback).expect(401);

  const response = await request(httpServerOf(context.app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(302);

  const location = new URL(z.string().parse(response.headers["location"]));
  expect(location.origin).toBe(STRAVA_ORIGIN);
  expect(location.pathname).toBe("/strava/finish");
  expect(Object.fromEntries(location.searchParams)).toEqual({
    channel: "00000000-0000-4000-8000-000000000001",
    result: "denied",
  });
  expect(context.provider.control.tokenCalls).toBe(0);
  expect(
    getDatabase(context.app).$client.prepare("SELECT * FROM strava_connections").all(),
  ).toEqual([]);
});
