import {
  LinkedIdentitiesResponseSchema,
  OidcExchangeRequestSchema,
  OidcLinkStartResponseSchema,
  OidcProviderChoiceSchema,
  type LinkedIdentitiesResponse,
  type OidcLinkStartResponse,
} from "@voltonaut/shared";
import { privateRoute, type PrivateSend } from "./apiRoute.js";

/** Login identities of the account; linking needs the session plus a fresh provider login. */
export interface IdentityPort {
  readonly list: () => Promise<LinkedIdentitiesResponse>;
  readonly startLink: (providerId: string) => Promise<OidcLinkStartResponse>;
  readonly completeLink: (code: string) => Promise<LinkedIdentitiesResponse>;
}

// The link cookie binds this browser; both link writes therefore send credentials.
export const identityRoutes = {
  list: privateRoute({
    method: "GET",
    path: () => "/v1/auth/identities",
    response: LinkedIdentitiesResponseSchema,
    credentials: "omit",
  }),
  startLink: privateRoute({
    method: "POST",
    path: (providerId: string) =>
      `/v1/auth/oidc/${encodeURIComponent(OidcProviderChoiceSchema.shape.id.parse(providerId))}/link`,
    body: () => "{}",
    response: OidcLinkStartResponseSchema,
    credentials: "include",
  }),
  completeLink: privateRoute({
    method: "POST",
    path: () => "/v1/auth/identities",
    body: (code: string) => JSON.stringify(OidcExchangeRequestSchema.parse({ code })),
    response: LinkedIdentitiesResponseSchema,
    credentials: "include",
  }),
};

export function identityPort(send: PrivateSend): IdentityPort {
  return {
    list: () => send(identityRoutes.list, null),
    startLink: (providerId) => send(identityRoutes.startLink, providerId),
    completeLink: (code) => send(identityRoutes.completeLink, code),
  };
}
