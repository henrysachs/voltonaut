import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import {
  ProgressCheckpointBatchSchema,
  type ErrorCode,
  type ProgressCheckpointBatch,
  type RideProgressCheckpoint,
} from "@voltonaut/shared";

import {
  JOURNAL_ID,
  NOW_MS,
  batch,
  checkpoint,
  contiguousPair,
  expectApiError,
  fact,
  quality,
} from "./progress.fixtures.spec.js";
import { progressPayloadHash, validateProgressBatch } from "./progress.validation.js";

function validate(value: ProgressCheckpointBatch) {
  return validateProgressBatch(value, NOW_MS);
}

function contractCheckpoint(): RideProgressCheckpoint {
  const contract = ProgressCheckpointBatchSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../../fixtures/api/progress-checkpoints.request.json", import.meta.url),
        "utf8",
      ),
    ),
  );

  const first = contract.checkpoints[0];

  if (first === undefined) throw new Error("Expected a progress contract checkpoint");

  return first;
}

it("normalizes the parsed payload and derives total and active facts from native ticks", () => {
  const validated = validate(
    batch([
      checkpoint({
        journalId: JOURNAL_ID.toUpperCase(),
        facts: [
          fact({ powerW: 200, cadenceRpm: 90, distanceM: 10, elevationGainM: 1 }),
          fact({ powerW: 30, cadenceRpm: 90, distanceM: 20, elevationGainM: 2 }),
          fact({ powerW: 200, cadenceRpm: 20, distanceM: 30, elevationGainM: 3 }),
          fact({ powerW: 31, cadenceRpm: 21, distanceM: 40, elevationGainM: 4 }),
          fact({ powerW: 200, cadenceRpm: 90, timeS: 0, distanceM: 0, elevationGainM: 0 }),
        ],
        quality: { ...quality, paused: true },
      }),
    ]),
  );

  expect(validated.payload.checkpoints[0]?.journalId).toBe(JOURNAL_ID);
  expect(validated.range.metadata.journalId).toBe(JOURNAL_ID);
  expect(validated.range.startSequence).toBe(0);
  expect(validated.range.endSequence).toBe(0);
  expect(validated.range.deltaFacts.activeDistanceM).toBe(50);
  expect(validated.range.deltaFacts.activeElevationGainM).toBe(5);
  expect(validated.range.deltaFacts.activeTimeS).toBeCloseTo(0.1, 12);
  expect(validated.range.deltaFacts.elevationGainM).toBe(10);
  expect(validated.range.deltaFacts.energyKj).toBeCloseTo(0.02305, 12);
});

it("accepts the shared worker fixture's rounded epoch timestamps", () => {
  const first = contractCheckpoint();
  const contract = batch([first]);

  expect(Number.isSafeInteger(first.startedAtMs)).toBe(true);
  expect(Number.isSafeInteger(first.endedAtMs)).toBe(true);
  expect(validate(contract).range).toMatchObject({
    startedAtMs: first.startedAtMs,
    endedAtMs: first.endedAtMs,
  });
});

it("accepts the intake time boundaries and rejects older or future ranges", () => {
  const futureBound = NOW_MS + 5 * 60_000;
  const lateBound = NOW_MS - 7 * 24 * 60 * 60_000;

  expect(
    validate(batch([checkpoint({ startedAtMs: futureBound - 50, endedAtMs: futureBound })])).range
      .endedAtMs,
  ).toBe(futureBound);
  expect(
    validate(batch([checkpoint({ startedAtMs: lateBound - 50, endedAtMs: lateBound })])).range
      .endedAtMs,
  ).toBe(lateBound);

  expectApiError(
    () =>
      validate(batch([checkpoint({ startedAtMs: futureBound - 49, endedAtMs: futureBound + 1 })])),
    422,
    "validation_failed",
  );
  expectApiError(
    () => validate(batch([checkpoint({ startedAtMs: lateBound - 51, endedAtMs: lateBound - 1 })])),
    422,
    "validation_failed",
  );
});

it("assigns a midnight-crossing range to its UTC end day", () => {
  const endedAtMs = Date.parse("2026-11-25T00:00:00.000Z");
  const validated = validate(batch([checkpoint({ startedAtMs: endedAtMs - 50, endedAtMs })]));

  expect(validated.range.rewardDay).toBe("2026-11-25");
});

it("hashes canonical parsed payloads and detects raw changes with identical aggregates", () => {
  const original = validate(batch([checkpoint()]));

  const equivalent = validate(batch([checkpoint({ quality: { ...quality, dataAgeS: 0 } })]));

  const changed = validate(batch([checkpoint({ quality: { ...quality, dataAgeS: 1 } })]));

  expect(progressPayloadHash(original.payload)).toBe(progressPayloadHash(equivalent.payload));
  expect(progressPayloadHash(changed.payload)).not.toBe(progressPayloadHash(original.payload));
  expect(changed.range.deltaFacts).toEqual(original.range.deltaFacts);
});

it("accepts ten 120-fact checkpoints and rejects an eleventh checkpoint", () => {
  const exact = Array.from({ length: 10 }, (_, index) =>
    checkpoint({
      sequence: index,
      startTick: index * 120,
      factCount: 120,
      startedAtMs: NOW_MS + index * 6000,
    }),
  );

  expect(validate(batch(exact)).range.endTick).toBe(1200);
  expectApiError(
    () => validate(batch([...exact, checkpoint({ sequence: 10, startTick: 1200 })])),
    422,
    "validation_failed",
  );
});

const invalidCases: readonly {
  readonly name: string;
  readonly value: ProgressCheckpointBatch;
  readonly code: ErrorCode;
}[] = [
  {
    name: "simulation source",
    value: batch([checkpoint({ source: "sim" })]),
    code: "progress_source_rejected",
  },
  {
    name: "scaled clock",
    value: batch([checkpoint({ clockScale: 20 })]),
    code: "progress_source_rejected",
  },
  {
    name: "clock skip",
    value: batch([checkpoint({ quality: { ...quality, clockSkipped: true } })]),
    code: "progress_source_rejected",
  },
  {
    name: "stale trainer data",
    value: batch([checkpoint({ quality: { ...quality, dataAgeS: 2.5001 } })]),
    code: "progress_source_rejected",
  },
  {
    name: "non-native tick time",
    value: batch([checkpoint({ facts: [fact({ timeS: 0.04 })] })]),
    code: "validation_failed",
  },
  {
    name: "excessive power",
    value: batch([checkpoint({ facts: [fact({ powerW: 2001 })] })]),
    code: "validation_failed",
  },
  {
    name: "excessive cadence",
    value: batch([checkpoint({ facts: [fact({ cadenceRpm: 201 })] })]),
    code: "validation_failed",
  },
  {
    name: "negative energy",
    value: batch([checkpoint({ facts: [fact({ energyKj: -0.001 })] })]),
    code: "validation_failed",
  },
  {
    name: "inconsistent energy",
    value: batch([checkpoint({ facts: [fact({ energyKj: 0.02 })] })]),
    code: "validation_failed",
  },
  {
    name: "paused distance",
    value: batch([
      checkpoint({
        quality: { ...quality, paused: true },
        facts: [fact({ timeS: 0, distanceM: 1, elevationGainM: 0, energyKj: 0 })],
      }),
    ]),
    code: "validation_failed",
  },
  {
    name: "paused tick in an unpaused checkpoint",
    value: batch([
      checkpoint({
        facts: [fact({ timeS: 0, distanceM: 0, elevationGainM: 0, energyKj: 0 })],
      }),
    ]),
    code: "validation_failed",
  },
  {
    name: "fractional checkpoint timestamp",
    value: batch([{ ...checkpoint(), startedAtMs: NOW_MS + 0.5 }]),
    code: "validation_failed",
  },
  {
    name: "nonzero first sequence",
    value: batch([checkpoint({ sequence: 1 })]),
    code: "validation_failed",
  },
];

it.each(invalidCases)("rejects $name", ({ value, code }) => {
  expect.hasAssertions();
  expectApiError(() => validate(value), 422, code);
});

it("rejects sequence, tick, time and metadata breaks inside a batch", () => {
  expect.hasAssertions();
  const [first, second] = contiguousPair();

  const changes: readonly RideProgressCheckpoint[] = [
    { ...second, sequence: 2 },
    { ...second, startTick: second.startTick + 1, endTick: second.endTick + 1 },
    { ...second, startedAtMs: first.endedAtMs - 1 },
    { ...second, physics: { ...second.physics, massKg: 80 } },
  ];

  for (const changed of changes) {
    expectApiError(() => validate(batch([first, changed])), 422, "validation_failed");
  }
});
