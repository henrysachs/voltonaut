import {
  AuthConfigResponseSchema,
  LogoutResponseSchema,
  MeResponseSchema,
  OidcExchangeRequestSchema,
  SessionResponseSchema,
  type AuthConfigResponse,
  type SessionResponse,
  type User,
} from "@voltonaut/shared";
import {
  browserFetch,
  sendRoute,
  sessionRoute,
  type ApiFetch,
  type RouteTarget,
} from "./apiRoute.js";

export interface AuthTransport {
  readonly mode: (signal: Readonly<AbortSignal>) => Promise<AuthConfigResponse>;
  readonly exchange: (code: string, signal: Readonly<AbortSignal>) => Promise<SessionResponse>;
  readonly me: (token: string, signal: Readonly<AbortSignal>) => Promise<User>;
  readonly logout: (token: string, signal: Readonly<AbortSignal>) => Promise<void>;
}

// Session routes run before or outside a lease, so the caller owns the generation check. Only the
// one-time exchange sends the browser-bound handoff cookie; the others keep the fetch default.
export const sessionRoutes = {
  config: sessionRoute({
    method: "GET",
    path: () => "/v1/auth/config",
    response: AuthConfigResponseSchema,
    credentials: "same-origin",
  }),
  exchange: sessionRoute({
    method: "POST",
    path: () => "/v1/auth/oidc/exchange",
    body: (code: string) => JSON.stringify(OidcExchangeRequestSchema.parse({ code })),
    response: SessionResponseSchema,
    credentials: "include",
  }),
  me: sessionRoute({
    method: "GET",
    path: () => "/v1/me",
    response: MeResponseSchema,
    credentials: "same-origin",
  }),
  logout: sessionRoute({
    method: "POST",
    path: () => "/v1/auth/logout",
    body: null,
    response: LogoutResponseSchema,
    credentials: "same-origin",
  }),
};

export function authTransport(apiOrigin: string, http: ApiFetch = browserFetch): AuthTransport {
  const target = (signal: Readonly<AbortSignal>, bearer?: string): RouteTarget => ({
    apiOrigin,
    http,
    bearer,
    declareJson: "with-body",
    current: () => true,
    signal,
  });

  return {
    mode: (signal) => sendRoute(target(signal), sessionRoutes.config, null),
    exchange: (code, signal) => sendRoute(target(signal), sessionRoutes.exchange, code),
    me: async (token, signal) =>
      (await sendRoute(target(signal, token), sessionRoutes.me, null)).user,
    async logout(token, signal) {
      await sendRoute(target(signal, token), sessionRoutes.logout, null);
    },
  };
}
