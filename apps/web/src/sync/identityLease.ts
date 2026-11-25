import {
  LinkedIdentitiesResponseSchema,
  OidcExchangeRequestSchema,
  OidcLinkStartResponseSchema,
  OidcProviderChoiceSchema,
  type LinkedIdentitiesResponse,
  type OidcLinkStartResponse,
} from "@voltonaut/shared";

/** Login identities of the account; linking needs the session plus a fresh provider login. */
export interface IdentityLease {
  readonly list: () => Promise<LinkedIdentitiesResponse>;
  readonly startLink: (providerId: string) => Promise<OidcLinkStartResponse>;
  readonly completeLink: (code: string) => Promise<LinkedIdentitiesResponse>;
}

export type IdentityPath = "/v1/auth/identities" | `/v1/auth/oidc/${string}/link`;

interface IdentitySchema<T> {
  readonly parse: (
    ...input: readonly [Parameters<typeof LinkedIdentitiesResponseSchema.parse>[0]]
  ) => T;
}

/** The authorized request of an account lease, restricted to the identity routes. */
export type IdentityRequest = <T>(
  path: IdentityPath,
  schema: IdentitySchema<T>,
  body: string | undefined,
  credentials: "omit" | "include",
) => Promise<T>;

function providerSegment(id: string): string {
  return encodeURIComponent(OidcProviderChoiceSchema.shape.id.parse(id));
}

function codeBody(value: string): string {
  return JSON.stringify(OidcExchangeRequestSchema.parse({ code: value }));
}

export function identityLease(request: IdentityRequest): IdentityLease {
  return {
    list: () => request("/v1/auth/identities", LinkedIdentitiesResponseSchema, undefined, "omit"),
    // The link cookie binds this browser; both writes therefore send credentials.
    startLink: (id) =>
      request(
        `/v1/auth/oidc/${providerSegment(id)}/link`,
        OidcLinkStartResponseSchema,
        "{}",
        "include",
      ),
    completeLink: (value) =>
      request("/v1/auth/identities", LinkedIdentitiesResponseSchema, codeBody(value), "include"),
  };
}
