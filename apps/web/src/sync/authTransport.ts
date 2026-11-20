import {
  AuthConfigResponseSchema,
  MeResponseSchema,
  OidcExchangeRequestSchema,
  SessionResponseSchema,
  type AuthConfigResponse,
  type SessionResponse,
  type User,
} from "@voltonaut/shared";

export interface AuthTransport {
  readonly mode: (signal: Readonly<AbortSignal>) => Promise<AuthConfigResponse>;
  readonly exchange: (code: string, signal: Readonly<AbortSignal>) => Promise<SessionResponse>;
  readonly me: (token: string, signal: Readonly<AbortSignal>) => Promise<User>;
  readonly logout: (token: string, signal: Readonly<AbortSignal>) => Promise<void>;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Fetch owns RequestInit, including native Headers and AbortSignal contracts.
async function request(url: string, init: Readonly<RequestInit>): Promise<Response> {
  const response = await fetch(url, { ...init, cache: "no-store" });

  if (!response.ok) throw new Error("Authentifizierung nicht verfügbar oder abgelaufen.");

  return response;
}

export function authTransport(origin: string): AuthTransport {
  return {
    async mode(signal) {
      const response = await request(`${origin}/v1/auth/config`, { signal });
      const raw: unknown = await response.json();

      return AuthConfigResponseSchema.parse(raw);
    },
    async exchange(code, signal) {
      const response = await request(`${origin}/v1/auth/oidc/exchange`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(OidcExchangeRequestSchema.parse({ code })),
        signal,
      });

      const raw: unknown = await response.json();

      return SessionResponseSchema.parse(raw);
    },
    async me(token, signal) {
      const response = await request(`${origin}/v1/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });

      const raw: unknown = await response.json();

      return MeResponseSchema.parse(raw).user;
    },
    async logout(token, signal) {
      const response = await request(`${origin}/v1/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });

      if (response.status !== 204) throw new Error("Widerruf nicht bestätigt.");
    },
  };
}
