import { z } from "zod";
import { OidcProviderChoiceSchema } from "@voltonaut/shared";

export interface OidcProviderConfig {
  readonly id: string;
  readonly displayName: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly requireEmailVerified: boolean;
  readonly idTokenAlg: "RS256" | "ES256" | "PS256" | "EdDSA";
}

export interface OidcAuthConfig {
  readonly mode: "oidc";
  readonly providers: readonly OidcProviderConfig[];
  readonly allowLoopbackHttp: boolean;
}

const ScopeSchema = z.string().regex(/^[\w.:/-]+$/u);

export function safeOidcUrl(value: string, allowLoopbackHttp: boolean): boolean {
  const parsed = z.string().url().safeParse(value);

  if (!parsed.success) return false;
  const url = new URL(parsed.data);

  return (
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    (url.protocol === "https:" ||
      (allowLoopbackHttp &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  );
}

function providerReader(
  env: Readonly<Record<string, string | undefined>>,
  id: string,
): (key: string) => string | undefined {
  const prefix = `OIDC_${id.toUpperCase().replaceAll("-", "_")}_`;

  // Compose passes unset optional values as empty strings; treat them as absent.
  return (key) => {
    const value = env[`${prefix}${key}`];

    return value === "" ? undefined : value;
  };
}

function parseScopes(raw: string | undefined): string[] {
  return z
    .array(ScopeSchema)
    .nonempty()
    .refine(
      (scopes: readonly string[]) =>
        scopes.includes("openid") && new Set(scopes).size === scopes.length,
    )
    .parse((raw ?? "openid email").split(/\s+/u));
}

function parseProvider(
  env: Readonly<Record<string, string | undefined>>,
  id: string,
  allowLoopbackHttp: boolean,
): OidcProviderConfig {
  const read = providerReader(env, id);

  const urlSchema = z
    .string()
    .url()
    .refine((value) => safeOidcUrl(value, allowLoopbackHttp));

  const redirectUri = urlSchema
    .refine((value) => {
      const url = new URL(value);

      return url.pathname === `/v1/auth/oidc/${id}/callback` && url.search === "";
    })
    .parse(read("REDIRECT_URI"));

  const issuer = urlSchema
    .refine((value) => !value.includes("/.well-known/") && new URL(value).search === "")
    .parse(read("ISSUER"));

  return {
    id,
    issuer,
    redirectUri,
    // The public provider choice contract decides what an ID and a display name may be.
    displayName: OidcProviderChoiceSchema.shape.displayName.parse(
      (read("DISPLAY_NAME") ?? id).trim(),
    ),
    clientId: z.string().trim().min(1).parse(read("CLIENT_ID")),
    clientSecret: z.string().trim().min(1).parse(read("CLIENT_SECRET")),
    scopes: parseScopes(read("SCOPES")),
    requireEmailVerified: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .parse(read("REQUIRE_EMAIL_VERIFIED") ?? "true"),
    idTokenAlg: z.enum(["RS256", "ES256", "PS256", "EdDSA"]).parse(read("ID_TOKEN_ALG") ?? "RS256"),
  };
}

export function parseOidcConfig(
  env: Readonly<Record<string, string | undefined>>,
  allowLoopbackHttp: boolean,
): OidcAuthConfig {
  const ids = z
    .array(OidcProviderChoiceSchema.shape.id)
    .nonempty()
    .refine(
      (values: readonly string[]) => new Set(values).size === values.length,
      "duplicate OIDC provider id",
    )
    .parse((env["OIDC_PROVIDERS"] ?? "").split(",").map((id) => id.trim()));

  return {
    mode: "oidc",
    allowLoopbackHttp,
    providers: ids.map((id) => parseProvider(env, id, allowLoopbackHttp)),
  };
}
