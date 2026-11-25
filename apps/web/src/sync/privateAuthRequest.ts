import type { AccountExportSchema } from "@voltonaut/shared";

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

export interface LeaseAuthorization {
  readonly token: string;
  readonly userId: string;
  readonly generation: number;
  readonly signal: Readonly<AbortSignal>;
  readonly current: () => boolean;
}

export interface ResponseSchema<T> {
  readonly parse: (...input: readonly [Parameters<typeof AccountExportSchema.parse>[0]]) => T;
}

export type PrivatePath =
  | "/v1/me/account-status"
  | "/v1/admin/users"
  | `/v1/admin/users?cursor=${string}`
  | `/v1/admin/users/${string}/membership`
  | "/v1/me/profile"
  | "/v1/me/export"
  | "/v1/me"
  | "/v1/me/progress-consent"
  | "/v1/progress/checkpoints"
  | "/v2/rides"
  | `/v2/rides?cursor=${string}`
  | `/v2/rides/${string}`
  | "/v1/strava/connection"
  | "/v1/strava/connect-start"
  | "/v1/strava/confirm"
  | "/v1/strava/disconnect"
  | "/v1/auth/identities"
  | `/v1/auth/oidc/${string}/link`
  | `/v1/strava/rides/${string}`;

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

export function authorizedRequest(apiOrigin: string, authorization: LeaseAuthorization) {
  return async function request<T>(
    path: PrivatePath,
    schema: ResponseSchema<T>,
    body?: string,
    credentials: "omit" | "include" = "omit",
    explicitMethod?: "DELETE",
  ): Promise<T> {
    if (!authorization.current()) throw new PrivateRequestError("superseded");

    try {
      const response = await fetch(`${apiOrigin}${path}`, {
        method:
          explicitMethod ??
          (body === undefined
            ? "GET"
            : path === "/v1/me/profile" || path === "/v1/me/progress-consent"
              ? "PUT"
              : path.startsWith("/v1/admin/users/")
                ? "PATCH"
                : "POST"),
        headers: {
          Authorization: `Bearer ${authorization.token}`,
          "Content-Type": "application/json",
        },
        body: body ?? null,
        signal: AbortSignal.any([authorization.signal, AbortSignal.timeout(8000)]),
        cache: "no-store",
        credentials,
        redirect: "error",
      });

      if (!authorization.current()) throw new PrivateRequestError("superseded");
      const value = await parseResponse(response, schema);

      if (!authorization.current()) throw new PrivateRequestError("superseded");

      return value;
    } catch (error) {
      if (!authorization.current()) throw new PrivateRequestError("superseded");
      throw error instanceof PrivateRequestError ? error : new PrivateRequestError("retry");
    }
  };
}

async function parseResponse<T>(
  response: Readonly<Pick<Response, "status" | "json">> & {
    readonly headers: Readonly<Pick<Headers, "get">>;
  },
  schema: ResponseSchema<T>,
): Promise<T> {
  if (response.status !== 200 && response.status !== 204)
    throw new PrivateRequestError(statusFailure(response.status));

  if (response.status === 204) {
    try {
      return schema.parse(null);
    } catch {
      throw new PrivateRequestError("contract");
    }
  }

  if (
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    throw new PrivateRequestError("contract");

  try {
    const raw: unknown = await response.json();

    return schema.parse(raw);
  } catch {
    throw new PrivateRequestError("contract");
  }
}
