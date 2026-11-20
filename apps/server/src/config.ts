import { z } from "zod";

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

export type MailConfig = z.infer<typeof MailConfigSchema> & {
  readonly from: string;
  readonly clientOrigin: string;
};

export interface ServerConfig {
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

export function parseServerConfig(
  env: Readonly<Record<string, string | undefined>>,
  nodeEnv: string,
): ServerConfig {
  return {
    database: {
      path: z
        .string()
        .min(1)
        .parse(env["DATABASE_PATH"] ?? (nodeEnv === "test" ? ":memory:" : "data/voltonaut.db")),
      migrationsDir: z
        .string()
        .min(1)
        .parse(env["DRIZZLE_MIGRATIONS_DIR"] ?? "drizzle"),
    },
    mail: parseMailConfig(env, nodeEnv),
    cors: {
      origins: z
        .array(OriginSchema)
        .nonempty()
        .parse(
          (env["CORS_ORIGINS"] ?? "http://localhost:5173,https://voltonaut.stammkneipe.dev")
            .split(",")
            .map((origin) => origin.trim()),
        ),
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

export function testServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return { ...parseServerConfig({}, "test"), ...overrides };
}
