import request from "supertest";
import { expect } from "vitest";

import { RideProgressCheckpointSchema } from "@voltonaut/shared";
import type {
  ErrorCode,
  NativeTickFacts,
  ProgressCheckpointBatch,
  RideProgressCheckpoint,
  RideProgressMetadata,
} from "@voltonaut/shared";

import { ApiError } from "../api-error.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import { hashToken } from "../auth/tokens.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { EconomyService } from "../economy/economy.service.js";
import {
  bearer,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import type { DatabaseReader, TestSession } from "../testing/test-app.spec.js";
import { ProgressService } from "./progress.service.js";

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Fixture is a readonly test-handle alias that the rule cannot resolve. */
export const NOW_MS = Date.parse("2026-11-25T12:00:00.000Z");
export const JOURNAL_ID = "50000000-0000-4000-8000-000000000001";
export const OTHER_JOURNAL_ID = "50000000-0000-4000-8000-000000000002";
export const SESSION_GENERATION = 1;
export const CONSENT_VERSION = 1;

export const metadata = {
  journalId: JOURNAL_ID,
  source: "ble",
  clockScale: 1,
  physicsRevision: "engine-v1",
  routeId: "test-loop",
  routeRevision: "1",
  physics: {
    massKg: 75,
    bikeMassKg: 8,
    cdaM2: 0.32,
    crr: 0.004,
    wheelCircM: 2.105,
  },
} satisfies RideProgressMetadata;

export const quality = {
  paused: false,
  dataAgeS: 0,
  clockSkipped: false,
} satisfies RideProgressCheckpoint["quality"];

export interface FactOptions {
  readonly powerW?: number;
  readonly cadenceRpm?: number;
  readonly timeS?: number;
  readonly distanceM?: number;
  readonly elevationGainM?: number;
  readonly energyKj?: number;
}

export interface CheckpointOptions {
  readonly sequence?: number;
  readonly startTick?: number;
  readonly factCount?: number;
  readonly startedAtMs?: number;
  readonly endedAtMs?: number;
  readonly journalId?: string;
  readonly source?: RideProgressMetadata["source"];
  readonly clockScale?: number;
  readonly physicsRevision?: string;
  readonly routeId?: string;
  readonly routeRevision?: string;
  readonly physics?: RideProgressMetadata["physics"];
  readonly quality?: RideProgressCheckpoint["quality"];
  readonly facts?: readonly NativeTickFacts[];
  readonly factOptions?: FactOptions;
}

export interface ConsentOptions {
  readonly version?: number;
  readonly enabled?: boolean;
  readonly sessionGeneration?: number;
  readonly sessionHash?: string;
}

export type Fixture = Readonly<{
  server: Readonly<ReturnType<typeof httpServerOf>>;
  owner: TestSession;
  other: TestSession;
  service: ProgressService;
  economy: EconomyService;
  db: ServerDatabase;
}>;

export interface StoredProgressRange {
  readonly id: string;
  readonly journal_id: string;
  readonly user_id: string;
  readonly start_tick: number;
  readonly end_tick: number;
  readonly payload_hash: string;
  readonly payload_json: string;
  readonly cumulative_facts_json: string;
  readonly receipt_json: string;
  readonly created_at: number;
}

const cleanup = new Set<() => Promise<void>>();

export async function closeProgressApps(): Promise<void> {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
}

export function fact(options: FactOptions = {}): NativeTickFacts {
  const powerW = options.powerW ?? 200;
  const timeS = options.timeS ?? 0.05;

  return {
    powerW,
    cadenceRpm: options.cadenceRpm ?? 90,
    timeS,
    distanceM: options.distanceM ?? 1,
    elevationGainM: options.elevationGainM ?? 0.1,
    energyKj: options.energyKj ?? (powerW * timeS) / 1000,
  };
}

export function checkpoint(options: CheckpointOptions = {}): RideProgressCheckpoint {
  const facts =
    options.facts ??
    Array.from({ length: options.factCount ?? 1 }, () => fact(options.factOptions));

  const startTick = options.startTick ?? 0;
  const startedAtMs = options.startedAtMs ?? NOW_MS;

  return RideProgressCheckpointSchema.parse({
    schemaVersion: 1,
    ...metadata,
    journalId: options.journalId ?? metadata.journalId,
    source: options.source ?? metadata.source,
    clockScale: options.clockScale ?? metadata.clockScale,
    physicsRevision: options.physicsRevision ?? metadata.physicsRevision,
    routeId: options.routeId ?? metadata.routeId,
    routeRevision: options.routeRevision ?? metadata.routeRevision,
    physics: options.physics ?? metadata.physics,
    quality: options.quality ?? quality,
    sequence: options.sequence ?? 0,
    startTick,
    endTick: startTick + facts.length,
    startedAtMs,
    endedAtMs: options.endedAtMs ?? startedAtMs + facts.length * 50,
    facts,
  });
}

export function batch(
  checkpoints: readonly RideProgressCheckpoint[],
  consentVersion = CONSENT_VERSION,
  sessionGeneration = SESSION_GENERATION,
): ProgressCheckpointBatch {
  return { consentVersion, sessionGeneration, checkpoints };
}

export function contiguousPair(): readonly [RideProgressCheckpoint, RideProgressCheckpoint] {
  const first = checkpoint();

  return [
    first,
    checkpoint({ sequence: 1, startTick: first.endTick, startedAtMs: first.endedAtMs }),
  ];
}

export async function fixture(
  rideSourcePolicy: "disabled" | "declared_ble_v1" = "declared_ble_v1",
): Promise<Fixture> {
  const test = await createTestApp({
    config: { rideSourcePolicy },
    clock: { nowMs: () => NOW_MS },
  });

  cleanup.add(() => test.app.close());

  const owner = await loginTestUser(test.app, test.mail, "progress-owner@example.com");

  const other = await loginTestUser(
    test.app,
    test.mail,
    "progress-other@example.com",
    "127.0.0.1:2",
  );

  return {
    server: httpServerOf(test.app),
    owner,
    other,
    service: test.app.get<ProgressService>(ProgressService),
    economy: test.app.get<EconomyService>(EconomyService),
    db: getDatabase(test.app),
  };
}

export function grantConsent(
  db: DatabaseReader,
  session: TestSession,
  options: ConsentOptions = {},
): void {
  db.$client
    .prepare(
      `INSERT INTO progress_consents
        (user_id, version, enabled, session_hash, session_generation, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
        version = excluded.version,
        enabled = excluded.enabled,
        session_hash = excluded.session_hash,
        session_generation = excluded.session_generation,
        updated_at = excluded.updated_at`,
    )
    .run(
      session.user.id,
      options.version ?? CONSENT_VERSION,
      options.enabled === false ? 0 : 1,
      options.sessionHash ?? hashToken(session.sessionToken),
      options.sessionGeneration ?? SESSION_GENERATION,
      NOW_MS,
    );
}

export function principal(session: TestSession): SessionPrincipal {
  return {
    userId: session.user.id,
    email: session.user.email,
    sessionTokenHash: hashToken(session.sessionToken),
  };
}

export function accept(
  f: Fixture,
  session: TestSession,
  value: ProgressCheckpointBatch,
  nowMs = NOW_MS,
) {
  return f.service.accept(principal(session), value, nowMs);
}

export function postCheckpoints(
  server: Readonly<ReturnType<typeof httpServerOf>>,
  sessionToken: string,
  value: ProgressCheckpointBatch,
) {
  return request(server).post("/v1/progress/checkpoints").set(bearer(sessionToken)).send(value);
}

export function expectApiError(action: () => object, status: number, code: ErrorCode): void;
export function expectApiError(action: () => void, status: number, code: ErrorCode): void;
export function expectApiError(action: () => object | void, status: number, code: ErrorCode): void {
  let thrown: unknown;

  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ApiError);
  expect(thrown).toMatchObject({ status, code });
}

export function expectNoProgressWrites(f: Fixture): void {
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_ranges").all()).toEqual([]);
  expect(f.db.$client.prepare("SELECT * FROM ride_progress_journals").all()).toEqual([]);
  expect(f.db.$client.prepare("SELECT * FROM volts_ledger").all()).toEqual([]);
}

export function storedRange(
  db: DatabaseReader,
  journalId: string,
  startTick: number,
): StoredProgressRange | undefined {
  return db.$client
    .prepare<[string, number], StoredProgressRange>(
      `SELECT id, journal_id, user_id, start_tick, end_tick, payload_hash, payload_json,
        cumulative_facts_json, receipt_json, created_at
       FROM ride_progress_ranges WHERE journal_id = ? AND start_tick = ?`,
    )
    .get(journalId, startTick);
}
