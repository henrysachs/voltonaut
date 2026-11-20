import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createEngine,
  createRoute,
  riderParamsFromProfile,
  stationarySpeedMps,
  TEST_ROUTES,
  type Engine,
} from "@voltonaut/engine";
import {
  RideGoldenSchema,
  RideInputSchema,
  type RideGolden,
  type RideInput,
  type TrainerCommand,
  type RideEvent,
} from "@voltonaut/shared";

const GOLDEN_DIR = fileURLToPath(new URL("../../../../fixtures/rides/", import.meta.url));

const RIDE_NAMES = [
  "flat-200w-60min",
  "typical-60min",
  "climb-250w-10min",
  "descent-coast-5min",
] as const;

interface SegmentRecord {
  readonly segmentId: string;
  readonly lap: number;
  readonly enteredTS: number;
  readonly exitedTS: number | null;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** SHA-256 over the canonically rounded command sequence (test harness, not engine). */
function commandHash(commands: readonly TrainerCommand[]): string {
  const canonical = commands
    .map((command) => {
      if (command.type !== "simulation") {
        return command.type;
      }

      const simulation = command;

      return [
        "simulation",
        round6(simulation.gradePct),
        round6(simulation.windMps),
        round6(simulation.crr),
        round6(simulation.cwKgPerM),
      ].join("|");
    })
    .join("\n");

  return createHash("sha256").update(canonical).digest("hex");
}

function readInput(name: (typeof RIDE_NAMES)[number]): RideInput {
  const raw = readFileSync(path.join(GOLDEN_DIR, `${name}.input.json`), "utf8");

  return RideInputSchema.parse(JSON.parse(raw));
}

/** Zero-order hold: each 1 Hz row drives exactly 20 ticks; its shift lands on the first tick after its second. */
function runRide(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Zod-inferred fixture DTO, parsed at the boundary; the harness only reads it.
  input: Readonly<RideInput>,
) {
  const routeData = TEST_ROUTES[input.routeId];

  if (routeData === undefined) {
    throw new RangeError(`unknown route ${input.routeId}`);
  }

  const engine = createEngine({
    route: createRoute(routeData),
    profile: input.profile,
    initialGearIndex: input.initial.gearIndex,
    initialSpeedMps: input.initial.speedMps,
    initialRoutePosM: input.initial.routePosM,
  });

  for (const sample of input.samples) {
    advanceSample(engine, sample);
  }

  return {
    snapshot: engine.snapshot(),
    events: [...engine.drainEvents()],
    commands: [...engine.drainCommands()],
  };
}

function advanceSample(engine: Engine, sample: Readonly<RideInput["samples"][number]>): void {
  engine.ingest({
    type: "trainer.data",
    tS: sample.tS,
    powerW: sample.powerW,
    cadenceRpm: sample.cadenceRpm,
  });

  if (sample.hrBpm !== undefined) {
    engine.ingest({ type: "hr.data", tS: sample.tS, bpm: sample.hrBpm });
  }

  engine.advance(1);

  // Shifts apply on the tick after their second (spec E3-01 section 5.6).
  for (let shift = 0; shift < Math.max(0, sample.shift ?? 0); shift += 1) {
    engine.ingest({
      type: "controller.button",
      tS: sample.tS,
      button: "shiftUp",
      pressed: true,
      source: "script",
    });
  }

  for (let shift = 0; shift < Math.max(0, -(sample.shift ?? 0)); shift += 1) {
    engine.ingest({
      type: "controller.button",
      tS: sample.tS,
      button: "shiftDown",
      pressed: true,
      source: "script",
    });
  }
}

function segmentRecords(events: readonly RideEvent[]): readonly SegmentRecord[] {
  const openSegments = new Map<string, SegmentRecord>();
  const finishedSegments: SegmentRecord[] = [];
  let lap = 0;

  for (const event of events) {
    if (event.type === "lap.completed") {
      lap = event.lap;
    }

    if (event.type === "segment.entered") {
      openSegments.set(event.segmentId, {
        segmentId: event.segmentId,
        lap,
        enteredTS: event.tS,
        exitedTS: null,
      });
    }

    if (event.type === "segment.exited") {
      const open = openSegments.get(event.segmentId);

      if (open !== undefined) {
        openSegments.delete(event.segmentId);
        finishedSegments.push({ ...open, exitedTS: event.tS });
      }
    }
  }

  return [...finishedSegments, ...openSegments.values()];
}

function computeGolden(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Zod-inferred fixture DTO, parsed at the boundary; the harness only reads it.
  input: Readonly<RideInput>,
): RideGolden {
  const { snapshot, events, commands } = runRide(input);

  return {
    distanceM: round6(snapshot.distanceM),
    elevationGainM: round6(snapshot.elevationGainM),
    energyKj: round6(snapshot.energyKj),
    tS: round6(snapshot.tS),
    endSpeedMps: round6(snapshot.speedMps),
    laps: snapshot.lap,
    segments: segmentRecords(events).map((segment) => ({
      segmentId: segment.segmentId,
      lap: segment.lap,
      enteredTS: round6(segment.enteredTS),
      exitedTS: segment.exitedTS === null ? null : round6(segment.exitedTS),
    })),
    commandCount: commands.length,
    commandHash: commandHash(commands),
    schemaVersion: 1,
  };
}

const goldenUpdate = process.env["GOLDEN_UPDATE"] === "1";

function updateGoldens(): void {
  for (const name of RIDE_NAMES) {
    const golden = computeGolden(readInput(name));
    const goldenPath = path.join(GOLDEN_DIR, `${name}.golden.json`);

    writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`);
  }
}

if (goldenUpdate) {
  updateGoldens();
}

describe.each(RIDE_NAMES)("golden ride %s", (name) => {
  it("matches the golden baseline exactly", () => {
    const golden = computeGolden(readInput(name));
    const goldenPath = path.join(GOLDEN_DIR, `${name}.golden.json`);
    const baseline = RideGoldenSchema.parse(JSON.parse(readFileSync(goldenPath, "utf8")));

    expect(golden).toEqual(baseline);
  });
});

describe("AK10 acceptance for flat-200w-60min", () => {
  it("stays within 0.1 % of stationary distance over 60 min with a rolling start", () => {
    const input = readInput("flat-200w-60min");
    const initialSpeedMps = stationarySpeedMps(0, 200, riderParamsFromProfile(input.profile));

    const { snapshot } = runRide({
      ...input,
      initial: { ...input.initial, speedMps: initialSpeedMps },
    });

    const referenceM = initialSpeedMps * 3600;

    expect(snapshot.tS).toBeCloseTo(3600, 6);
    expect(Math.abs(snapshot.distanceM - referenceM) / referenceM).toBeLessThanOrEqual(0.001);
  });

  it("stays within 2 % of the stationary distance reference", () => {
    const input = readInput("flat-200w-60min");
    const golden = computeGolden(input);
    const stationaryMps = stationarySpeedMps(0, 200, riderParamsFromProfile(input.profile));
    const referenceM = stationaryMps * 3600;

    expect(Math.abs(golden.distanceM - referenceM) / referenceM).toBeLessThanOrEqual(0.02);
  });

  it("accumulates 720 kJ from the raw 200 W and no elevation on the flat loop", () => {
    const golden = computeGolden(readInput("flat-200w-60min"));

    expect(golden.energyKj).toBeCloseTo(720, 3);
    expect(golden.elevationGainM).toBe(0);
  });
});
