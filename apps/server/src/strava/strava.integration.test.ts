import request from "supertest";
import { expect, it } from "vitest";
import { z } from "zod";
import { StravaProvider } from "./strava.provider.js";
import { StravaStatusSchema, ErrorEnvelopeSchema } from "@voltonaut/shared";
import { bearer, bodyOf, getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import {
  setupStrava,
  startStrava,
  pendingStrava,
  STRAVA_ORIGIN,
  confirmStrava as confirm,
  disconnectStrava as disconnect,
} from "../testing/strava-flow.spec.js";
import type { StravaContext } from "../testing/strava-flow.spec.js";

it("keeps OAuth pending until fresh owner confirmation, then reports only nonsecret fields", async () => {
  const context = await setupStrava();
  const flow = await pendingStrava(context);
  const server = httpServerOf(context.app);
  expect(new URL(flow.location).origin).toBe(STRAVA_ORIGIN);
  expect(new URL(flow.location).pathname).toBe("/strava/finish");

  const status = await request(server)
    .get("/v1/strava/connection")
    .set(bearer(context.owner.sessionToken))
    .expect(200);

  expect(StravaStatusSchema.parse(bodyOf(status)).status).toBe("pending");
  await confirm(context, flow.code, flow.cookie, context.other.sessionToken).expect(401);
  await request(server)
    .post("/v1/strava/confirm")
    .set("Origin", STRAVA_ORIGIN)
    .set("Cookie", flow.cookie)
    .send({ code: flow.code })
    .expect(401);
  const connected = await confirm(context, flow.code, flow.cookie).expect(200);
  expect(StravaStatusSchema.parse(bodyOf(connected))).toMatchObject({
    status: "connected",
    athleteId: "42",
    scope: "activity:write",
  });
  await confirm(context, flow.code, flow.cookie).expect(401);

  const other = await request(server)
    .get("/v1/strava/connection")
    .set(bearer(context.other.sessionToken))
    .expect(200);

  expect(bodyOf(other)).toEqual({ status: "disconnected" });
  expect(context.provider.control.validClientCalls).toBe(1);
  expect(context.provider.control.unexpectedCalls).toBe(0);
  expect(connected.text).not.toContain("token");
  const rows = getDatabase(context.app).$client.prepare("SELECT * FROM strava_connections").all();
  expect(JSON.stringify(rows)).not.toContain("accessToken");
  await request(server)
    .post("/v1/strava/connect-start")
    .set(bearer(context.owner.sessionToken))
    .set("Origin", STRAVA_ORIGIN)
    .send({ action: "connect", channel: "00000000-0000-4000-8000-000000000001" })
    .expect(409);
});

it("requires bearer, exact origin, strict consent body and credentialed CORS in legacy mode", async () => {
  const context = await setupStrava();
  const server = httpServerOf(context.app);
  await request(server).get("/v1/strava/connection").expect(401);
  await request(server)
    .post("/v1/strava/connect-start")
    .set("Origin", STRAVA_ORIGIN)
    .send({ action: "connect", channel: "00000000-0000-4000-8000-000000000001" })
    .expect(401);
  await request(server)
    .post("/v1/strava/connect-start")
    .set(bearer("wrong"))
    .set("Origin", STRAVA_ORIGIN)
    .send({ action: "connect", channel: "00000000-0000-4000-8000-000000000001" })
    .expect(401);

  await Promise.all(
    ["", "https://evil.example"].map((origin) =>
      request(server)
        .post("/v1/strava/connect-start")
        .set(bearer(context.owner.sessionToken))
        .set("Origin", origin)
        .send({ action: "connect", channel: "00000000-0000-4000-8000-000000000001" })
        .expect(401),
    ),
  );
  await request(server)
    .post("/v1/strava/connect-start")
    .set(bearer(context.owner.sessionToken))
    .set("Origin", STRAVA_ORIGIN)
    .send({
      action: "connect",
      channel: "00000000-0000-4000-8000-000000000001",
      returnTo: "https://evil.example",
    })
    .expect(422);

  const preflight = await request(server)
    .options("/v1/strava/connect-start")
    .set("Origin", STRAVA_ORIGIN)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "authorization,content-type")
    .expect(204);

  expect(preflight.headers["access-control-allow-origin"]).toBe(STRAVA_ORIGIN);
  expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
  expect(context.provider.control.tokenCalls).toBe(0);
});

it("rejects malformed, truncated, duplicate and foreign binding cookies and state without consuming the valid flow", async () => {
  const context = await setupStrava();
  const flow = await startStrava(context);
  const server = httpServerOf(context.app);

  await Promise.all(
    [
      "",
      flow.cookie.slice(0, -1),
      `${flow.cookie}extra`,
      `${flow.cookie}; ${flow.cookie}`,
      `x${flow.cookie}`,
      `voltonaut-strava=${"a".repeat(43)}`,
    ].map((cookie) => request(server).get(flow.callback).set("Cookie", cookie).expect(401)),
  );
  const wrong = new URL(flow.callback, "http://127.0.0.1");
  wrong.searchParams.set("state", "a".repeat(43));
  await request(server)
    .get(`${wrong.pathname}${wrong.search}`)
    .set("Cookie", flow.cookie)
    .expect(401);
  await request(server)
    .get(`${flow.callback}&state=${"b".repeat(43)}`)
    .set("Cookie", flow.cookie)
    .expect(401);
  expect(context.provider.control.tokenCalls).toBe(0);
  await request(server).get(flow.callback).set("Cookie", flow.cookie).expect(302);
});

it("claims concurrent callbacks once and confirms concurrently once", async () => {
  const context = await setupStrava();
  const flow = await startStrava(context);
  const server = httpServerOf(context.app);

  const replies = await Promise.all(
    [0, 1].map(() => request(server).get(flow.callback).set("Cookie", flow.cookie)),
  );

  expect(
    replies
      .map((reply: { readonly status: number }) => reply.status)
      .toSorted((left, right) => left - right),
  ).toEqual([302, 401]);
  expect(context.provider.control.tokenCalls).toBe(1);

  const row = getDatabase(context.app)
    .$client.prepare("SELECT handoff_hash FROM strava_connections")
    .get();

  expect(row).toBeDefined();
  const redirect = replies.find((reply: { readonly status: number }) => reply.status === 302);
  const location = z.string().parse(redirect?.headers["location"]);
  const code = z.string().parse(new URL(location).searchParams.get("code"));
  const confirmed = await Promise.all([0, 1].map(() => confirm(context, code, flow.cookie)));
  expect(
    confirmed
      .map((reply: { readonly status: number }) => reply.status)
      .toSorted((left, right) => left - right),
  ).toEqual([200, 401]);
});

it.each<{
  readonly label: string;
  readonly deny: boolean;
  readonly scope: string;
  readonly elapsedMs: number;
}>([
  { label: "scope", deny: false, scope: "read", elapsedMs: 0 },
  { label: "expired", deny: false, scope: "activity:write", elapsedMs: 300_000 },
])("rejects callback $label before provider exchange", async ({ deny, scope, elapsedMs }) => {
  const context = await setupStrava();

  context.provider.control.deny = deny;
  context.provider.control.scope = scope;
  const flow = await startStrava(context);

  context.time.nowMs += elapsedMs;
  await request(httpServerOf(context.app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(401);
  expect(context.provider.control.tokenCalls).toBe(0);
  expect(
    getDatabase(context.app).$client.prepare("SELECT * FROM strava_connections").all(),
  ).toEqual([]);
});

it.each([
  "http",
  "invalid-json",
  "missing-token",
  "athlete",
  "expired",
  "oversized",
  "stall",
] satisfies StravaContext["provider"]["control"]["tokenFault"][])(
  "fails closed on provider response %s without leaking payloads or retrying",
  async (fault) => {
    const context = await setupStrava();
    context.provider.control.tokenFault = fault;
    const flow = await startStrava(context);

    const response = await request(httpServerOf(context.app))
      .get(flow.callback)
      .set("Cookie", flow.cookie)
      .expect(401);

    expect(ErrorEnvelopeSchema.parse(bodyOf(response)).error.code).toBe(
      "invalid_strava_connection",
    );
    expect(response.text).not.toContain("private-provider");
    await request(httpServerOf(context.app))
      .get(flow.callback)
      .set("Cookie", flow.cookie)
      .expect(401);
    expect(context.provider.control.tokenCalls).toBe(1);
    expect(
      getDatabase(context.app).$client.prepare("SELECT * FROM strava_connections").all(),
    ).toEqual([]);
  },
);

it("rejects a provider token scope reduction and client mismatch", async () => {
  const context = await setupStrava();
  const first = await startStrava(context);
  context.provider.control.scope = "read";
  await request(httpServerOf(context.app))
    .get(first.callback)
    .set("Cookie", first.cookie)
    .expect(401);
  context.provider.control.scope = "activity:write";
  const second = await startStrava(context);

  const code = z
    .string()
    .parse(new URL(second.callback, context.provider.origin).searchParams.get("code"));

  const wrongClient = new StravaProvider({
    mode: "enabled",
    clientId: "999",
    clientSecret: "wrong",
    redirectUri: "http://127.0.0.1/v1/strava/callback",
    tokenKey: "a".repeat(64),
    providerOrigin: context.provider.origin,
  });

  await expect(wrongClient.exchange(code, context.time.nowMs)).rejects.toThrow(
    "connection is invalid",
  );
  expect(context.provider.control.revokeCalls).toBe(0);
  await request(httpServerOf(context.app))
    .get(second.callback)
    .set("Cookie", second.cookie)
    .expect(302);
});

it("retains expired pending credentials for explicit revocation and preserves owner on athlete conflict", async () => {
  const context = await setupStrava();
  const first = await pendingStrava(context);
  const other = await startStrava(context, context.other.sessionToken);
  await request(httpServerOf(context.app))
    .get(other.callback)
    .set("Cookie", other.cookie)
    .expect(409);
  expect(context.provider.control.revokeCalls).toBe(0);
  context.time.nowMs += 60_000;
  await confirm(context, first.code, first.cookie).expect(401);

  const status = await request(httpServerOf(context.app))
    .get("/v1/strava/connection")
    .set(bearer(context.owner.sessionToken));

  expect(bodyOf(status)).toEqual({ status: "confirmation_expired" });
  expect(bodyOf(await disconnect(context).expect(200))).toEqual({ status: "disconnected" });
  expect(context.provider.control.revokeCalls).toBe(1);
});
