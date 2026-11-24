import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { z } from "zod";
import { LinkedIdentitiesResponseSchema, OidcLinkStartResponseSchema } from "@voltonaut/shared";
import { bodyOf, bearer, httpServerOf } from "./test-app.spec.js";
import { PROVIDERS_ORIGIN } from "./oidc-providers.spec.js";

export interface LinkFlow {
  readonly cookie: string;
  readonly callback: string;
}

/** Starts an explicit account link as the given session and completes the provider login. */
export async function beginLink(
  app: Readonly<INestApplication>,
  sessionToken: string,
  providerId: string,
): Promise<LinkFlow> {
  const started = await request(httpServerOf(app))
    .post(`/v1/auth/oidc/${providerId}/link`)
    .set(bearer(sessionToken))
    .set("Origin", PROVIDERS_ORIGIN)
    .expect(200);

  const setCookie = z.array(z.string()).parse(started.headers["set-cookie"]);
  const cookie = z.string().parse(setCookie[0]?.split(";")[0]);
  const { location } = OidcLinkStartResponseSchema.parse(bodyOf(started));
  const authorize = await fetch(location, { redirect: "manual" });
  const callback = new URL(z.string().url().parse(authorize.headers.get("location")));

  return { cookie, callback: `${callback.pathname}${callback.search}` };
}

/** Runs the provider callback and returns the one-time link code from the finish redirect. */
export async function linkCode(
  app: Readonly<INestApplication>,
  flow: Readonly<LinkFlow>,
): Promise<string> {
  const response = await request(httpServerOf(app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(302);

  const location = new URL(z.string().url().parse(response.headers["location"]));

  return z.string().parse(location.searchParams.get("link"));
}

export function completeLink(
  app: Readonly<INestApplication>,
  completion: Readonly<{ sessionToken: string; cookie: string; code: string }>,
) {
  return request(httpServerOf(app))
    .post("/v1/auth/identities")
    .set(bearer(completion.sessionToken))
    .set("Origin", PROVIDERS_ORIGIN)
    .set("Cookie", completion.cookie)
    .send({ code: completion.code });
}

export async function identitiesOf(app: Readonly<INestApplication>, sessionToken: string) {
  const response = await request(httpServerOf(app))
    .get("/v1/auth/identities")
    .set(bearer(sessionToken))
    .expect(200);

  return LinkedIdentitiesResponseSchema.parse(bodyOf(response)).identities;
}

/** Account link from start to completion for the given session. */
export async function linkProvider(
  app: Readonly<INestApplication>,
  sessionToken: string,
  providerId: string,
): Promise<Awaited<ReturnType<typeof completeLink>>> {
  const flow = await beginLink(app, sessionToken, providerId);
  const code = await linkCode(app, flow);

  return completeLink(app, { sessionToken, cookie: flow.cookie, code });
}
