/* oxlint-disable typescript/prefer-readonly-parameter-types -- The probe intentionally appends to its local sample array. */
import { expect, it } from "vitest";

import { createProgressOutboxDatabase } from "./progressOutboxDatabase.js";
import { PROGRESS_OUTBOX_MAX_ROWS, type ProgressOutbox } from "./progressOutbox.js";
import { MemoryOutboxDatabase, checkpoint, fence, seedRows } from "./progressOutboxTestdata.js";
import type { MemoryOutboxMetrics } from "./progressOutboxMemoryDatabase.js";

async function appendMeasured(
  outbox: Readonly<ProgressOutbox>,
  sequence: number,
  durations: number[],
): Promise<void> {
  if (sequence === 1200) return;

  const started = performance.now();

  try {
    await outbox.append(fence(), checkpoint({ sequence, startTick: sequence }));
  } catch (cause) {
    throw new Error(`Progress append failed at sequence ${sequence}`, { cause });
  }

  durations.push(performance.now() - started);

  return appendMeasured(outbox, sequence + 1, durations);
}

function sample(values: readonly number[], index: number): number {
  const value = values[index];

  if (value === undefined) throw new Error("Missing probe sample");

  return value;
}

function probeReport(
  durations: readonly number[],
  rows: number,
  metrics: Readonly<MemoryOutboxMetrics>,
) {
  const ordered = durations.toSorted((left, right) => left - right);

  return {
    samples: durations.length,
    order: "checkpoint sequence 0..1199",
    firstMs: sample(durations, 0),
    medianMs: sample(ordered, Math.floor(ordered.length / 2)),
    p95Ms: sample(ordered, Math.ceil(ordered.length * 0.95) - 1),
    maxMs: sample(ordered, ordered.length - 1),
    rows,
    metrics,
  };
}

it("keeps 1200 keyed one-fact appends below the 50 ms wake budget in memory", async () => {
  const memory = new MemoryOutboxDatabase();
  seedRows(memory, PROGRESS_OUTBOX_MAX_ROWS - 10);
  memory.resetMetrics();
  const outbox = createProgressOutboxDatabase(memory);
  const durations: number[] = [];
  await appendMeasured(outbox, 0, durations);

  const report = probeReport(durations, memory.raw().length, memory.metrics());
  console.warn("progress-append-probe", JSON.stringify(report));

  expect(report.rows).toBe(PROGRESS_OUTBOX_MAX_ROWS);
  expect(report.metrics.getAll).toBe(0);
  expect(report.metrics.accountCount).toBe(1200);
  expect(report.metrics.openRows).toBe(1200);
  expect(report.metrics.sequenceRows).toBe(1200);
  expect(report.metrics.lastJournalRow).toBe(1200);
  expect(report.maxMs).toBeLessThan(50);
  expect(report.p95Ms).toBeLessThan(25);
}, 20_000);
