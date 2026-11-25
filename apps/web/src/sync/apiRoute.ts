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

/**
 * Token-free identity of an account lease (E5-09): which account on which API origin, the session
 * generation it belongs to, and whether it still holds.
 */
export interface LeaseBinding {
  readonly apiOrigin: string;
  readonly userId: string;
  readonly generation: number;
  readonly signal: Readonly<AbortSignal>;
  readonly current: () => boolean;
}

export interface ResponseSchema<T> {
  readonly parse: (...input: readonly [Parameters<typeof AccountExportSchema.parse>[0]]) => T;
}

/** Routes an authorized account lease may call; every one carries the lease's bearer. */
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
  | "/v1/me/volts"
  | "/v1/me/inventory"
  | "/v1/shop/purchase"
  | `/v1/strava/rides/${string}`;

/** Routes that discover, establish, confirm or revoke a session; they run outside any lease. */
export type SessionPath =
  | "/v1/auth/config"
  | "/v1/auth/oidc/exchange"
  | "/v1/me"
  | "/v1/auth/logout";

/**
 * `include` only where a browser-bound cookie belongs to the call (ADR-017/018, OIDC binding);
 * `same-origin` keeps the fetch default for session calls that never needed a cookie.
 */
export type RouteCredentials = "omit" | "include" | "same-origin";

/**
 * One API call as data. Path and body builders validate caller input with the shared schemas;
 * they run synchronously, so invalid input throws before any gate check or network access.
 * `body: null` is a write without payload.
 */
export type ApiRoute<In, Out, Path extends PrivatePath | SessionPath> =
  | {
      readonly method: "GET";
      readonly path: (input: In) => Path;
      readonly response: ResponseSchema<Out>;
      readonly credentials: RouteCredentials;
    }
  | {
      readonly method: "PUT" | "POST" | "PATCH" | "DELETE";
      readonly path: (input: In) => Path;
      readonly body: ((input: In) => string) | null;
      readonly response: ResponseSchema<Out>;
      readonly credentials: RouteCredentials;
    };

export type PrivateRoute<In, Out> = ApiRoute<In, Out, PrivatePath>;

export type SessionRoute<In, Out> = ApiRoute<In, Out, SessionPath>;

/** Infers a private route's input from its builders; routes without input take `null`. */
export function privateRoute<Out, In = null>(route: PrivateRoute<In, Out>): PrivateRoute<In, Out> {
  return route;
}

export function sessionRoute<Out, In = null>(route: SessionRoute<In, Out>): SessionRoute<In, Out> {
  return route;
}

/** Sends one private route with the lease's bearer, generation gate and abort signal. */
export type PrivateSend = <In, Out>(route: PrivateRoute<In, Out>, input: In) => Promise<Out>;

export interface ApiRequestInit {
  readonly method: ApiRoute<never, never, PrivatePath>["method"];
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly signal: Readonly<AbortSignal>;
  readonly cache: "no-store";
  readonly credentials: RouteCredentials;
  readonly redirect: "error";
}

export type ApiResponse = Readonly<Pick<Response, "status" | "json">> & {
  readonly headers: Readonly<Pick<Headers, "get">>;
};

/** The fetch seam: the browser passes the global fetch, contract tests observe the init. */
export type ApiFetch = (url: string, init: ApiRequestInit) => Promise<ApiResponse>;

export const browserFetch: ApiFetch = (url, init) => fetch(url, init);

/**
 * Who sends a request. `current` supersedes stale answers before fetch, after fetch and after
 * parsing. Private leases declare JSON on every request as before; session calls only with a body,
 * so the public config read stays a simple request.
 */
export interface RouteTarget {
  readonly apiOrigin: string;
  readonly http: ApiFetch;
  readonly bearer: string | undefined;
  readonly declareJson: "always" | "with-body";
  readonly current: () => boolean;
  readonly signal: Readonly<AbortSignal>;
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

function requestHeaders(target: RouteTarget, body: string | null): ApiRequestInit["headers"] {
  const json = target.declareJson === "always" || body !== null;

  if (target.bearer === undefined) return json ? { "Content-Type": "application/json" } : {};
  const authorization = `Bearer ${target.bearer}`;

  return json
    ? { Authorization: authorization, "Content-Type": "application/json" }
    : { Authorization: authorization };
}

/**
 * The single fetch, parse and failure path of every API call of the browser client. Not async:
 * path and body builders throw synchronously on invalid input.
 */
export function sendRoute<In, Out, Path extends PrivatePath | SessionPath>(
  target: RouteTarget,
  route: ApiRoute<In, Out, Path>,
  input: In,
): Promise<Out> {
  const path = route.path(input);
  const body = route.method === "GET" || route.body === null ? null : route.body(input);

  return deliver(target, route.response, `${target.apiOrigin}${path}`, {
    method: route.method,
    headers: requestHeaders(target, body),
    body,
    signal: AbortSignal.any([target.signal, AbortSignal.timeout(8000)]),
    cache: "no-store",
    credentials: route.credentials,
    redirect: "error",
  });
}

async function deliver<Out>(
  target: RouteTarget,
  schema: ResponseSchema<Out>,
  url: string,
  init: ApiRequestInit,
): Promise<Out> {
  if (!target.current()) throw new PrivateRequestError("superseded");

  try {
    const response = await target.http(url, init);

    if (!target.current()) throw new PrivateRequestError("superseded");
    const value = await parseResponse(response, schema);

    if (!target.current()) throw new PrivateRequestError("superseded");

    return value;
  } catch (error) {
    if (!target.current()) throw new PrivateRequestError("superseded");
    throw error instanceof PrivateRequestError ? error : new PrivateRequestError("retry");
  }
}

async function parseResponse<T>(response: ApiResponse, schema: ResponseSchema<T>): Promise<T> {
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

    // Only an empty 204 confirms a deletion or revocation; a 200 must carry a value.
    if (raw === null) throw new PrivateRequestError("contract");

    return schema.parse(raw);
  } catch {
    throw new PrivateRequestError("contract");
  }
}
