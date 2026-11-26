import { expect, it } from "vitest";

import { ProgressAccountExportSchema } from "./api/progress.js";
import { CompletedLocalRideSchema } from "./localRide.js";
import { DEFAULT_RIDER_PROFILE } from "./profile.js";
import { RecordingV2Schema } from "./recordingV2.js";
import { RideProgressCheckpointSchema } from "./rideProgress.js";
import { recordedRide } from "./testdata/recording.js";

/** Any mix of reference fields a client could send. */
interface CandidateReference {
  readonly routeId?: string;
  readonly routeRevision?: string;
  readonly worldId?: string;
  readonly worldRevision?: string;
  readonly pathId?: string;
  readonly extra?: string;
}

const WORLD = { worldId: "test-loop", worldRevision: "1", pathId: "test-loop" } as const;
const ROUTE = { routeId: "test-loop", routeRevision: "1" } as const;
const PHYSICS = { massKg: 75, bikeMassKg: 8, cdaM2: 0.32, crr: 0.004, wheelCircM: 2.105 };
const JOURNAL_ID = "550e8400-e29b-41d4-a716-446655440000";
const recording = recordedRide();

function recordingInput(reference: CandidateReference) {
  const init = recording.initialization;

  return {
    ...recording,
    initialization: {
      physicsRevision: init.physicsRevision,
      ...reference,
      profile: init.profile,
      source: init.source,
      clockScale: init.clockScale,
      workerTimeOriginMs: init.workerTimeOriginMs,
      initializedWorkerMs: init.initializedWorkerMs,
    },
  };
}

function localRideInput(reference: CandidateReference) {
  return {
    schemaVersion: 1,
    rideId: JOURNAL_ID,
    startedAt: "2026-11-20T12:00:00.000Z",
    metadata: { source: "sim", ...reference, physicsClockScale: 1, profile: DEFAULT_RIDER_PROFILE },
    samples: [
      { elapsedMs: 0, distanceM: 0, powerW: 0, cadenceRpm: 0, gap: false },
      { elapsedMs: 1000, distanceM: 10, powerW: 200, cadenceRpm: 90, gap: false },
    ],
  };
}

/** Same values and key order as fixtures/api/progress-checkpoints.request.json once parsed. */
function checkpointInput(reference: CandidateReference) {
  return {
    schemaVersion: 1,
    journalId: JOURNAL_ID,
    startedAtMs: 1795607999000,
    endedAtMs: 1795607999051,
    source: "ble",
    clockScale: 1,
    physicsRevision: "engine-v1",
    ...reference,
    physics: PHYSICS,
    facts: [
      { powerW: 200, cadenceRpm: 90, timeS: 0.05, distanceM: 1, elevationGainM: 0, energyKj: 0.01 },
    ],
    quality: { paused: false, dataAgeS: 0, clockSkipped: false },
    sequence: 0,
    startTick: 0,
    endTick: 1,
  };
}

function exportInput(reference: CandidateReference) {
  const journal = {
    journalId: JOURNAL_ID,
    sessionGeneration: 1,
    consentVersion: 1,
    source: "ble",
    clockScale: 1,
    physicsRevision: "engine-v1",
    ...reference,
    physics: PHYSICS,
    startedAtMs: 0,
    lastEndTick: 1,
    lastSequence: 0,
    lastEndedAtMs: 50,
    lastRewardDay: "1970-01-01",
    cumulativeFacts: {
      activeDistanceM: 1,
      activeElevationGainM: 0,
      activeTimeS: 0.05,
      elevationGainM: 0,
      energyKj: 0.01,
    },
    createdAt: "2026-11-20T12:00:00.000Z",
  };

  return { consent: { status: "missing" }, journals: [journal], ranges: [] };
}

/** JSON of the parsed contract value, or undefined when the contract rejects the input. */
function parsedJson(
  result: Readonly<{ success: true; data: CandidateReference } | { success: false }>,
): string | undefined {
  return result.success ? JSON.stringify(result.data) : undefined;
}

interface ContractCase {
  readonly name: string;
  readonly input: (reference: CandidateReference) => object;
  readonly parsed: (reference: CandidateReference) => string | undefined;
}

const CONTRACTS: readonly ContractCase[] = [
  {
    name: "recording initialization",
    input: recordingInput,
    parsed: (reference) => parsedJson(RecordingV2Schema.safeParse(recordingInput(reference))),
  },
  {
    name: "local ride metadata",
    input: localRideInput,
    parsed: (reference) =>
      parsedJson(CompletedLocalRideSchema.safeParse(localRideInput(reference))),
  },
  {
    name: "progress checkpoint",
    input: checkpointInput,
    parsed: (reference) =>
      parsedJson(RideProgressCheckpointSchema.safeParse(checkpointInput(reference))),
  },
  {
    name: "progress export journal",
    input: exportInput,
    parsed: (reference) =>
      parsedJson(ProgressAccountExportSchema.safeParse(exportInput(reference))),
  },
];

const INVALID: readonly CandidateReference[] = [
  {},
  { ...WORLD, ...ROUTE },
  { worldId: "test-loop", worldRevision: "1" },
  { worldId: "test-loop", pathId: "test-loop" },
  { worldRevision: "1", pathId: "test-loop" },
  { routeId: "test-loop" },
  { routeRevision: "1" },
  { ...WORLD, worldId: "" },
  { ...WORLD, worldRevision: "" },
  { ...WORLD, pathId: "" },
  { ...WORLD, pathId: "x".repeat(101) },
  { ...ROUTE, routeId: "" },
  { ...ROUTE, routeRevision: "" },
  { ...WORLD, extra: "x" },
  { ...ROUTE, extra: "x" },
];

it.each(CONTRACTS)("$name keeps a world path in place, key for key", ({ input, parsed }) => {
  expect(parsed(WORLD)).toBe(JSON.stringify(input(WORLD)));
});

it.each(CONTRACTS)("$name keeps a stored route unchanged, key for key", ({ input, parsed }) => {
  expect(parsed(ROUTE)).toBe(JSON.stringify(input(ROUTE)));
});

it.each(
  CONTRACTS.flatMap((contract) => INVALID.map((reference) => [contract, reference] as const)),
)("%# rejects a mixed, partial, empty or extended reference", (contract, reference) => {
  expect(contract.parsed(reference)).toBeUndefined();
});

it("keeps the stored checkpoint key order that payload hashes are taken over", () => {
  expect(Object.keys(RideProgressCheckpointSchema.parse(checkpointInput(ROUTE)))).toEqual([
    "schemaVersion",
    "journalId",
    "startedAtMs",
    "endedAtMs",
    "source",
    "clockScale",
    "physicsRevision",
    "routeId",
    "routeRevision",
    "physics",
    "facts",
    "quality",
    "sequence",
    "startTick",
    "endTick",
  ]);
});
