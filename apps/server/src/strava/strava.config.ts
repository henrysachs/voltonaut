import { z } from "zod";

export type StravaConfig =
  | { readonly mode: "disabled" }
  | {
      readonly mode: "enabled";
      readonly clientId: string;
      readonly clientSecret: string;
      readonly redirectUri: string;
      readonly tokenKey: string;
      readonly providerOrigin: string;
      readonly webhook: {
        readonly verifyToken: string;
        readonly subscriptionId: string | null;
      };
    };

export function validTokenKey(value: string): boolean {
  return (
    /^[a-f0-9]{64}$/u.test(value) ||
    (/^[A-Za-z0-9+/]{43}=$/u.test(value) &&
      Buffer.from(value, "base64").length === 32 &&
      Buffer.from(value, "base64").toString("base64") === value)
  );
}

function safeCallback(value: string, production: boolean): boolean {
  const url = new URL(value);

  return (
    url.href === value &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    url.pathname === "/v1/strava/callback" &&
    (url.protocol === "https:" ||
      (!production &&
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
  );
}

const TestOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);

    return (
      url.origin === value &&
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  });

function webhookConfig(env: Readonly<Record<string, string | undefined>>) {
  return {
    verifyToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(env["STRAVA_WEBHOOK_VERIFY_TOKEN"]),
    subscriptionId:
      z
        .string()
        .regex(/^[1-9]\d{0,15}$/u)
        .optional()
        .parse(env["STRAVA_WEBHOOK_SUBSCRIPTION_ID"]) ?? null,
  };
}

export function parseStravaConfig(
  env: Readonly<Record<string, string | undefined>>,
  production: boolean,
): StravaConfig {
  const mode = z.enum(["disabled", "enabled"]).parse(env["STRAVA_MODE"] ?? "disabled");

  if (mode === "disabled") return { mode };

  const redirectUri = z
    .string()
    .url()
    .refine((value) => safeCallback(value, production))
    .parse(env["STRAVA_REDIRECT_URI"]);

  const fake = env["STRAVA_TEST_PROVIDER_ORIGIN"];

  if (production && fake !== undefined)
    throw new Error("config: Strava test provider forbidden in production");

  const providerOrigin =
    fake === undefined ? "https://www.strava.com" : TestOriginSchema.parse(fake);

  const key = env["STRAVA_TOKEN_KEY"];

  if (key === undefined || !validTokenKey(key))
    throw new Error("config: Strava requires a canonical 32-byte token key");

  return {
    mode,
    redirectUri,
    providerOrigin,
    tokenKey: key,
    webhook: webhookConfig(env),
    clientId: z
      .string()
      .regex(/^[1-9]\d*$/u)
      .parse(env["STRAVA_CLIENT_ID"]),
    clientSecret: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[\u0021-\u007E]+$/u)
      .parse(env["STRAVA_CLIENT_SECRET"]),
  };
}
