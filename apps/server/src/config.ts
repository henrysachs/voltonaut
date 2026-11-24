import { z } from "zod";
import { parseStravaConfig } from "./strava/strava.config.js";
import type { StravaConfig } from "./strava/strava.config.js";
import { parseOidcConfig, safeOidcUrl } from "./oidc-config.js";
import type { OidcAuthConfig } from "./oidc-config.js";

const OriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value &&
      !url.hostname.includes("*")
    );
  }, "must be an exact HTTP(S) origin without path or credentials");

const MailConfigSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("memory") }),
  z.object({
    provider: z.literal("cloudflare"),
    cloudflareToken: z.string().trim().min(1),
    cloudflareAccountId: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
  }),
  z.object({ provider: z.literal("resend"), resendApiKey: z.string().trim().min(1) }),
]);

export type MailConfig = (z.infer<typeof MailConfigSchema> | { readonly provider: "disabled" }) & {
  readonly from: string;
  readonly clientOrigin: string;
};

export interface ServerConfig {
  readonly auth: AuthConfig;
  readonly strava: StravaConfig;
  readonly rideSourcePolicy: "disabled" | "declared_ble_v1";
  readonly clientOrigin: string;
  readonly database: { readonly path: string; readonly migrationsDir: string };
  readonly mail: MailConfig;
  readonly cors: { readonly origins: readonly string[] };
  readonly session: { readonly ttlDays: number };
  readonly throttling: {
    readonly magicLinkEmailPerHour: number;
    readonly magicLinkIpPerHour: number;
    readonly sessionIpPerMin: number;
  };
  readonly http: { readonly host: string; readonly port: number };
}

export type AuthConfig =
  | { readonly mode: "disabled" }
  | { readonly mode: "magic-link" }
  | OidcAuthConfig;

function parseAuthConfig(
  env: Readonly<Record<string, string | undefined>>,
  nodeEnv: string,
): AuthConfig {
  const mode = z
    .enum(["disabled", "magic-link", "oidc"])
    .parse(env["AUTH_MODE"] ?? (nodeEnv === "production" ? undefined : "magic-link"));

  if (mode !== "oidc") return { mode };

  return parseOidcConfig(env, nodeEnv === "development" || nodeEnv === "test");
}

function envInt(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
): number {
  return z.coerce
    .number()
    .int()
    .positive()
    .max(2_147_483_647)
    .parse(env[key] ?? fallback);
}

function parseMailConfig(
  env: Readonly<Record<string, string | undefined>>,
  nodeEnv: string,
): MailConfig {
  const mail = MailConfigSchema.parse({
    provider: env["MAIL_PROVIDER"] ?? (nodeEnv === "production" ? "cloudflare" : "memory"),
    cloudflareToken: env["CLOUDFLARE_EMAIL_API_TOKEN"],
    cloudflareAccountId: env["CLOUDFLARE_EMAIL_ACCOUNT_ID"],
    resendApiKey: env["RESEND_API_KEY"],
  });

  if (nodeEnv === "production" && mail.provider === "memory") {
    throw new Error("config: production requires a real mail provider");
  }

  return {
    ...mail,
    from: z
      .string()
      .email()
      .parse(env["MAIL_FROM"] ?? "voltonaut@voltonaut.stammkneipe.dev"),
    clientOrigin: OriginSchema.parse(
      env["CLIENT_ORIGIN"] ??
        (nodeEnv === "production" ? "https://voltonaut.stammkneipe.dev" : "http://localhost:5173"),
    ),
  };
}

function parseBrowserConfig(
  env: Readonly<Record<string, string | undefined>>,
  nodeEnv: string,
  auth: AuthConfig,
): Pick<ServerConfig, "clientOrigin" | "cors"> {
  const clientOrigin = OriginSchema.parse(
    env["CLIENT_ORIGIN"] ??
      (nodeEnv === "production" ? "https://voltonaut.stammkneipe.dev" : "http://localhost:5173"),
  );

  if (auth.mode === "oidc" && !safeOidcUrl(clientOrigin, auth.allowLoopbackHttp)) {
    throw new Error("config: unsafe OIDC client origin");
  }

  const corsOrigins = z
    .array(OriginSchema)
    .nonempty()
    .parse(
      (
        env["CORS_ORIGINS"] ??
        (auth.mode === "oidc"
          ? clientOrigin
          : "http://localhost:5173,https://voltonaut.stammkneipe.dev")
      )
        .split(",")
        .map((origin) => origin.trim()),
    );

  if (auth.mode === "oidc" && (corsOrigins.length !== 1 || corsOrigins[0] !== clientOrigin)) {
    throw new Error("config: OIDC CORS must match CLIENT_ORIGIN exactly");
  }

  return { clientOrigin, cors: { origins: corsOrigins } };
}

export function parseServerConfig(
  env: Readonly<Record<string, string | undefined>>,
  nodeEnv: string,
): ServerConfig {
  const environment = z.enum(["development", "test", "production"]).parse(nodeEnv);
  const auth = parseAuthConfig(env, environment);
  const browser = parseBrowserConfig(env, environment, auth);

  return {
    auth,
    strava: stravaForBrowser(env, environment, browser),
    ...parseRideConfig(env, environment),
    ...browser,
    mail:
      auth.mode === "magic-link"
        ? parseMailConfig(env, environment)
        : {
            provider: "disabled",
            from: "voltonaut@voltonaut.stammkneipe.dev",
            clientOrigin: browser.clientOrigin,
          },
    session: { ttlDays: envInt(env, "SESSION_TTL_DAYS", 30) },
    throttling: {
      magicLinkEmailPerHour: envInt(env, "THROTTLER_MAGIC_LINK_EMAIL_PER_HOUR", 5),
      magicLinkIpPerHour: envInt(env, "THROTTLER_MAGIC_LINK_IP_PER_HOUR", 10),
      sessionIpPerMin: envInt(env, "THROTTLER_SESSION_IP_PER_MIN", 10),
    },
    http: {
      host: z
        .string()
        .min(1)
        .parse(env["HOST"] ?? "127.0.0.1"),
      port: z.coerce
        .number()
        .int()
        .min(0)
        .max(65535)
        .parse(env["PORT"] ?? 3000),
    },
  };
}

function parseRideConfig(
  env: Readonly<Record<string, string | undefined>>,
  environment: string,
): Pick<ServerConfig, "database" | "rideSourcePolicy"> {
  return {
    rideSourcePolicy: z
      .enum(["disabled", "declared_ble_v1"])
      .parse(env["RIDE_SOURCE_POLICY"] ?? "disabled"),
    database: {
      path: z
        .string()
        .min(1)
        .parse(env["DATABASE_PATH"] ?? (environment === "test" ? ":memory:" : "data/voltonaut.db")),
      migrationsDir: z
        .string()
        .min(1)
        .parse(env["DRIZZLE_MIGRATIONS_DIR"] ?? "drizzle"),
    },
  };
}

function stravaForBrowser(
  env: Readonly<Record<string, string | undefined>>,
  environment: string,
  browser: Pick<ServerConfig, "clientOrigin" | "cors">,
): StravaConfig {
  const strava = parseStravaConfig(env, environment === "production");

  if (
    strava.mode === "enabled" &&
    (!safeOidcUrl(browser.clientOrigin, environment !== "production") ||
      browser.cors.origins.length !== 1 ||
      browser.cors.origins[0] !== browser.clientOrigin)
  ) {
    throw new Error("config: Strava requires safe CLIENT_ORIGIN and exact credentialed CORS");
  }

  return strava;
}

export function testServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return { ...parseServerConfig({}, "test"), ...overrides };
}
