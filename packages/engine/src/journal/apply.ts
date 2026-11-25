import type { RecordingEntryV2 } from "@voltonaut/shared";

import type { Engine } from "../internal/engine.js";

interface TrainerReadings {
  powerW?: number;
  cadenceRpm?: number;
  speedMps?: number;
}

function trainerReadings(
  entry: Extract<
    RecordingEntryV2,
    readonly [number, number, "trainer", ...(readonly (number | null)[])]
  >,
): Readonly<TrainerReadings> {
  const readings: TrainerReadings = {};

  if (entry[3] !== null) readings.powerW = entry[3];

  if (entry[4] !== null) readings.cadenceRpm = entry[4];

  if (entry[5] !== null) readings.speedMps = entry[5];

  return readings;
}

/** Replays one Fahrtjournal entry into an engine exactly as the worker fed it live. */
export function applyJournalEntry(
  engine: Readonly<Pick<Engine, "ingest" | "advance">>,
  entry: RecordingEntryV2,
  clockScale: number,
): void {
  const tS = entry[1] / 1000;

  switch (entry[2]) {
    case "trainer":
      engine.ingest({ type: "trainer.data", tS, ...trainerReadings(entry) });

      return;
    case "hr":
      engine.ingest({ type: "hr.data", tS, bpm: entry[3] });

      return;
    case "shift":
      engine.ingest({
        type: "controller.button",
        tS,
        button: entry[3],
        pressed: true,
        source: "recording-v2",
      });

      return;
    case "advance":
      engine.advance(entry[3] * clockScale);
      break;
    case "status":
    case "arm":
    case "boundary":
      break;
    default: {
      const exhaustive: never = entry;

      return exhaustive;
    }
  }
}
