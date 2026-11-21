import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterEach } from "vitest";
import request from "supertest";
import { z } from "zod";
import { StravaStartResponseSchema } from "@voltonaut/shared";
import { LocalStravaProvider } from "./strava-provider.spec.js";
import { bearer, bodyOf, createTestApp, httpServerOf, loginTestUser } from "./test-app.spec.js";

export const STRAVA_ORIGIN = "http://127.0.0.1:5197";

export async function setupStrava(subscriptionId: string | null = "123") {
  const provider = new LocalStravaProvider("123", "generated-test-client-secret");
  await provider.listen();
  afterEach(() => provider.close());
  const time = { nowMs: Date.now() };

  const context = await createTestApp({
    clock: { nowMs: () => time.nowMs },
    config: {
      clientOrigin: STRAVA_ORIGIN,
      cors: { origins: [STRAVA_ORIGIN] },
      throttling: {
        magicLinkEmailPerHour: 10000,
        magicLinkIpPerHour: 10000,
        sessionIpPerMin: 10000,
      },
      strava: {
        mode: "enabled",
        clientId: "123",
        clientSecret: "generated-test-client-secret",
        tokenKey: randomBytes(32).toString("hex"),
        webhook: { verifyToken: "b".repeat(64), subscriptionId },
        providerOrigin: provider.origin,
        redirectUri: "http://127.0.0.1:3000/v1/strava/callback",
      },
    },
  });

  afterEach(() => context.app.close());
  const owner = await loginTestUser(context.app, context.mail, "owner@example.com");
  const other = await loginTestUser(context.app, context.mail, "other@example.com");

  return { ...context, provider, time, owner, other };
}

export type StravaContext = Awaited<ReturnType<typeof setupStrava>>;

export interface StravaApp {
  readonly app: Readonly<INestApplication>;
  readonly owner: { readonly sessionToken: string };
}

export function confirmStrava(
  context: StravaApp,
  code: string,
  cookie: string,
  token = context.owner.sessionToken,
) {
  return request(httpServerOf(context.app))
    .post("/v1/strava/confirm")
    .set(bearer(token))
    .set("Origin", STRAVA_ORIGIN)
    .set("Cookie", cookie)
    .send({ code });
}

export function disconnectStrava(context: StravaApp) {
  return request(httpServerOf(context.app))
    .post("/v1/strava/disconnect")
    .set(bearer(context.owner.sessionToken))
    .set("Origin", STRAVA_ORIGIN)
    .send({ action: "disconnect" });
}

export async function startStrava(context: StravaApp, token = context.owner.sessionToken) {
  const response = await request(httpServerOf(context.app))
    .post("/v1/strava/connect-start")
    .set(bearer(token))
    .set("Origin", STRAVA_ORIGIN)
    .send({ action: "connect", channel: "00000000-0000-4000-8000-000000000001" })
    .expect(200);

  const cookies = z.array(z.string()).parse(response.headers["set-cookie"]);
  const cookie = z.string().parse(cookies[0]?.split(";")[0]);
  const { authorizationUrl } = StravaStartResponseSchema.parse(bodyOf(response));
  const authorized = await fetch(authorizationUrl, { redirect: "manual" });
  const callback = new URL(z.string().parse(authorized.headers.get("location")));

  return { cookie, callback: `${callback.pathname}${callback.search}`, authorizationUrl };
}

export async function pendingStrava(context: StravaApp, token = context.owner.sessionToken) {
  const flow = await startStrava(context, token);

  const response = await request(httpServerOf(context.app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(302);

  const location = z.string().parse(response.headers["location"]);
  const code = z.string().parse(new URL(location).searchParams.get("code"));

  return { ...flow, code, location };
}
