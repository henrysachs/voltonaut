import {
  ProfileInputSchema,
  ProfileStateSchema,
  RideDetailSchema,
  RideIdSchema,
  RideListSchema,
  RideReceiptSchema,
  RideUploadSchema,
  type ProfileInput,
  type ProfileState,
  type RideDetail,
  type RideList,
  type RideReceipt,
  type RideUpload,
} from "@voltonaut/shared";
import type { ProfileWriteLease } from "./profile-store.js";

export type SyncFailure =
  | "reauth"
  | "forbidden"
  | "missing"
  | "conflict"
  | "contract"
  | "retry"
  | "superseded";

export class PrivateRequestError extends Error {
  constructor(override readonly cause: SyncFailure) {
    super(cause);
  }
}

export interface AccountLease extends ProfileWriteLease {
  readonly apiOrigin: string;
  readonly userId: string;
  readonly generation: number;
  readonly current: () => boolean;
  readonly profile: () => Promise<ProfileState>;
  readonly saveProfile: (profile: ProfileInput) => Promise<ProfileState>;
  readonly history: (cursor: string | null) => Promise<RideList>;
  readonly detail: (rideId: string) => Promise<RideDetail>;
  readonly upload: (ride: RideUpload) => Promise<RideReceipt>;
}

interface LeaseAuthorization {
  readonly token: string;
  readonly userId: string;
  readonly generation: number;
  readonly signal: Readonly<AbortSignal>;
  readonly current: () => boolean;
}

export interface PrivateAuthTransport {
  readonly authorize: (authorization: LeaseAuthorization) => AccountLease;
}

function statusFailure(status: number): SyncFailure {
  switch (status) {
    case 401:
      return "reauth";
    case 403:
      return "forbidden";
    case 404:
      return "missing";
    case 409:
      return "conflict";
    default:
      return status >= 500 || status === 429 ? "retry" : "contract";
  }
}

interface ResponseSchema<T> {
  readonly parse: (...input: readonly [Parameters<typeof ProfileStateSchema.parse>[0]]) => T;
}

export function privateAuthTransport(apiOrigin: string): PrivateAuthTransport {
  return {
    authorize(authorization) {
      const request = authorizedRequest(apiOrigin, authorization);

      return {
        apiOrigin,
        userId: authorization.userId,
        generation: authorization.generation,
        signal: authorization.signal,
        current: authorization.current,
        profile: () => request("/v1/me/profile", ProfileStateSchema),
        saveProfile: (profile) =>
          request(
            "/v1/me/profile",
            ProfileStateSchema,
            JSON.stringify(ProfileInputSchema.parse(profile)),
          ),
        history: (cursor) =>
          request(
            cursor === null ? "/v1/rides" : `/v1/rides?cursor=${RideIdSchema.parse(cursor)}`,
            RideListSchema,
          ),
        detail: (rideId) => request(`/v1/rides/${RideIdSchema.parse(rideId)}`, RideDetailSchema),
        async upload(ride) {
          const payload = RideUploadSchema.parse(ride);
          const receipt = await request("/v1/rides", RideReceiptSchema, JSON.stringify(payload));

          if (receipt.rideId !== payload.rideId) throw new PrivateRequestError("contract");

          return receipt;
        },
      };
    },
  };
}

function authorizedRequest(apiOrigin: string, authorization: LeaseAuthorization) {
  return async function request<T>(
    path: string,
    schema: ResponseSchema<T>,
    body?: string,
  ): Promise<T> {
    if (!authorization.current()) throw new PrivateRequestError("superseded");

    try {
      const response = await fetch(`${apiOrigin}${path}`, {
        method: body === undefined ? "GET" : path === "/v1/me/profile" ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${authorization.token}`,
          "Content-Type": "application/json",
        },
        body: body ?? null,
        signal: AbortSignal.any([authorization.signal, AbortSignal.timeout(8000)]),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });

      if (!authorization.current()) throw new PrivateRequestError("superseded");

      if (response.status !== 200) throw new PrivateRequestError(statusFailure(response.status));

      if (
        response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      )
        throw new PrivateRequestError("contract");

      const raw: unknown = await response.json().catch(() => {
        throw new PrivateRequestError("contract");
      });

      if (!authorization.current()) throw new PrivateRequestError("superseded");

      try {
        return schema.parse(raw);
      } catch {
        throw new PrivateRequestError("contract");
      }
    } catch (error) {
      if (!authorization.current()) throw new PrivateRequestError("superseded");
      throw error instanceof PrivateRequestError ? error : new PrivateRequestError("retry");
    }
  };
}
