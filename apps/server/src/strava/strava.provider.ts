import { z } from "zod";
import type { StravaConfig } from "./strava.config.js";
import { StravaTokensSchema } from "./strava.crypto.js";
import { ApiError } from "../api-error.js";

const TokenResponseSchema = z.object({
  token_type: z.literal("Bearer"),
  access_token: StravaTokensSchema.shape.accessToken,
  refresh_token: StravaTokensSchema.shape.refreshToken,
  expires_at: z.number().int().positive().max(253402300799),
  expires_in: z.number().int().positive().max(86400),
  athlete: z.object({ id: z.number().int().positive().safe() }),
  scope: z.string().max(1024),
});

export function hasWriteScope(scope: string): boolean {
  return scope.split(/[ ,]+/u).includes("activity:write");
}

export function invalidStrava(): ApiError {
  return new ApiError(401, "invalid_strava_connection", "connection is invalid, used, or expired");
}

export function stravaConflict(): ApiError {
  return new ApiError(
    409,
    "strava_connection_conflict",
    "disconnect the existing connection before reconnecting",
  );
}

export function stravaCapacityExceeded(): ApiError {
  return new ApiError(429, "rate_limited", "too many connection attempts");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Native Response owns a mutable stream reader; this boundary consumes it once.
async function boundedBody(response: Readonly<Response>): Promise<string> {
  const reader = response.body?.getReader();

  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- Bounded response streams must be read sequentially to enforce the byte limit.
      const item = await reader.read();

      if (item.done) break;
      const chunk = z.instanceof(Uint8Array).parse(item.value);
      length += chunk.byteLength;

      if (length > 16_384) throw invalidStrava();
      chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
  }
}

export class StravaProvider {
  public constructor(private readonly config: StravaConfig) {}

  public authorizationUrl(state: string): string {
    const config = this.enabledConfig();
    const url = new URL("/oauth/authorize", config.providerOrigin);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      approval_prompt: "force",
      scope: "activity:write",
      state,
    }).toString();

    return url.href;
  }

  public async exchange(code: string, nowMs: number) {
    const config = this.enabledConfig();

    try {
      const response = await fetch(new URL("/oauth/token", config.providerOrigin), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(2000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          grant_type: "authorization_code",
        }),
      });

      if (response.status !== 200) {
        await response.body?.cancel();
        throw invalidStrava();
      }

      const token = TokenResponseSchema.parse(JSON.parse(await boundedBody(response)));

      if (!hasWriteScope(token.scope) || token.expires_at * 1000 <= nowMs) throw invalidStrava();

      return {
        athleteId: String(token.athlete.id),
        accessExpiresAt: token.expires_at * 1000,
        tokens: { accessToken: token.access_token, refreshToken: token.refresh_token },
      };
    } catch {
      throw invalidStrava();
    }
  }

  public async revoke(refreshToken: string): Promise<boolean> {
    const config = this.enabledConfig();

    try {
      const response = await fetch(new URL("/oauth/revoke", config.providerOrigin), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(2000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" }),
      });

      await response.body?.cancel();

      return response.status === 200;
    } catch {
      return false;
    }
  }

  public enabledConfig(): Extract<StravaConfig, { mode: "enabled" }> {
    if (this.config.mode !== "enabled")
      throw new ApiError(404, "not_found", "Strava connection disabled");

    return this.config;
  }
}
