import { expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import request from "supertest";
import {
  ErrorEnvelopeSchema,
  StravaStatusSchema,
  StravaWebhookEventSchema,
} from "@voltonaut/shared";
import {
  setupStrava,
  pendingStrava,
  confirmStrava,
  STRAVA_ORIGIN,
} from "../testing/strava-flow.spec.js";
import { bearer, bodyOf, getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import { StravaStore } from "./strava.store.js";

const event = StravaWebhookEventSchema.parse({
  object_type: "athlete",
  object_id: 42,
  aspect_type: "update",
  owner_id: 42,
  subscription_id: 123,
  event_time: 1,
  updates: { authorized: "false" },
});

it.each([
  "/v1/strava/webhook#raw-fragment",
  "http://127.0.0.1/v1/strava/webhook",
  "http://127.0.0.1/V1/StRaVa/WeBhOoK/?probe=1#raw-fragment",
])("bounds JSON before parsing on raw webhook request target %s", async (target) => {
  const { app } = await setupStrava();
  await app.listen(0, "127.0.0.1");
  const server = httpServerOf(app);
  const receivedTargets: (string | undefined)[] = [];
  server.prependListener("request", (incoming: Readonly<Pick<IncomingMessage, "url">>) => {
    receivedTargets.push(incoming.url);
  });
  const origin = await app.getUrl();
  const body = JSON.stringify(event);

  function postRaw(payload: string, contentType = "application/json", encoding = "identity") {
    return new Promise<number | undefined>((resolve, reject) => {
      const outgoing = httpRequest(
        origin,
        {
          method: "POST",
          path: target,
          headers: {
            "Content-Type": contentType,
            "Content-Length": Buffer.byteLength(payload),
            "Content-Encoding": encoding,
          },
        },
        (response: Readonly<Pick<IncomingMessage, "resume" | "on" | "statusCode">>) => {
          response.resume();
          response.on("end", () => {
            resolve(response.statusCode);
          });
          response.on("error", reject);
        },
      );

      outgoing.on("error", reject);
      outgoing.end(payload);
    });
  }

  expect(await postRaw(body)).toBe(200);
  expect(receivedTargets).toEqual([target]);
  const atLimit = body.padEnd(8192, " ");
  expect(await postRaw(atLimit)).toBe(200);
  expect(await postRaw(atLimit + " ")).toBe(413);
  expect(await postRaw(body + " ".repeat(9000))).toBe(413);
  expect(await postRaw(atLimit + "{")).toBe(413);
  expect(await postRaw("{")).toBe(400);
  expect(await postRaw(body, "text/plain")).toBe(415);
  expect(await postRaw(body, "application/json", "gzip")).toBe(415);
  expect(receivedTargets).toEqual(Array.from({ length: 8 }, () => target));
});

it.each([
  "/v1/strava/webhook",
  "/v1/strava/webhook/",
  "/V1/StRaVa/WeBhOoK",
  "/V1/StRaVa/WeBhOoK/?probe=1",
  "/v1/strava/webhook?probe=1",
])("bounds JSON before parsing on accepted webhook path %s", async (path) => {
  const { app } = await setupStrava();
  const server = httpServerOf(app);
  const body = JSON.stringify(event);
  const valid = await request(server).post(path).type("json").send(body).expect(200);
  expect(valid.text).toBe("");

  const oversized = await request(server)
    .post(path)
    .type("json")
    .send(body + " ".repeat(9000))
    .expect(413);

  expect(ErrorEnvelopeSchema.parse(bodyOf(oversized)).error).toEqual({
    code: "payload_too_large",
    message: "JSON body exceeds 8 KiB",
  });
  await request(server).post(path).type("json").send("{").expect(400);
  await request(server).post(path).type("text").send(body).expect(415);
  await request(server).post(path).set("Content-Encoding", "gzip").send(event).expect(415);
});

it("keeps the general JSON parser at 8 MiB outside the webhook", async () => {
  const { app } = await setupStrava();
  const server = httpServerOf(app);
  await request(server)
    .post("/v2/rides")
    .type("json")
    .send(" ".repeat(1024 * 1024) + "{}")
    .expect(401);

  const oversized = await request(server)
    .post("/v2/rides")
    .type("json")
    .send(" ".repeat(8 * 1024 * 1024) + "{}")
    .expect(413);

  expect(ErrorEnvelopeSchema.parse(bodyOf(oversized)).error).toEqual({
    code: "payload_too_large",
    message: "JSON body exceeds 8 MiB",
  });
});

it("serves a strict public constant-token challenge before registration and blocks OAuth start", async () => {
  const context = await setupStrava(null);
  const server = httpServerOf(context.app);
  const query = `hub.mode=subscribe&hub.challenge=public-challenge&hub.verify_token=${"b".repeat(64)}`;
  const reply = await request(server).get(`/v1/strava/webhook?${query}`).expect(200);
  expect(bodyOf(reply)).toEqual({ "hub.challenge": "public-challenge" });
  expect(reply.headers["content-type"]).toContain("application/json");

  await Promise.all(
    [
      query + "&hub.mode=subscribe",
      query + "&x=1",
      query.replace("subscribe", "unsubscribe"),
      query.replace("public-challenge", ""),
      query.replace("public-challenge", "x".repeat(257)),
    ].map((invalid) => request(server).get(`/v1/strava/webhook?${invalid}`).expect(400)),
  );
  await request(server)
    .get(`/v1/strava/webhook?${query.replace("b".repeat(64), "a".repeat(64))}`)
    .expect(403);

  const status = await request(server)
    .get("/v1/strava/connection")
    .set(bearer(context.owner.sessionToken))
    .expect(200);

  expect(StravaStatusSchema.parse(bodyOf(status))).toEqual({ status: "registration_required" });
  await request(server)
    .post("/v1/strava/connect-start")
    .set(bearer(context.owner.sessionToken))
    .set("Origin", STRAVA_ORIGIN)
    .send({ action: "connect", channel: "00000000-0000-4000-8000-000000000001" })
    .expect(503);
  expect(context.provider.control.tokenCalls).toBe(0);
});

it("persists only relevant untrusted hints before empty acknowledgement without any provider call", async () => {
  const context = await setupStrava();
  const flow = await pendingStrava(context);
  await confirmStrava(context, flow.code, flow.cookie).expect(200);
  const server = httpServerOf(context.app);
  const store = context.app.get<StravaStore>(StravaStore);
  const before = store.connection(context.owner.user.id);
  expect(before).toBeDefined();
  const response = await request(server).post("/v1/strava/webhook").send(event).expect(200);
  expect(response.text).toBe("");
  expect(store.connection(context.owner.user.id)).toEqual({
    ...before,
    authorizationHintRevision: 1,
  });

  await Promise.all(
    [
      { ...event, subscription_id: 124 },
      { ...event, owner_id: 99, object_id: 99 },
      { ...event, object_id: 99 },
      { ...event, object_type: "activity" },
      { ...event, aspect_type: "delete" },
      { ...event, updates: { authorized: "true" } },
      { ...event, object_type: "future_object" },
    ].map((ignored: Readonly<typeof event>) =>
      request(server).post("/v1/strava/webhook").send(ignored).expect(200),
    ),
  );
  expect(store.connection(context.owner.user.id)?.authorizationHintRevision).toBe(1);
  expect(context.provider.control.tokenCalls).toBe(1);
  expect(context.provider.control.revokeCalls).toBe(0);
  expect(context.provider.resources.athleteCalls).toBe(0);
  getDatabase(context.app).$client.exec(
    "CREATE TRIGGER reject_hint BEFORE UPDATE OF authorization_hint_revision ON strava_connections BEGIN SELECT RAISE(FAIL, 'synthetic disk failure'); END",
  );
  const failed = await request(server).post("/v1/strava/webhook").send(event).expect(503);
  expect(failed.text).not.toContain("synthetic");
});

it("bounds public bodies, media types and malformed or undocumented fields", async () => {
  const { app } = await setupStrava();
  const server = httpServerOf(app);

  const invalid = [
    { ...event, extra: true },
    { ...event, updates: { authorized: false } },
    { ...event, object_id: 9007199254740992 },
    { ...event, owner_id: -1 },
    { ...event, event_time: "1" },
    [],
  ];

  const requests = [];

  for (const bad of invalid) {
    expect(StravaWebhookEventSchema.safeParse(bad).success).toBe(false);
    requests.push(request(server).post("/v1/strava/webhook").send(bad).expect(400));
  }

  await Promise.all(requests);

  await request(server).post("/v1/strava/webhook").type("json").send("{").expect(400);
  await request(server)
    .post("/v1/strava/webhook")
    .type("text")
    .send(JSON.stringify(event))
    .expect(415);
  await request(server)
    .post("/v1/strava/webhook")
    .send({ ...event, updates: { title: "x".repeat(9000) } })
    .expect(413);
  await request(server)
    .post("/v1/strava/webhook")
    .set("Content-Encoding", "gzip")
    .send(event)
    .expect(415);
});
