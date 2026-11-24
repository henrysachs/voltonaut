import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterEach } from "vitest";
import { z } from "zod";
import { SessionResponseSchema } from "@voltonaut/shared";
import { createOidcProvider } from "./oidc-provider.spec.js";
import type { LocalOidcProvider } from "./oidc-provider.spec.js";
import { bodyOf, createTestApp, httpServerOf } from "./test-app.spec.js";
import { parseServerConfig } from "../config.js";
import type { AuthConfig } from "../config.js";
import type { OidcProviderConfig } from "../oidc-config.js";

export const PROVIDERS_ORIGIN = "http://127.0.0.1:5183";
export const AUTHENTIK_PATH = "/application/o/voltonaut/";
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

export interface ProvidersContext {
  readonly app: Readonly<INestApplication>;
  readonly cloudflare: LocalOidcProvider;
  readonly authentik: LocalOidcProvider;
}

export interface Flow {
  readonly cookie: string;
  readonly callback: string;
}

export async function setupProviders(
  extra: Readonly<Record<string, string>> = {},
): Promise<ProvidersContext> {
  const cloudflare = await createOidcProvider();
  const authentik = await createOidcProvider(AUTHENTIK_PATH);
  closers.push(
    () => cloudflare.close(),
    () => authentik.close(),
  );

  const config = parseServerConfig(
    {
      AUTH_MODE: "oidc",
      OIDC_PROVIDERS: "cloudflare,authentik",
      OIDC_CLOUDFLARE_DISPLAY_NAME: "Cloudflare Access",
      OIDC_CLOUDFLARE_ISSUER: cloudflare.issuer,
      OIDC_CLOUDFLARE_CLIENT_ID: "test-client",
      OIDC_CLOUDFLARE_CLIENT_SECRET: "test-secret",
      OIDC_CLOUDFLARE_REDIRECT_URI: "http://127.0.0.1:3000/v1/auth/oidc/cloudflare/callback",
      OIDC_AUTHENTIK_DISPLAY_NAME: "authentik",
      OIDC_AUTHENTIK_ISSUER: authentik.issuer,
      OIDC_AUTHENTIK_CLIENT_ID: "test-client",
      OIDC_AUTHENTIK_CLIENT_SECRET: "test-secret",
      OIDC_AUTHENTIK_REDIRECT_URI: "http://127.0.0.1:3000/v1/auth/oidc/authentik/callback",
      CLIENT_ORIGIN: PROVIDERS_ORIGIN,
      THROTTLER_SESSION_IP_PER_MIN: "100",
      ...extra,
    },
    "test",
  );

  const { app } = await createTestApp({ config });
  closers.push(() => app.close());

  return { app, cloudflare, authentik };
}

export async function beginLogin(
  app: Readonly<INestApplication>,
  providerId: string,
): Promise<Flow> {
  const started = await request(httpServerOf(app))
    .get(`/v1/auth/oidc/${providerId}/start`)
    .expect(302);

  const setCookie = z.array(z.string()).parse(started.headers["set-cookie"]);
  const cookie = z.string().parse(setCookie[0]?.split(";")[0]);

  const authorize = await fetch(z.string().url().parse(started.headers["location"]), {
    redirect: "manual",
  });

  const callback = new URL(z.string().url().parse(authorize.headers.get("location")));

  return { cookie, callback: `${callback.pathname}${callback.search}` };
}

/** Calls the callback and returns where the browser is sent next. */
export async function finishLogin(
  app: Readonly<INestApplication>,
  flow: Readonly<Flow>,
): Promise<URL> {
  const response = await request(httpServerOf(app))
    .get(flow.callback)
    .set("Cookie", flow.cookie)
    .expect(302);

  return new URL(z.string().url().parse(response.headers["location"]));
}

export async function loginVia(app: Readonly<INestApplication>, providerId: string) {
  const flow = await beginLogin(app, providerId);
  const location = await finishLogin(app, flow);
  const code = z.string().parse(location.searchParams.get("code"));

  const response = await request(httpServerOf(app))
    .post("/v1/auth/oidc/exchange")
    .set("Origin", PROVIDERS_ORIGIN)
    .set("Cookie", flow.cookie)
    .send({ code })
    .expect(200);

  return SessionResponseSchema.parse(bodyOf(response));
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The fake provider is mutable by design; tests steer its next token.
export function setIdentity(provider: LocalOidcProvider, subject: string, email: string): void {
  provider.control.subject = subject;
  provider.control.email = email;
}

export function oidcProvidersOf(auth: Readonly<AuthConfig>): readonly OidcProviderConfig[] {
  if (auth.mode !== "oidc") throw new Error("expected OIDC mode");

  return auth.providers;
}
