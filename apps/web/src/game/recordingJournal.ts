import {
  MAX_RECORDING_V2_ADVANCES,
  MAX_RECORDING_V2_BYTES,
  MAX_RECORDING_V2_INPUTS,
  MAX_RECORDING_V2_MS,
  MAX_RECORDING_V2_OBSERVATIONS,
  RecordingV2Schema,
  type CaptureUnavailabilityReason,
  type RecordingEntryV2,
  type RecordingV2,
  type ReplayObservationV2,
} from "@voltonaut/shared";

type ReplayEvent = ReplayObservationV2["events"][number];

type ReplayCommand = ReplayObservationV2["commands"][number];

export type JournalInitialization = Pick<RecordingV2, "initializedAt" | "initialization">;

interface WindowJournal {
  readonly rideId: string;
  readonly entries: RecordingEntryV2[];
  readonly observations: ReplayObservationV2[];
  readonly startSeq: number;
  eventOffset: number;
  commandOffset: number;
  boundaryBytes: number;
}

const FINISH_RESERVE_BYTES = 4096;
const encoder = new TextEncoder();

function bytes(
  value:
    | RecordingEntryV2
    | ReplayObservationV2
    | ReplayEvent
    | ReplayCommand
    | JournalInitialization,
): number {
  return encoder.encode(JSON.stringify(value)).byteLength + 2;
}

/** Bounded lifetime physics prefix. Recording markers exist only in the selected window. */
export class RecordingJournal {
  private readonly entries: RecordingEntryV2[] = [];
  private readonly events: ReplayEvent[] = [];
  private readonly commands: ReplayCommand[] = [];
  private window: WindowJournal | undefined;
  private advances = 0;
  private inputs = 0;
  private usedBytes: number;
  private unavailable: CaptureUnavailabilityReason | undefined;

  constructor(private readonly initialization: JournalInitialization) {
    this.usedBytes = bytes(initialization) + 1024;
  }

  reason(): CaptureUnavailabilityReason | undefined {
    return this.unavailable;
  }

  observeTime(atMs: number): void {
    if (atMs - this.initialization.initialization.initializedWorkerMs > MAX_RECORDING_V2_MS)
      this.invalidate("journal_age");
  }

  invalidate(reason: CaptureUnavailabilityReason): void {
    this.unavailable ??= reason;
    this.entries.length = 0;
    this.events.length = 0;
    this.commands.length = 0;
    this.window = undefined;
  }

  private reserve(additionalBytes: number): boolean {
    if (this.unavailable !== undefined) return false;

    if (
      this.usedBytes + (this.window?.boundaryBytes ?? 0) + additionalBytes + FINISH_RESERVE_BYTES >
      MAX_RECORDING_V2_BYTES
    ) {
      this.invalidate("journal_bytes");

      return false;
    }

    return true;
  }

  append(entry: RecordingEntryV2): void {
    this.observeTime(entry[1]);

    if (this.unavailable !== undefined) return;

    if (entry[2] === "advance") this.advances += 1;
    else if (entry[2] !== "arm") this.inputs += 1;

    if (this.advances > MAX_RECORDING_V2_ADVANCES) this.invalidate("journal_advances");
    else if (this.inputs > MAX_RECORDING_V2_INPUTS) this.invalidate("journal_inputs");
    const cost = bytes(resequence(entry, 999_999));

    if (!this.reserve(cost)) return;
    const lifetimeEntry = resequence(entry, this.entries.length);
    this.entries.push(lifetimeEntry);
    this.usedBytes += cost;
    this.window?.entries.push(resequence(entry, this.window.entries.length));
  }

  outputs(events: readonly ReplayEvent[], commands: readonly ReplayCommand[]): void {
    for (const event of events) {
      if (this.events.length >= 500_000 || !this.reserve(bytes(event))) {
        this.invalidate("journal_bytes");

        return;
      }

      this.events.push(event);
      this.usedBytes += bytes(event);
    }

    for (const command of commands) {
      if (this.commands.length >= 500_000 || !this.reserve(bytes(command))) {
        this.invalidate("journal_bytes");

        return;
      }

      this.commands.push(command);
      this.usedBytes += bytes(command);
    }
  }

  start(rideId: string): void {
    this.window =
      this.unavailable === undefined
        ? {
            rideId,
            entries: [...this.entries],
            observations: [],
            startSeq: this.entries.length,
            eventOffset: 0,
            commandOffset: 0,
            boundaryBytes: 0,
          }
        : undefined;
  }

  boundary(
    atMs: number,
    kind: "start" | "sample" | "finish",
    snapshot: ReplayObservationV2["snapshot"],
    gap: boolean,
  ): void {
    this.observeTime(atMs);

    const window = this.window;

    if (window === undefined) return;

    if (window.observations.length >= MAX_RECORDING_V2_OBSERVATIONS - (kind === "finish" ? 0 : 1)) {
      this.invalidate("journal_observations");

      return;
    }

    const entry: RecordingEntryV2 = [window.entries.length, atMs, "boundary", kind];

    const observation: ReplayObservationV2 = {
      boundarySeq: entry[0],
      snapshot,
      gap,
      events: this.events.slice(window.eventOffset),
      commands: this.commands.slice(window.commandOffset),
    };

    // Output bytes already count once in the lifetime budget.
    const cost = bytes(entry) + bytes({ ...observation, events: [], commands: [] });

    if (!this.reserve(cost)) return;
    window.entries.push(entry);
    window.observations.push(observation);
    window.eventOffset = this.events.length;
    window.commandOffset = this.commands.length;
    window.boundaryBytes += cost;
  }

  finish(): RecordingV2 | undefined {
    const window = this.window;

    if (window === undefined) return undefined;
    const last = window.entries.at(-1);

    if (last?.[2] !== "boundary") return undefined;
    window.entries[window.entries.length - 1] = [last[0], last[1], "boundary", "finish"];

    const parsed = RecordingV2Schema.safeParse({
      schemaVersion: 2,
      ...this.initialization,
      rideId: window.rideId,
      journalState: "complete",
      entries: window.entries,
      observations: window.observations,
      window: { startSeq: window.startSeq, finishSeq: window.entries.length - 1 },
    });

    if (!parsed.success) {
      this.invalidate("invalid_input");

      return undefined;
    }

    return parsed.data;
  }

  clearWindow(): void {
    this.window = undefined;
  }
}

function resequence(entry: RecordingEntryV2, seq: number): RecordingEntryV2 {
  switch (entry[2]) {
    case "arm":
      return [seq, entry[1], "arm"];
    case "trainer":
      return [seq, entry[1], "trainer", entry[3], entry[4], entry[5]];
    case "hr":
      return [seq, entry[1], "hr", entry[3]];
    case "shift":
      return [seq, entry[1], "shift", entry[3]];
    case "status":
      return [seq, entry[1], "status", entry[3], entry[4]];
    case "advance":
      return [seq, entry[1], "advance", entry[3]];
    case "boundary":
      return [seq, entry[1], "boundary", entry[3]];
    default: {
      const exhaustive: never = entry;

      return exhaustive;
    }
  }
}
