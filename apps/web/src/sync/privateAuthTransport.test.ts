import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";

import { privateAuthTransport } from "./privateAuthTransport.js";
import { localRide } from "./testdata/localRide.js";
import { journalRide } from "./testdata/journal.js";

const cleanup = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

interface RequestInfo {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: { readonly authorization?: string | undefined };
}

interface ResponseInfo {
  readonly writeHead: (status: number, headers: Readonly<Record<string, string>>) => object;
  readonly end: (body: string) => object;
}

async function fixture() {
  const calls: string[] = [];
  const methods: string[] = [];
  let current = true;
  let status = 200;
  let mime = "application/json";
  let body = JSON.stringify({ status: "missing" });

  const server = createServer((request: RequestInfo, response: ResponseInfo) => {
    calls.push(`${request.url ?? ""}:${request.headers.authorization ?? ""}`);
    methods.push(request.method ?? "");
    response.writeHead(status, { "Content-Type": mime });
    response.end(body);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address instanceof Object ? address.port : undefined;

  if (port === undefined) throw new Error("Missing test port");
  cleanup.add(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  return {
    lease: privateAuthTransport(`http://127.0.0.1:${port}`).authorize({
      token: "private-token",
      userId: "user-a",
      generation: 1,
      signal: AbortSignal.timeout(8000),
      current: () => current,
    }),
    calls,
    methods,
    reply: (code: number, type: string, value: string) => {
      status = code;
      mime = type;
      body = value;
    },
    supersede: () => {
      current = false;
    },
  };
}

it("keeps bearer on fixed known paths and rejects caller-controlled ride/cursor URLs", async () => {
  const f = await fixture();
  expect(await f.lease.profile.load()).toEqual({ status: "missing" });
  expect(() => f.lease.rides.detail("https://other.invalid/exfil")).toThrow("Invalid uuid");
  expect(() => f.lease.rides.history("//other.invalid")).toThrow("Invalid uuid");
  expect(f.calls).toEqual(["/v1/me/profile:Bearer private-token"]);
  f.supersede();
  await expect(f.lease.profile.load()).rejects.toMatchObject({ cause: "superseded" });
  expect(f.calls).toHaveLength(1);
});

it("keeps membership credentials on encoded fixed admin paths and uses PATCH without rewriting opaque IDs", async () => {
  const f = await fixture();
  const status = { membership: { tier: "pro", vip: true }, authorization: { role: "user" } };
  f.reply(200, "application/json", JSON.stringify(status));
  await expect(f.lease.membership.status()).resolves.toEqual(status);
  await expect(f.lease.membership.save("existing", { tier: "pro", vip: true })).resolves.toEqual(
    status,
  );
  f.reply(200, "application/json", JSON.stringify({ users: [], nextCursor: null }));
  await f.lease.membership.users("first/second?query");
  expect(f.calls).toEqual([
    "/v1/me/account-status:Bearer private-token",
    "/v1/admin/users/existing/membership:Bearer private-token",
    "/v1/admin/users?cursor=first%2Fsecond%3Fquery:Bearer private-token",
  ]);
  expect(f.methods).toEqual(["GET", "PATCH", "GET"]);
  f.supersede();
  await expect(
    f.lease.membership.save("existing", { tier: "normal", vip: false }),
  ).rejects.toMatchObject({ cause: "superseded" });
  expect(f.methods).toHaveLength(3);
});

it.each([
  [401, "reauth"],
  [403, "forbidden"],
  [404, "missing"],
  [409, "conflict"],
  [422, "contract"],
  [429, "retry"],
  [500, "retry"],
  [201, "contract"],
])("categorizes HTTP %s without leaking the response body", async (status, cause) => {
  const f = await fixture();
  f.reply(status, "application/json", '{"private":"server details"}');
  await expect(f.lease.profile.load()).rejects.toMatchObject({ cause, message: cause });
});

it.each([
  ["text/html", '{"status":"missing"}'],
  ["application/json", '{"status":"present"}'],
  ["application/json", "not json"],
])("rejects malformed or mislabeled response %s", async (mime, body) => {
  const f = await fixture();
  f.reply(200, mime, body);
  await expect(f.lease.profile.load()).rejects.toMatchObject({ cause: "contract" });
});

it("accepts only a valid stored receipt for the exact canonical ride ID", async () => {
  const f = await fixture();

  const receipt = {
    rideId: "00000000-0000-4000-8000-000000000001",
    storage: "stored",
    assessment: { status: "unverified", reason: "legacy_missing_replay" },
  };

  f.reply(200, "application/json", JSON.stringify(receipt));
  await expect(f.lease.rides.upload(localRide)).rejects.toMatchObject({ cause: "contract" });
  f.reply(
    200,
    "application/json; charset=utf-8",
    JSON.stringify({ ...receipt, rideId: localRide.rideId }),
  );
  await expect(f.lease.rides.upload(localRide)).resolves.toMatchObject({
    rideId: localRide.rideId,
  });
});

it("downloads a validated own export and confirms deletion with the Strava revocation outcome", async () => {
  const f = await fixture();

  const exported = {
    schemaVersion: 4,
    exportedAt: "2026-11-20T00:00:00.000Z",
    account: {
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "rider@example.com",
        createdAt: "2026-11-20T00:00:00.000Z",
      },
      membership: { tier: "normal", vip: false },
      authorization: { role: "user" },
      identities: [],
    },
    profile: { status: "missing" },
    rides: [],
    inventory: { items: [], loadout: { loadout: DEFAULT_AVATAR_CONFIG, updatedAt: null } },
    progression: {
      volts: { balance: 0, journal: [] },
      progress: { consent: { status: "missing" }, journals: [], ranges: [] },
    },
    strava: { status: { status: "disabled" }, deliveries: [] },
  };

  f.reply(200, "application/json", JSON.stringify(exported));
  await expect(f.lease.data.exportAccount()).resolves.toEqual(exported);
  f.reply(200, "application/json", "null");
  await expect(f.lease.data.deleteAccount("rider@example.com")).rejects.toMatchObject({
    cause: "contract",
  });
  f.reply(200, "application/json", JSON.stringify({ stravaRevocation: "failed" }));
  await expect(f.lease.data.deleteAccount("rider@example.com")).resolves.toEqual({
    stravaRevocation: "failed",
  });
  f.reply(204, "text/plain", "");
  await expect(f.lease.data.deleteAccount("rider@example.com")).rejects.toMatchObject({
    cause: "contract",
  });
  expect(f.methods).toEqual(["GET", "DELETE", "DELETE", "DELETE"]);
  expect(f.calls).toEqual([
    "/v1/me/export:Bearer private-token",
    "/v1/me:Bearer private-token",
    "/v1/me:Bearer private-token",
    "/v1/me:Bearer private-token",
  ]);
});

it("uses only canonical v2 ride routes for raw journals, history and detail", async () => {
  const f = await fixture();
  const assessment = { status: "unverified", reason: "unknown_revision" };
  f.reply(
    200,
    "application/json",
    JSON.stringify({ rideId: journalRide.rideId, storage: "stored", assessment }),
  );
  await expect(f.lease.rides.upload(journalRide)).resolves.toMatchObject({
    rideId: journalRide.rideId,
  });
  f.reply(200, "application/json", JSON.stringify({ rides: [], nextCursor: null }));
  await f.lease.rides.history(null);
  await f.lease.rides.history(journalRide.rideId.toUpperCase());
  f.reply(200, "application/json", JSON.stringify({ recording: journalRide, assessment }));
  await expect(f.lease.rides.detail(journalRide.rideId)).resolves.toMatchObject({
    recording: journalRide,
  });
  expect(f.calls).toEqual([
    "/v2/rides:Bearer private-token",
    "/v2/rides:Bearer private-token",
    `/v2/rides?cursor=${journalRide.rideId}:Bearer private-token`,
    `/v2/rides/${journalRide.rideId}:Bearer private-token`,
  ]);
});
