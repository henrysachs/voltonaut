import type {
  CapturedRide,
  CaptureUnavailabilityReason,
  DeviceEvent,
  RideEvent,
  TrainerCommand,
} from "@voltonaut/shared";
import type { RideSnapshot } from "@voltonaut/engine";

export type CaptureAvailability =
  | { readonly kind: "journal" }
  | { readonly kind: "local_only"; readonly reason: CaptureUnavailabilityReason };

export type CaptureView =
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "idle"; readonly availability: CaptureAvailability }
  | {
      readonly kind: "recording";
      readonly rideId: string;
      readonly elapsedMs: number;
      readonly availability: CaptureAvailability;
    }
  | {
      readonly kind: "completed";
      readonly rideId: string;
      readonly availability: CaptureAvailability;
    };

export type CaptureCommand =
  | { readonly kind: "start"; readonly rideId: string }
  | { readonly kind: "finish"; readonly rideId: string }
  | { readonly kind: "discard"; readonly rideId: string }
  | { readonly kind: "release"; readonly rideId: string };

export type CaptureResult =
  | { readonly kind: "state"; readonly view: CaptureView }
  | { readonly kind: "finished"; readonly capture: CapturedRide; readonly view: CaptureView }
  | { readonly kind: "failed"; readonly message: string; readonly view: CaptureView };

/** Async controls only: the worker owns time, raw readings, samples and completion. */
export interface RecordingControls {
  readonly state: () => CaptureView;
  readonly subscribe: (listener: (view: CaptureView) => void) => () => void;
  readonly start: () => Promise<void>;
  readonly finish: () => Promise<CapturedRide>;
  readonly discard: () => Promise<void>;
  readonly release: (rideId: string) => Promise<void>;
}

export function isNewCaptureRequest(requestId: number, lastRequestId: number): boolean {
  return Number.isSafeInteger(requestId) && requestId > lastRequestId;
}

export interface RideRecorder {
  readonly view: (atMs: number) => CaptureView;
  readonly ingest: (event: DeviceEvent, atMs: number) => void;
  readonly arm: (atMs: number) => void;
  readonly advance: (atMs: number, elapsedRealS: number) => void;
  readonly outputs: (events: readonly RideEvent[], commands: readonly TrainerCommand[]) => void;
  readonly sample: (atMs: number, snapshot: RideSnapshot) => void;
  /** Makes every later capture of this session local-only with the given reason. */
  readonly invalidate: (reason: CaptureUnavailabilityReason) => void;
  readonly command: (
    command: CaptureCommand,
    atMs: number,
    snapshot: RideSnapshot,
  ) => CaptureResult;
}
