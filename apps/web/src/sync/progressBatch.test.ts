import { expect, it } from "vitest";
import { type NativeTickFacts, type RideProgressCheckpoint } from "@voltonaut/shared";

import {
  LocalProgressBatchSchema,
  appendProgressBatch,
  groupProgressBatches,
  progressFactCount,
  progressSimulatedTimeS,
  type ProgressBatch,
} from "./progressBatch.js";

const journalId = "550e8400-e29b-41d4-a716-446655440000";

function fact(index: number, timeS = 0.05): NativeTickFacts {
  return {
    powerW: 200 + index,
    cadenceRpm: 90,
    timeS,
    distanceM: index + 1,
    elevationGainM: index + 2,
    energyKj: (index + 3) / 100,
  };
}

function checkpoint({
  sequence,
  startTick,
  factCount = 1,
  paused = false,
  source = "ble",
}: {
  readonly sequence: number;
  readonly startTick: number;
  readonly factCount?: number;
  readonly paused?: boolean;
  readonly source?: "ble" | "sim";
}): RideProgressCheckpoint {
  const startedAtMs = startTick * 50;

  return {
    schemaVersion: 1,
    journalId,
    sequence,
    startTick,
    endTick: startTick + factCount,
    startedAtMs,
    endedAtMs: startedAtMs + factCount * 50,
    source,
    clockScale: 1,
    physicsRevision: "engine-v1",
    routeId: "flat-loop",
    routeRevision: "1",
    physics: {
      massKg: 75,
      bikeMassKg: 8,
      cdaM2: 0.32,
      crr: 0.004,
      wheelCircM: 2.105,
    },
    facts: Array.from({ length: factCount }, (_, index) => fact(startTick + index)),
    quality: { paused, dataAgeS: 0, clockSkipped: false },
  };
}

function batch(
  checkpoints: readonly RideProgressCheckpoint[],
  consentVersion = 1,
  sessionGeneration = 1,
): ProgressBatch {
  return LocalProgressBatchSchema.parse({ consentVersion, sessionGeneration, checkpoints });
}

function requireBatch(value: ProgressBatch | undefined): ProgressBatch {
  if (value === undefined) throw new Error("Missing progress batch");

  return value;
}

it("preserves checkpoint order and seals at exactly 120 facts and six simulated seconds", () => {
  const first = checkpoint({ sequence: 0, startTick: 0, factCount: 70 });
  const second = checkpoint({ sequence: 1, startTick: 70, factCount: 50 });

  const opened = appendProgressBatch({
    open: undefined,
    checkpoint: first,
    consentVersion: 1,
    sessionGeneration: 1,
  });

  const sealed = appendProgressBatch({
    open: opened.open,
    checkpoint: second,
    consentVersion: 1,
    sessionGeneration: 1,
  });

  expect(opened.open?.checkpoints).toEqual([first]);
  expect(sealed.open).toBeUndefined();
  expect(sealed.sealed).toHaveLength(1);
  const full = requireBatch(sealed.sealed[0]);
  expect(full.checkpoints).toEqual([first, second]);
  expect(progressFactCount(full)).toBe(120);
  expect(progressSimulatedTimeS(full)).toBeCloseTo(6, 10);
  expect(Object.isFrozen(full)).toBe(true);
  expect(Object.isFrozen(full.checkpoints)).toBe(true);
});

it("seals before an incoming checkpoint would exceed the local fact limit without splitting it", () => {
  const first = checkpoint({ sequence: 0, startTick: 0, factCount: 100 });
  const second = checkpoint({ sequence: 1, startTick: 100, factCount: 30 });

  const opened = appendProgressBatch({
    open: undefined,
    checkpoint: first,
    consentVersion: 1,
    sessionGeneration: 1,
  });

  const update = appendProgressBatch({
    open: opened.open,
    checkpoint: second,
    consentVersion: 1,
    sessionGeneration: 1,
  });

  expect(update.sealed.map((entry) => progressFactCount(entry))).toEqual([100]);
  expect(update.open?.checkpoints).toEqual([second]);
  expect(progressFactCount(requireBatch(update.open))).toBe(30);
});

it("merges paused checkpoints and leaves pause-transition delivery to progressSync", () => {
  const first = checkpoint({ sequence: 0, startTick: 0 });
  const paused = checkpoint({ sequence: 1, startTick: 1, paused: true });

  const opened = appendProgressBatch({
    open: undefined,
    checkpoint: first,
    consentVersion: 1,
    sessionGeneration: 1,
  });

  const update = appendProgressBatch({
    open: opened.open,
    checkpoint: paused,
    consentVersion: 1,
    sessionGeneration: 1,
  });

  const open = requireBatch(update.open);

  expect(update.sealed).toEqual([]);
  expect(open.checkpoints.map((entry) => entry.quality.paused)).toEqual([false, true]);
  expect(
    requireBatch(
      appendProgressBatch({
        open,
        checkpoint: checkpoint({ sequence: 2, startTick: 2 }),
        consentVersion: 1,
        sessionGeneration: 1,
      }).open,
    ).checkpoints,
  ).toHaveLength(3);
});

it("forms one 6-second/120-fact batch from 120 one-fact paused checkpoints", () => {
  let open: ProgressBatch | undefined;
  const sealed: ProgressBatch[] = [];

  for (let sequence = 0; sequence < 120; sequence += 1) {
    const update = appendProgressBatch({
      open,
      checkpoint: checkpoint({ sequence, startTick: sequence, paused: true }),
      consentVersion: 1,
      sessionGeneration: 1,
    });

    sealed.push(...update.sealed);
    open = update.open;
  }

  expect(open).toBeUndefined();
  expect(sealed).toHaveLength(1);
  expect(sealed[0]?.checkpoints).toHaveLength(120);
  expect(progressFactCount(requireBatch(sealed[0]))).toBe(120);
  expect(progressSimulatedTimeS(requireBatch(sealed[0]))).toBeCloseTo(6, 10);
  expect(groupProgressBatches(sealed)[0]?.checkpoints).toHaveLength(120);
});

it("groups contiguous sealed batches into at most ten checkpoints and 1200 facts", () => {
  const small = Array.from({ length: 11 }, (_, sequence) =>
    batch([checkpoint({ sequence, startTick: sequence })]),
  );

  const groups = groupProgressBatches(small);

  expect(groups.map((group) => group.checkpoints.length)).toEqual([10, 1]);
  expect(groups.flatMap((group) => group.checkpoints.map((entry) => entry.sequence))).toEqual(
    Array.from({ length: 11 }, (_, index) => index),
  );

  const full = Array.from({ length: 11 }, (_, sequence) =>
    batch([checkpoint({ sequence, startTick: sequence * 120, factCount: 120, paused: true })]),
  );

  const fullGroups = groupProgressBatches(full);

  expect(fullGroups.map((group) => progressFactCount(group))).toEqual([1200, 120]);
  expect(progressSimulatedTimeS(requireBatch(fullGroups[0]))).toBeCloseTo(60, 8);
  expect(fullGroups[0]?.checkpoints.every((entry) => entry.quality.paused)).toBe(true);
});

it("rejects gaps, overlaps, metadata changes, simulation and mixed consent versions", () => {
  const first = checkpoint({ sequence: 0, startTick: 0 });

  const opened = appendProgressBatch({
    open: undefined,
    checkpoint: first,
    consentVersion: 1,
    sessionGeneration: 1,
  });

  expect(() =>
    appendProgressBatch({
      open: opened.open,
      checkpoint: checkpoint({ sequence: 2, startTick: 1 }),
      consentVersion: 1,
      sessionGeneration: 1,
    }),
  ).toThrow(/.+/u);
  expect(() =>
    appendProgressBatch({
      open: opened.open,
      checkpoint: checkpoint({ sequence: 1, startTick: 0 }),
      consentVersion: 1,
      sessionGeneration: 1,
    }),
  ).toThrow(/.+/u);
  expect(() =>
    appendProgressBatch({
      open: undefined,
      checkpoint: checkpoint({ sequence: 0, startTick: 0, source: "sim" }),
      consentVersion: 1,
      sessionGeneration: 1,
    }),
  ).toThrow("BLE");
  expect(() =>
    groupProgressBatches([
      batch([first]),
      batch([checkpoint({ sequence: 1, startTick: 1 })], 2, 1),
    ]),
  ).toThrow("consent");
});

it("continues an open batch under a new browser generation without changing consent or ticks", () => {
  const first = checkpoint({ sequence: 0, startTick: 0 });

  const opened = appendProgressBatch({
    open: undefined,
    checkpoint: first,
    consentVersion: 1,
    sessionGeneration: 1,
  });

  const resumed = appendProgressBatch({
    open: opened.open,
    checkpoint: checkpoint({ sequence: 1, startTick: 1 }),
    consentVersion: 1,
    sessionGeneration: 2,
  });

  const open = requireBatch(resumed.open);

  expect(open.sessionGeneration).toBe(2);
  expect(open.consentVersion).toBe(1);
  expect(open.checkpoints.map((entry) => entry.sequence)).toEqual([0, 1]);
  expect(open.checkpoints.map((entry) => [entry.startTick, entry.endTick])).toEqual([
    [0, 1],
    [1, 2],
  ]);
});

it("groups contiguous batches across browser generations using stable first-batch metadata", () => {
  const groups = groupProgressBatches([
    batch([checkpoint({ sequence: 0, startTick: 0 })], 1, 1),
    batch([checkpoint({ sequence: 1, startTick: 1 })], 1, 2),
  ]);

  expect(groups).toHaveLength(1);
  expect(groups[0]?.sessionGeneration).toBe(1);
  expect(groups[0]?.checkpoints.map((entry) => entry.sequence)).toEqual([0, 1]);
});
