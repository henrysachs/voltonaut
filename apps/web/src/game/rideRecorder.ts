import {
  CompletedLocalRideSchema,
  LocalRideMetadataSchema,
  LocalRidePointSchema,
  MAX_LOCAL_RIDE_MS,
  type CompletedLocalRide,
  type DeviceEvent,
  type LocalRideMetadata,
  type LocalRidePoint,
} from "@voltonaut/shared";

interface Reading {
  readonly value: number;
  readonly atMs: number;
}

type RecorderState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "recording";
      readonly rideId: string;
      readonly startedAt: string;
      readonly baselineM: number;
      readonly startMs: number;
      readonly samples: readonly LocalRidePoint[];
    }
  | { readonly kind: "completed"; readonly ride: CompletedLocalRide };

interface RecorderOptions {
  readonly nowMs: () => number;
  readonly utcNow: () => string;
  readonly newId: () => string;
  readonly metadata: LocalRideMetadata;
}

export interface RideRecorder {
  readonly state: () => RecorderState;
  readonly ingest: (event: DeviceEvent) => void;
  readonly start: (distanceM: number) => void;
  readonly sample: (distanceM: number) => void;
  readonly finish: (distanceM: number) => CompletedLocalRide;
  readonly discard: () => void;
}

const FRESH_MS = 2500;

function fresh(reading: Reading | undefined, nowMs: number): number | undefined {
  return reading !== undefined && nowMs >= reading.atMs && nowMs - reading.atMs <= FRESH_MS
    ? reading.value
    : undefined;
}

class Recorder implements RideRecorder {
  readonly #options: RecorderOptions;
  #state: RecorderState = { kind: "idle" };
  #power: Reading | undefined;
  #cadence: Reading | undefined;
  #heartRate: Reading | undefined;

  constructor(options: RecorderOptions) {
    this.#options = { ...options, metadata: LocalRideMetadataSchema.parse(options.metadata) };
  }

  state(): RecorderState {
    return this.#state;
  }

  discard(): void {
    if (this.#state.kind === "recording") {
      this.#state = { kind: "idle" };
    }
  }

  private point(elapsedMs: number, distanceM: number, gap: boolean): LocalRidePoint {
    const nowMs = this.#options.nowMs();
    const powerW = fresh(this.#power, nowMs);
    const cadenceRpm = fresh(this.#cadence, nowMs);

    const parsed = LocalRidePointSchema.safeParse({
      elapsedMs,
      distanceM,
      powerW,
      cadenceRpm,
      hrBpm: fresh(this.#heartRate, nowMs),
      gap: gap || powerW === undefined || cadenceRpm === undefined,
    });

    if (!parsed.success) {
      throw new Error("Aufnahme ungültig: Messwerte oder Zeit außerhalb der Grenzen.");
    }

    return parsed.data;
  }

  sample(distanceM: number): void {
    this.appendSample(distanceM, false);
  }

  private appendSample(distanceM: number, final: boolean): void {
    const state = this.#state;

    if (state.kind !== "recording") {
      return;
    }

    const elapsedMs = Math.round(this.#options.nowMs() - state.startMs);
    const last = state.samples.at(-1);

    if (
      !Number.isFinite(distanceM) ||
      !Number.isFinite(elapsedMs) ||
      distanceM < state.baselineM ||
      elapsedMs < 0 ||
      elapsedMs > MAX_LOCAL_RIDE_MS ||
      (last !== undefined && elapsedMs < last.elapsedMs)
    ) {
      throw new Error(
        "Aufnahme ungültig: Zeit oder Distanz außerhalb der Grenzen. Maximal 6 Stunden aufnehmen.",
      );
    }

    if (
      last !== undefined &&
      (elapsedMs === last.elapsedMs || (!final && elapsedMs - last.elapsedMs < 1000))
    ) {
      return;
    }

    const next = this.point(
      elapsedMs,
      distanceM - state.baselineM,
      last !== undefined && elapsedMs - last.elapsedMs > FRESH_MS,
    );

    if (last !== undefined && next.distanceM < last.distanceM) {
      throw new Error("Aufnahme ungültig: Distanz läuft rückwärts.");
    }

    this.#state = { ...state, samples: [...state.samples, next] };
  }

  ingest = (event: DeviceEvent): void => {
    const atMs = this.#options.nowMs();

    if (event.type === "trainer.data") {
      this.#power = event.powerW === undefined ? undefined : { value: event.powerW, atMs };
      this.#cadence =
        event.cadenceRpm === undefined ? undefined : { value: event.cadenceRpm, atMs };
    } else if (event.type === "hr.data") {
      this.#heartRate = { value: event.bpm, atMs };
    } else if (event.type === "device.status" && event.status !== "ready") {
      if (event.kind === "trainer") {
        this.#power = undefined;
        this.#cadence = undefined;
      } else if (event.kind === "heartRate") {
        this.#heartRate = undefined;
      }
    }
  };

  start(distanceM: number): void {
    if (this.#state.kind === "recording") {
      throw new Error("Aufnahme läuft bereits.");
    }

    const first = this.point(0, 0, false);

    if (!Number.isFinite(distanceM) || distanceM < 0) {
      throw new Error("Noch kein gültiger Fahrtstand verfügbar.");
    }

    this.#state = {
      kind: "recording",
      rideId: this.#options.newId(),
      startedAt: this.#options.utcNow(),
      baselineM: distanceM,
      startMs: this.#options.nowMs(),
      samples: [first],
    };
  }

  finish(distanceM: number): CompletedLocalRide {
    this.appendSample(distanceM, true);
    const state = this.#state;

    if (state.kind !== "recording") {
      throw new Error("Keine laufende Aufnahme.");
    }

    const parsed = CompletedLocalRideSchema.safeParse({
      schemaVersion: 1,
      rideId: state.rideId,
      startedAt: state.startedAt,
      metadata: this.#options.metadata,
      samples: state.samples,
    });

    if (!parsed.success) {
      throw new Error(
        "Aufnahme leer oder ungültig. Mindestens eine Sekunde mit Trainerdaten aufnehmen.",
      );
    }

    this.#state = { kind: "completed", ride: parsed.data };

    return parsed.data;
  }
}

export function createRideRecorder(options: RecorderOptions): RideRecorder {
  return new Recorder(options);
}
