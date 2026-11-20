import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { z } from "zod";
import { afterEach, expect } from "vitest";
import { SessionResponseSchema } from "@voltonaut/shared";
import { createOidcProvider } from "./oidc-provider.spec.js";
import { createTestApp, getDatabase, httpServerOf, bodyOf } from "./test-app.spec.js";
import { parseServerConfig } from "../config.js";

const closers: (() => Promise<void>)[] = [];
export const ORIGIN = "http://127.0.0.1:5182";

interface OidcApp {
  readonly app: Readonly<INestApplication>;
}

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

export async function setup() {
  const provider = await createOidcProvider();
  closers.push(() => provider.close());
  const time = { nowMs: Date.now() };

  const config = parseServerConfig(
    {
      AUTH_MODE: "oidc",
      OIDC_ISSUER: provider.issuer,
      OIDC_CLIENT_ID: "test-client",
      OIDC_CLIENT_SECRET: "test-secret",
      OIDC_REDIRECT_URI: "http://127.0.0.1:3000/v1/auth/oidc/callback",
      CLIENT_ORIGIN: ORIGIN,
      THROTTLER_SESSION_IP_PER_MIN: "100",
    },
    "test",
  );

  const result = await createTestApp({ config, clock: { nowMs: () => time.nowMs } });
  closers.push(() => result.app.close());

  return { ...result, provider, time };
}

export async function start(context: OidcApp) {
  const response = await request(httpServerOf(context.app)).get("/v1/auth/oidc/start").expect(302);
  const cookies = z.array(z.string()).parse(response.headers["set-cookie"]);
  const cookie = z.string().parse(cookies[0]?.split(";")[0]);
  const location = z.string().url().parse(response.headers["location"]);
  const providerResponse = await fetch(location, { redirect: "manual" });
  expect(providerResponse.status).toBe(302);
  const callback = new URL(z.string().url().parse(providerResponse.headers.get("location")));

  return {
    cookie,
    location,
    callback: `${callback.pathname}${callback.search}`,
    setCookie: cookies[0],
  };
}

export async function handoff(context: OidcApp) {
  const started = await start(context);

  const response = await request(httpServerOf(context.app))
    .get(started.callback)
    .set("Cookie", started.cookie)
    .expect(302);

  const location = new URL(z.string().url().parse(response.headers["location"]));
  expect(`${location.origin}${location.pathname}`).toBe(`${ORIGIN}/auth/finish`);
  expect([...location.searchParams.keys()]).toEqual(["code"]);

  return { ...started, code: z.string().parse(location.searchParams.get("code")) };
}

export async function login(context: OidcApp) {
  const flow = await handoff(context);

  const response = await request(httpServerOf(context.app))
    .post("/v1/auth/oidc/exchange")
    .set("Origin", ORIGIN)
    .set("Cookie", flow.cookie)
    .send({ code: flow.code })
    .expect(200);

  expect(response.headers["cache-control"]).toBe("no-store");
  expect(z.array(z.string()).parse(response.headers["set-cookie"])[0]).toContain("Max-Age=0");

  return SessionResponseSchema.parse(bodyOf(response));
}

export function noSessions(context: OidcApp): void {
  expect(getDatabase(context.app).$client.prepare("SELECT * FROM sessions").all()).toEqual([]);
}
