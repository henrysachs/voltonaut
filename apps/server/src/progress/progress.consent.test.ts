import request from "supertest";
import { afterEach, expect, it } from "vitest";

import {
  ProgressConsentStateSchema,
  ProgressConsentUpdateSchema,
  type ProgressConsentState,
  type ProgressConsentUpdate,
} from "@voltonaut/shared";
import { AuthService } from "../auth/auth.service.js";
import { hashToken } from "../auth/tokens.js";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import type { DatabaseReader, SupertestResponsePort } from "../testing/test-app.spec.js";
import { ProgressConsentService } from "./progress.consent.service.js";

const NOW_MS = Date.parse("2026-11-25T12:00:00.000Z");
const cleanup = new Set<() => Promise<void>>();

type RideSourcePolicy = "disabled" | "declared_ble_v1";

interface ConsentRequestBody {
  readonly enabled: boolean;
  readonly sessionGeneration: number;
  readonly userId?: string;
}

interface StoredConsent {
  readonly user_id: string;
  readonly version: number;
  readonly enabled: number;
  readonly session_hash: string;
  readonly session_generation: number;
  readonly updated_at: number;
}

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

async function fixture(rideSourcePolicy: RideSourcePolicy = "declared_ble_v1") {
  let nowMs = NOW_MS;

  const testApp = await createTestApp({
    clock: { nowMs: () => nowMs },
    config: { rideSourcePolicy },
  });

  cleanup.add(() => testApp.app.close());

  const owner = await loginTestUser(testApp.app, testApp.mail, "owner@example.com");
  const other = await loginTestUser(testApp.app, testApp.mail, "other@example.com", "127.0.0.1:2");

  return {
    app: testApp.app,
    server: httpServerOf(testApp.app),
    owner,
    other,
    origin: testApp.config.clientOrigin,
    mail: testApp.mail,
    progress: testApp.app.get<ProgressConsentService>(ProgressConsentService),
    auth: testApp.app.get<AuthService>(AuthService),
    db: getDatabase(testApp.app),
    setNowMs: (value: number) => {
      nowMs = value;
    },
  };
}

function updateBody(enabled: boolean, sessionGeneration: number): ProgressConsentUpdate {
  return ProgressConsentUpdateSchema.parse({ enabled, sessionGeneration });
}

function stateOf(response: SupertestResponsePort): ProgressConsentState {
  return ProgressConsentStateSchema.parse(bodyOf(response));
}

function expectedState(
  version: number,
  enabled: boolean,
  sessionGeneration: number,
  rewardsAvailable: boolean,
): ProgressConsentState {
  return { version, enabled, sessionGeneration, rewardsAvailable };
}

function getConsent(server: Readonly<ReturnType<typeof httpServerOf>>, sessionToken: string) {
  return request(server).get("/v1/me/progress-consent").set(bearer(sessionToken));
}

function putConsent(
  server: Readonly<ReturnType<typeof httpServerOf>>,
  sessionToken: string,
  origin: string | undefined,
  body: Readonly<ConsentRequestBody>,
) {
  const pending = request(server).put("/v1/me/progress-consent").set(bearer(sessionToken));

  if (origin !== undefined) pending.set("Origin", origin);

  return pending.send(body);
}

function storedConsent(db: DatabaseReader, userId: string): StoredConsent | undefined {
  return db.$client
    .prepare<[string], StoredConsent>(
      "SELECT user_id, version, enabled, session_hash, session_generation, updated_at FROM progress_consents WHERE user_id = ?",
    )
    .get(userId);
}

it("requires bearer auth and returns uncached disabled version zero without creating a row", async () => {
  const f = await fixture();

  await request(f.server).get("/v1/me/progress-consent").expect(401);

  const response = await getConsent(f.server, f.owner.sessionToken).expect(200);

  expect(stateOf(response)).toEqual(expectedState(0, false, 1, true));
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(storedConsent(f.db, f.owner.user.id)).toBeUndefined();
});

it("requires the exact origin and strict input before granting version one", async () => {
  const f = await fixture();
  const body = updateBody(true, 7);

  await putConsent(f.server, f.owner.sessionToken, undefined, body).expect(403);
  await putConsent(f.server, f.owner.sessionToken, "https://evil.invalid", body).expect(403);
  await putConsent(f.server, f.owner.sessionToken, f.origin, {
    enabled: true,
    sessionGeneration: -1,
  }).expect(422);
  expect(storedConsent(f.db, f.owner.user.id)).toBeUndefined();

  const response = await putConsent(f.server, f.owner.sessionToken, f.origin, body).expect(200);

  expect(stateOf(response)).toEqual(expectedState(1, true, 7, true));
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(storedConsent(f.db, f.owner.user.id)).toEqual({
    user_id: f.owner.user.id,
    version: 1,
    enabled: 1,
    session_hash: hashToken(f.owner.sessionToken),
    session_generation: 7,
    updated_at: NOW_MS,
  });
});

it("keeps exact retries unchanged and adopts a local generation without bumping the version", async () => {
  const f = await fixture();

  const put = (body: ProgressConsentUpdate) =>
    putConsent(f.server, f.owner.sessionToken, f.origin, body);

  const granted = await put(updateBody(true, 4)).expect(200);
  const before = storedConsent(f.db, f.owner.user.id);
  const retry = await put(updateBody(true, 4)).expect(200);

  expect(stateOf(retry)).toEqual(stateOf(granted));
  expect(storedConsent(f.db, f.owner.user.id)).toEqual(before);

  f.setNowMs(NOW_MS + 1000);
  const renewed = await put(updateBody(true, 9)).expect(200);

  expect(stateOf(renewed)).toEqual(expectedState(1, true, 9, true));
  expect(storedConsent(f.db, f.owner.user.id)).toEqual({
    user_id: f.owner.user.id,
    version: 1,
    enabled: 1,
    session_hash: hashToken(f.owner.sessionToken),
    session_generation: 9,
    updated_at: NOW_MS + 1000,
  });
});

it("versions revocation and a later grant while keeping an unchanged revocation idempotent", async () => {
  const f = await fixture();

  const put = (enabled: boolean, sessionGeneration: number) =>
    putConsent(f.server, f.owner.sessionToken, f.origin, updateBody(enabled, sessionGeneration));

  const granted = await put(true, 1).expect(200);
  const revoked = await put(false, 2).expect(200);
  const repeated = await put(false, 5).expect(200);
  const grantedAgain = await put(true, 6).expect(200);

  expect(stateOf(granted).version).toBe(1);
  expect(stateOf(revoked)).toEqual(expectedState(2, false, 2, true));
  expect(stateOf(repeated)).toEqual(expectedState(2, false, 5, true));
  expect(stateOf(grantedAgain)).toEqual(expectedState(3, true, 6, true));
});

it("hides active consent after re-login until the new session explicitly rebinds", async () => {
  const f = await fixture();

  const first = await putConsent(
    f.server,
    f.owner.sessionToken,
    f.origin,
    updateBody(true, 1),
  ).expect(200);

  const boundRow = storedConsent(f.db, f.owner.user.id);
  const nextSession = await loginTestUser(f.app, f.mail, "owner@example.com", "127.0.0.1:3");

  const unbound = await getConsent(f.server, nextSession.sessionToken).expect(200);

  expect(stateOf(first).version).toBe(1);
  expect(stateOf(unbound)).toEqual(expectedState(1, false, 1, true));
  expect(storedConsent(f.db, f.owner.user.id)).toEqual(boundRow);

  const changed = await putConsent(
    f.server,
    nextSession.sessionToken,
    f.origin,
    updateBody(true, 2),
  ).expect(200);

  expect(stateOf(changed)).toEqual(expectedState(2, true, 2, true));
  expect(storedConsent(f.db, f.owner.user.id)?.session_hash).toBe(
    hashToken(nextSession.sessionToken),
  );

  const before = storedConsent(f.db, f.owner.user.id);
  f.auth.logout(hashToken(nextSession.sessionToken));

  expect(() =>
    f.progress.update(f.owner.user.id, hashToken(nextSession.sessionToken), 3, false, NOW_MS),
  ).toThrow(expect.objectContaining({ status: 401, code: "unauthorized" }));
  expect(storedConsent(f.db, f.owner.user.id)).toEqual(before);
  await putConsent(f.server, nextSession.sessionToken, f.origin, updateBody(false, 3)).expect(401);
});

it("refuses grants without writing while source rewards are disabled but still allows revocation", async () => {
  const f = await fixture("disabled");
  const missing = await getConsent(f.server, f.owner.sessionToken).expect(200);

  expect(stateOf(missing)).toEqual(expectedState(0, false, 1, false));

  const refused = await putConsent(
    f.server,
    f.owner.sessionToken,
    f.origin,
    updateBody(true, 1),
  ).expect(403);

  expect(bodyOf(refused)).toMatchObject({ error: { code: "progress_source_disabled" } });
  expect(storedConsent(f.db, f.owner.user.id)).toBeUndefined();

  const revoked = await putConsent(
    f.server,
    f.owner.sessionToken,
    f.origin,
    updateBody(false, 2),
  ).expect(200);

  expect(stateOf(revoked)).toEqual(expectedState(1, false, 2, false));
});

it("never accepts a foreign owner through the body or exposes another account's consent", async () => {
  const f = await fixture();
  await putConsent(f.server, f.owner.sessionToken, f.origin, updateBody(true, 1)).expect(200);
  const ownerBefore = storedConsent(f.db, f.owner.user.id);

  const otherState = await getConsent(f.server, f.other.sessionToken).expect(200);

  expect(stateOf(otherState)).toEqual(expectedState(0, false, 1, true));

  await putConsent(f.server, f.other.sessionToken, f.origin, {
    userId: f.owner.user.id,
    enabled: false,
    sessionGeneration: 1,
  }).expect(422);
  expect(storedConsent(f.db, f.owner.user.id)).toEqual(ownerBefore);
  expect(storedConsent(f.db, f.other.user.id)).toBeUndefined();

  const otherGranted = await putConsent(
    f.server,
    f.other.sessionToken,
    f.origin,
    updateBody(true, 1),
  ).expect(200);

  expect(stateOf(otherGranted)).toEqual(expectedState(1, true, 1, true));
  expect(storedConsent(f.db, f.owner.user.id)).toEqual(ownerBefore);
});
