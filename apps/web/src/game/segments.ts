import type { EngineRoute, RideSnapshot, SegmentDef } from "@voltonaut/engine";
import type { RideEvent } from "@voltonaut/shared";

export type SegmentProgress =
  | { readonly kind: "idle" }
  | {
      readonly kind: "active";
      readonly lap: number;
      readonly elapsedS: number;
      readonly remainingM: number;
    }
  | { readonly kind: "finished"; readonly lap: number; readonly timeS: number }
  | {
      readonly kind: "invalid";
      readonly reason: "clock_skipped" | "missing_entry" | "engine_unavailable" | "invalid_timing";
    };

export interface SegmentHudRow {
  readonly segment: SegmentDef;
  readonly progress: SegmentProgress;
}

export interface SegmentHudView {
  readonly scope: "session_preview";
  readonly timing: "tick";
  readonly rows: readonly SegmentHudRow[];
}

export interface SegmentBatch {
  readonly events: readonly RideEvent[];
  readonly snapshot: RideSnapshot;
}

export interface SegmentProjector {
  readonly consume: (batch: SegmentBatch) => void;
  readonly view: () => SegmentHudView;
  readonly unavailable: () => void;
}

type Attempt =
  | Exclude<SegmentProgress, { readonly kind: "active" | "finished" }>
  | (Extract<SegmentProgress, { readonly kind: "finished" }> & { readonly exitedTS: number })
  | { readonly kind: "running"; readonly lap: number; readonly enteredTS: number };

type TimedEvent = Extract<
  RideEvent,
  { readonly type: "segment.entered" | "segment.exited" | "lap.completed" }
>;

class SessionSegments implements SegmentProjector {
  private readonly definitions: readonly SegmentDef[];
  private readonly attempts = new Map<string, Attempt>();
  private snapshot: RideSnapshot | undefined;
  private lap = 0;
  private available = true;

  constructor(private readonly route: Pick<EngineRoute, "lengthM" | "loop" | "segments">) {
    this.definitions = route.segments.filter((segment) => segment.kind !== "lap");

    for (const segment of this.definitions) this.attempts.set(segment.id, { kind: "idle" });
  }

  private invalidateActive(
    reason: Extract<SegmentProgress, { readonly kind: "invalid" }>["reason"],
  ): void {
    for (const [id, attempt] of this.attempts) {
      if (attempt.kind === "running") this.attempts.set(id, { kind: "invalid", reason });
    }
  }

  private apply(event: TimedEvent, validTime: boolean): void {
    if (event.type === "lap.completed") {
      this.lap = event.lap;

      return;
    }

    const attempt = this.attempts.get(event.segmentId);

    if (attempt === undefined) return;

    if (event.type === "segment.entered" && attempt.kind === "running") return;

    if (
      event.type === "segment.exited" &&
      attempt.kind === "finished" &&
      event.tS === attempt.exitedTS
    )
      return;

    if (!validTime) {
      this.attempts.set(event.segmentId, { kind: "invalid", reason: "invalid_timing" });
    } else if (event.type === "segment.entered") {
      this.attempts.set(event.segmentId, { kind: "running", enteredTS: event.tS, lap: this.lap });
    } else if (attempt.kind === "running") {
      const timeS = event.tS - attempt.enteredTS;
      const segment = this.definitions.find((definition) => definition.id === event.segmentId);

      const matchingLap =
        attempt.lap === this.lap ||
        (this.route.loop && segment?.endM === this.route.lengthM && this.lap === attempt.lap + 1);

      this.attempts.set(
        event.segmentId,
        timeS > 0 && matchingLap
          ? { kind: "finished", lap: attempt.lap, timeS, exitedTS: event.tS }
          : { kind: "invalid", reason: "invalid_timing" },
      );
    } else if (attempt.kind !== "invalid") {
      this.attempts.set(event.segmentId, { kind: "invalid", reason: "missing_entry" });
    }
  }

  consume(batch: SegmentBatch): void {
    if (!this.available) return;
    const previous = this.snapshot;
    const next = batch.snapshot;
    const skipped = batch.events.some((event) => event.type === "ride.clockSkipped");

    const regressed =
      previous !== undefined && (next.tS < previous.tS || next.distanceM < previous.distanceM);

    const reason = skipped ? "clock_skipped" : "invalid_timing";

    if (skipped || regressed) this.invalidateActive(reason);
    let eventTS = previous?.tS ?? 0;

    for (const event of batch.events) {
      if (
        event.type !== "segment.entered" &&
        event.type !== "segment.exited" &&
        event.type !== "lap.completed"
      )
        continue;

      if (event.type !== "lap.completed" && !this.attempts.has(event.segmentId)) continue;

      if ((skipped || regressed) && event.type !== "lap.completed") {
        this.attempts.set(event.segmentId, { kind: "invalid", reason });
        continue;
      }

      this.apply(event, Number.isFinite(event.tS) && event.tS >= eventTS && event.tS <= next.tS);
      eventTS = Math.max(eventTS, event.tS);
    }

    this.snapshot = next;
    this.rejectIncomplete(next, previous);
  }

  private rejectIncomplete(next: RideSnapshot, previous: RideSnapshot | undefined): void {
    for (const segment of this.definitions) {
      const attempt = this.attempts.get(segment.id);

      if (attempt?.kind !== "running") continue;

      if (
        next.lap !== attempt.lap ||
        next.lap !== this.lap ||
        next.tS < attempt.enteredTS ||
        next.routePosM < segment.startM ||
        next.routePosM >= segment.endM ||
        (previous !== undefined && next.lap === previous.lap && next.routePosM < previous.routePosM)
      ) {
        this.attempts.set(segment.id, { kind: "invalid", reason: "invalid_timing" });
      }
    }
  }

  view(): SegmentHudView {
    return {
      scope: "session_preview",
      timing: "tick",
      rows: this.definitions.map((segment) => {
        const attempt = this.attempts.get(segment.id) ?? { kind: "idle" };
        const snapshot = this.snapshot;

        if (attempt.kind === "finished")
          return {
            segment,
            progress: { kind: "finished", lap: attempt.lap, timeS: attempt.timeS },
          };

        const progress: SegmentProgress =
          attempt.kind === "running" && snapshot !== undefined
            ? {
                kind: "active",
                lap: attempt.lap,
                elapsedS: snapshot.tS - attempt.enteredTS,
                remainingM: Math.max(
                  0,
                  Math.min(segment.endM - segment.startM, segment.endM - snapshot.routePosM),
                ),
              }
            : attempt.kind === "running"
              ? { kind: "idle" }
              : attempt;

        return { segment, progress };
      }),
    };
  }

  unavailable(): void {
    this.available = false;

    for (const [id, attempt] of this.attempts) {
      if (attempt.kind === "running" || attempt.kind === "idle") {
        this.attempts.set(id, { kind: "invalid", reason: "engine_unavailable" });
      }
    }
  }
}

export function createSegmentProjector(
  route: Pick<EngineRoute, "lengthM" | "loop" | "segments">,
): SegmentProjector {
  return new SessionSegments(route);
}
