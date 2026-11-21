/// <reference types="node" />
/// <reference lib="es2023" />

import assert from "node:assert/strict";
import { z } from "../../../../packages/shared/node_modules/zod/index.js";

const finite = z.number().finite();
const identity = z.object({ schemaVersion: z.number().int() }).passthrough().readonly();

const sample = z
  .object({
    elapsedMs: finite,
    distanceM: finite,
    powerW: finite.optional(),
    cadenceRpm: finite.optional(),
    hrBpm: finite.optional(),
    gap: z.boolean(),
  })
  .readonly();

const entry = z
  .tuple([z.number().int().nonnegative(), finite.nonnegative(), z.string()])
  .rest(z.union([finite, z.string(), z.null()]))
  .readonly();

const journal = z
  .object({
    schemaVersion: z.literal(2),
    journalState: z.literal("complete"),
    initialization: z
      .object({
        source: z.literal("sim"),
        clockScale: z.literal(1),
        initializedWorkerMs: finite.nonnegative(),
      })
      .passthrough()
      .readonly(),
    entries: z.array(entry).min(3).readonly(),
    window: z
      .object({
        startSeq: z.number().int().nonnegative(),
        finishSeq: z.number().int().nonnegative(),
      })
      .readonly(),
    observations: z
      .array(
        z
          .object({
            boundarySeq: z.number().int().nonnegative(),
            snapshot: z
              .object({ distanceM: finite, powerW: finite, cadenceRpm: finite })
              .passthrough()
              .readonly(),
          })
          .passthrough()
          .readonly(),
      )
      .min(2)
      .readonly(),
  })
  .passthrough()
  .readonly();

/** @param {string} json */
export function describeArchive(json) {
  const rows = z.array(identity).parse(JSON.parse(json));

  return {
    database: "voltonaut-local-rides",
    store: "completed",
    rowCount: rows.length,
    rows: rows.map((row) => {
      const descriptor = { keys: Object.keys(row).toSorted(), schemaVersion: row.schemaVersion };

      if (row.schemaVersion === 1) {
        const ride = z
          .object({
            metadata: z.object({ source: z.string(), physicsClockScale: finite }).passthrough(),
            samples: z.array(sample),
          })
          .parse(row);

        return Object.assign(descriptor, {
          metadataKeys: Object.keys(ride.metadata).toSorted(),
          source: ride.metadata.source,
          clockScale: ride.metadata.physicsClockScale,
          sampleCount: ride.samples.length,
          firstSample: ride.samples[0],
          lastSample: ride.samples.at(-1),
          journalPresent: false,
        });
      }

      const parsed = journal.safeParse(row);

      return parsed.success
        ? Object.assign(descriptor, {
            source: parsed.data.initialization.source,
            clockScale: parsed.data.initialization.clockScale,
            journalState: parsed.data.journalState,
            entryCount: parsed.data.entries.length,
            observationCount: parsed.data.observations.length,
            window: parsed.data.window,
            boundaryEntries: parsed.data.entries.filter((item) => item[2] === "boundary"),
          })
        : Object.assign(descriptor, { journalPresent: "entries" in row, journalValid: false });
    }),
  };
}

/** @param {string} json */
export function requireRecordingV2(json) {
  const rows = z.array(identity).parse(JSON.parse(json));
  assert.equal(rows.length, 1, "Public Finish + store creates exactly one actual archive row");
  const stored = rows.at(0);
  assert.ok(stored !== undefined);
  assert.equal(
    stored.schemaVersion,
    2,
    "Actual IndexedDB archive schemaVersion: expected 2, received " + stored.schemaVersion,
  );
  const ride = journal.parse(stored);
  requireSelectedWindow(ride);
  assert.ok(
    ride.entries.some((item) => item[2] === "trainer"),
    "Actual Sim inputs appear in journal",
  );
  assert.ok(
    ride.observations.some((item) => item.snapshot.powerW > 0 && item.snapshot.cadenceRpm > 0),
    "Observations contain ride data",
  );
  let previousMs = ride.initialization.initializedWorkerMs;

  for (const [index, item] of ride.entries.entries()) {
    assert.equal(item[0], index, "Journal sequence is complete from zero, never rebased");
    assert.ok(item[1] >= previousMs, "Journal preserves nondecreasing actor time");
    previousMs = item[1];
  }
}

/** @param {z.infer<typeof journal>} ride */
function requireSelectedWindow(ride) {
  const boundaries = ride.entries.filter((item) => item[2] === "boundary");
  const start = ride.entries.at(ride.window.startSeq);
  const finish = ride.entries.at(ride.window.finishSeq);
  assert.ok(start !== undefined);
  assert.ok(finish !== undefined);
  assert.equal(start[2], "boundary");
  assert.equal(start[3], "start");
  assert.equal(finish[2], "boundary");
  assert.equal(finish[3], "finish");
  assert.equal(finish[0], ride.entries.length - 1, "Journal ends at selected finish");
  assert.ok(finish[1] - start[1] >= 1000, "Selected window spans at least one real second");
  assert.ok(ride.window.startSeq > 0, "Worker-owned prefix predates public Start");
  assert.ok(
    ride.entries.slice(0, ride.window.startSeq).some((item) => item[2] === "advance"),
    "Full prefix includes actual warm-up advances",
  );
  assert.equal(boundaries.filter((item) => item[3] === "start").length, 1);
  assert.equal(boundaries.filter((item) => item[3] === "finish").length, 1);
  assert.equal(boundaries.length, ride.observations.length);

  for (const [index, observation] of ride.observations.entries())
    assert.equal(
      observation.boundarySeq,
      boundaries[index]?.[0],
      "Selected boundaries reference observations in actor order",
    );
}
