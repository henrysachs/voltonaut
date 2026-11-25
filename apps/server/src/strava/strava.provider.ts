import { z } from "zod";
import type { StravaConfig } from "./strava.config.js";
import { StravaTokensSchema } from "./strava.crypto.js";
import { ApiError } from "../api-error.js";
import { uploadReceipt, uploadState } from "./strava.upload-provider.js";
import type { SubmitResult, PollResult, RefreshResult } from "./strava.upload-provider.js";
import type { StravaReceipt } from "@voltonaut/shared";
import { boundedBody, isJsonResponse, stravaMultipart } from "./strava.provider-http.js";
import { verifyAthlete } from "./strava.authorization-provider.js";
import type { CommittedAttempt } from "./strava.delivery-store.js";

const RefreshResponseSchema = z.object({
  token_type: z.literal("Bearer"),
  access_token: StravaTokensSchema.shape.accessToken,
  refresh_token: StravaTokensSchema.shape.refreshToken,
  expires_at: z.number().int().positive().max(253402300799),
});

interface ResourceInput {
  readonly accessToken: string;
  readonly signal: Readonly<AbortSignal>;
  readonly onHeaders: (headers: Readonly<Headers>, status: number) => void;
}

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

export function stravaRegistrationRequired(): ApiError {
  return new ApiError(503, "strava_registration_required", "Strava webhook registration required");
}

export class StravaProvider {
  public constructor(private readonly config: StravaConfig) {}

  public verifyAuthorization(input: ResourceInput & { readonly athleteId: string }) {
    return verifyAthlete({ ...input, providerOrigin: this.enabledConfig().providerOrigin });
  }

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

      if (response.status !== 200 || !isJsonResponse(response)) {
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

  public async refresh(
    refreshToken: string,
    nowMs: number,
    signal: Readonly<AbortSignal>,
  ): Promise<RefreshResult> {
    const config = this.enabledConfig();

    try {
      const response = await fetch(new URL("/oauth/token", config.providerOrigin), {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      if (response.status === 400 || response.status === 401) {
        await response.body?.cancel();

        return { kind: "unknown" };
      }

      if (response.status !== 200 || !isJsonResponse(response)) {
        await response.body?.cancel();

        return { kind: "unknown" };
      }

      const token = RefreshResponseSchema.parse(JSON.parse(await boundedBody(response)));

      if (token.expires_at * 1000 <= nowMs) return { kind: "unknown" };

      return {
        kind: "refreshed",
        tokens: { accessToken: token.access_token, refreshToken: token.refresh_token },
        accessExpiresAt: token.expires_at * 1000,
      };
    } catch {
      return { kind: "unknown" };
    }
  }

  /** Sends the single POST of an attempt that `StravaDeliveryStore.dispatch` already committed. */
  public async submit(
    input: ResourceInput & { readonly attempt: CommittedAttempt; readonly tcx: string },
  ): Promise<SubmitResult> {
    const { externalId } = input.attempt;
    const form = stravaMultipart(input.tcx, externalId);

    try {
      const response = await fetch(
        new URL("/api/v3/uploads", this.enabledConfig().providerOrigin),
        {
          method: "POST",
          headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
          body: form,
          signal: input.signal,
          redirect: "error",
        },
      );

      input.onHeaders(response.headers, response.status);

      if ([400, 401, 403, 429].includes(response.status)) {
        await response.body?.cancel();

        return {
          kind: "refused",
          reason:
            response.status === 429
              ? "rate_limit"
              : response.status === 400
                ? "file"
                : "authorization",
        };
      }

      if (response.status !== 201 || !isJsonResponse(response)) {
        await response.body?.cancel();

        return { kind: "unknown", reason: "protocol" };
      }

      const body = await boundedBody(response);
      const receipt = uploadReceipt(body, externalId);

      if (receipt === undefined) return { kind: "unknown", reason: "protocol" };

      return { kind: "known", receipt, state: uploadState(body) ?? { kind: "processing" } };
    } catch {
      return { kind: "unknown", reason: "response_lost" };
    }
  }

  public async poll(
    input: ResourceInput & { readonly receipt: StravaReceipt },
  ): Promise<PollResult> {
    try {
      const response = await fetch(
        new URL(`/api/v3/uploads/${input.receipt.uploadId}`, this.enabledConfig().providerOrigin),
        {
          headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
          signal: input.signal,
          redirect: "error",
        },
      );

      input.onHeaders(response.headers, response.status);

      if (response.status !== 200) {
        await response.body?.cancel();

        return {
          kind: "deferred",
          reason:
            response.status === 401
              ? "authorization"
              : response.status === 429
                ? "rate_limit"
                : "network",
        };
      }

      if (!isJsonResponse(response)) {
        await response.body?.cancel();

        return { kind: "deferred", reason: "protocol" };
      }

      const body = await boundedBody(response);
      const receipt = uploadReceipt(body, input.receipt.externalId);
      const state = uploadState(body);

      return receipt?.uploadId === input.receipt.uploadId && state !== undefined
        ? { kind: "observed", state }
        : { kind: "deferred", reason: "protocol" };
    } catch {
      return { kind: "deferred", reason: "network" };
    }
  }

  public enabledConfig(): Extract<StravaConfig, { mode: "enabled" }> {
    if (this.config.mode !== "enabled")
      throw new ApiError(404, "not_found", "Strava connection disabled");

    return this.config;
  }
}
