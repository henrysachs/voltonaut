import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import { browserFetch, type ApiFetch } from "./apiRoute.js";
import { authTransport, type AuthTransport } from "./authTransport.js";
import { privateAuthTransport, type AccountLease } from "./privateAuthTransport.js";
import { journalRide } from "./testdata/journal.js";
import { batch, checkpoint } from "./progressOutboxTestdata.js";

const BEARER_JSON = "Authorization,Content-Type";

const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

interface Seen {
  readonly server: string;
  readonly credentials: string;
  readonly redirect: string;
  readonly cache: string;
  readonly headers: string;
}

interface RequestInfo {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
}

interface ResponseInfo {
  readonly writeHead: (status: number, headers: Readonly<Record<string, string>>) => object;
  readonly end: (body: string) => object;
}

/** A real HTTP server answering `{}`, which no route accepts, so every call ends as `contract`. */
async function wire() {
  const server: string[] = [];
  const init: Omit<Seen, "server">[] = [];

  const http = createServer((request: RequestInfo, response: ResponseInfo) => {
    server.push(`${request.method ?? ""} ${request.url ?? ""}`);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  });

  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  const port = address instanceof Object ? address.port : undefined;

  if (port === undefined) throw new Error("Missing test port");
  cleanup.add(async () => {
    http.closeAllConnections();
    await new Promise<void>((resolve) => {
      http.close(() => {
        resolve();
      });
    });
  });

  const observed: ApiFetch = (url, options) => {
    init.push({
      credentials: options.credentials,
      redirect: options.redirect,
      cache: options.cache,
      headers: Object.keys(options.headers).toSorted().join(","),
    });

    return browserFetch(url, options);
  };

  return {
    origin: `http://127.0.0.1:${port}`,
    http: observed,
    seen: (): readonly Seen[] =>
      server.map((line, index) => ({
        server: line,
        credentials: init[index]?.credentials ?? "",
        redirect: init[index]?.redirect ?? "",
        cache: init[index]?.cache ?? "",
        headers: init[index]?.headers ?? "",
      })),
  };
}

const RIDE = journalRide.rideId;

const CONSENT = {
  rideId: RIDE,
  payloadHash: "a".repeat(64),
  exportHash: "b".repeat(64),
  exportVersion: "tcx-1",
  connectionGeneration: "connection-a",
  athleteId: "42",
  sourcePolicy: "declared_ble_v1",
  noticeRevision: "virtual-ride-1",
} as const;

const ORDER = {
  requestId: "6f1c2b4e-8d3a-4c5b-9e7f-0a1b2c3d4e5f",
  itemId: "jersey.stripe",
  expectedPriceVolts: 10,
};

type Call = (lease: AccountLease) => Promise<object | null | void>;

// Strava (ADR-017/018) and the OIDC link writes are the only private calls that send cookies.
const PRIVATE_ROUTES: readonly (readonly [string, "omit" | "include", Call])[] = [
  ["GET /v1/me/profile", "omit", (lease) => lease.profile.load()],
  ["PUT /v1/me/profile", "omit", (lease) => lease.profile.save(DEFAULT_RIDER_PROFILE)],
  [`GET /v2/rides?cursor=${RIDE}`, "omit", (lease) => lease.rides.history(RIDE)],
  [`GET /v2/rides/${RIDE}`, "omit", (lease) => lease.rides.detail(RIDE)],
  ["POST /v2/rides", "omit", (lease) => lease.rides.upload(journalRide)],
  ["GET /v1/me/export", "omit", (lease) => lease.data.exportAccount()],
  ["DELETE /v1/me", "omit", (lease) => lease.data.deleteAccount("rider@example.com")],
  ["GET /v1/me/account-status", "omit", (lease) => lease.membership.status()],
  ["GET /v1/admin/users", "omit", (lease) => lease.membership.users(null)],
  [
    "PATCH /v1/admin/users/target/membership",
    "omit",
    (lease) => lease.membership.save("target", { tier: "pro", vip: false }),
  ],
  ["GET /v1/me/progress-consent", "omit", (lease) => lease.progress.status()],
  ["PUT /v1/me/progress-consent", "omit", (lease) => lease.progress.update(true)],
  [
    "POST /v1/progress/checkpoints",
    "omit",
    (lease) => lease.progress.submit(batch([checkpoint({ paused: true })], 1, 2)),
  ],
  ["GET /v1/auth/identities", "omit", (lease) => lease.identities.list()],
  [
    "POST /v1/auth/oidc/authentik/link",
    "include",
    (lease) => lease.identities.startLink("authentik"),
  ],
  ["POST /v1/auth/identities", "include", (lease) => lease.identities.completeLink("c".repeat(43))],
  ["GET /v1/me/volts", "omit", (lease) => lease.shop.balance()],
  ["GET /v1/me/inventory", "omit", (lease) => lease.shop.inventory()],
  ["POST /v1/shop/purchase", "omit", (lease) => lease.shop.purchase(ORDER)],
  ["GET /v1/strava/connection", "include", (lease) => lease.strava.status()],
  [
    "POST /v1/strava/connect-start",
    "include",
    (lease) => lease.strava.start("00000000-0000-4000-8000-000000000003"),
  ],
  ["POST /v1/strava/confirm", "include", (lease) => lease.strava.confirm("c".repeat(43))],
  ["POST /v1/strava/disconnect", "include", (lease) => lease.strava.disconnect()],
  [`GET /v1/strava/rides/${RIDE}`, "include", (lease) => lease.strava.ride(RIDE)],
  [`POST /v1/strava/rides/${RIDE}`, "include", (lease) => lease.strava.upload(CONSENT)],
];

it.each(PRIVATE_ROUTES)("sends %s with credentials %s", async (server, credentials, call) => {
  const w = await wire();

  const lease = privateAuthTransport(w.origin, w.http).authorize({
    token: "private-token",
    userId: "user-a",
    generation: 2,
    signal: new AbortController().signal,
    current: () => true,
  });

  await expect(call(lease)).rejects.toMatchObject({ cause: "contract" });
  expect(w.seen()).toEqual([
    { server, credentials, redirect: "error", cache: "no-store", headers: BEARER_JSON },
  ]);
});

const SESSION_ROUTES: readonly (readonly [
  string,
  string,
  string,
  (transport: AuthTransport, signal: Readonly<AbortSignal>) => Promise<object | void>,
])[] = [
  ["GET /v1/auth/config", "same-origin", "", (transport, signal) => transport.mode(signal)],
  [
    "POST /v1/auth/oidc/exchange",
    "include",
    "Content-Type",
    (transport, signal) => transport.exchange("c".repeat(43), signal),
  ],
  ["GET /v1/me", "same-origin", "Authorization", (transport, signal) => transport.me("t", signal)],
  [
    "POST /v1/auth/logout",
    "same-origin",
    "Authorization",
    (transport, signal) => transport.logout("t", signal),
  ],
];

it.each(SESSION_ROUTES)(
  "sends session route %s with credentials %s through the same path",
  async (server, credentials, headers, call) => {
    const w = await wire();

    await expect(
      call(authTransport(w.origin, w.http), new AbortController().signal),
    ).rejects.toMatchObject({ cause: "contract" });
    expect(w.seen()).toEqual([
      { server, credentials, redirect: "error", cache: "no-store", headers },
    ]);
  },
);
