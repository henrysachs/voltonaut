import type { RideSnapshot } from "@voltonaut/engine";
import type { AvatarConfig } from "@voltonaut/shared";

import type {
  RenderFailure,
  RenderReply,
  RenderTimer,
  RenderViewport,
  SceneDiagnostics,
} from "./render-protocol.js";
import type { SceneCore } from "./scene-core.js";

interface RenderClock extends RenderTimer {
  readonly nowMs: () => number;
  readonly requestFrame: (callback: (nowMs: number) => void) => number;
  readonly cancelFrame: (id: number) => void;
}

type State =
  | { readonly kind: "waiting" }
  | { readonly kind: "running"; readonly core: SceneCore }
  | { readonly kind: "failed" | "disposed" };

class RenderLoop {
  private state: State = { kind: "waiting" };
  private latest: Readonly<RideSnapshot> | undefined;
  private frameId = 0;
  private timerId = 0;
  private lastDiagnosticsMs = -Infinity;

  constructor(
    private readonly clock: RenderClock,
    private readonly send: (reply: RenderReply) => void,
  ) {}

  private release(): void {
    this.clock.cancelFrame(this.frameId);
    this.clock.cancel(this.timerId);
    const previous = this.state;

    this.state = { kind: "disposed" };
    this.latest = undefined;

    if (previous.kind === "running") previous.core.dispose();
  }

  fail(reason: RenderFailure): void {
    if (this.state.kind === "failed" || this.state.kind === "disposed") return;
    this.release();
    this.state = { kind: "failed" };
    this.send({ type: "render.failed", reason });
  }

  private readonly request = (): void => {
    if (this.state.kind === "running") this.frameId = this.clock.requestFrame(this.animate);
  };

  private afterRender(startedMs: number, diagnostics: SceneDiagnostics | undefined): void {
    if (this.state.kind !== "running") return;

    // A following task includes native waits observed in Chromium, NOT a visible-pixel ACK.
    // Only browser screenshots prove visible presentation.
    if (diagnostics !== undefined && this.clock.nowMs() - this.lastDiagnosticsMs >= 250) {
      this.lastDiagnosticsMs = this.clock.nowMs();
      this.send({ type: "render.frame", stage: "after-render-task", diagnostics });
    }

    this.timerId = this.clock.schedule(
      this.request,
      Math.min(250, Math.max(0, this.clock.nowMs() - startedMs)),
    );
  }

  private readonly animate = (nowMs: number): void => {
    if (this.state.kind !== "running") return;
    const startedMs = this.clock.nowMs();

    try {
      const diagnostics =
        this.latest === undefined ? undefined : this.state.core.render(this.latest, nowMs);

      this.timerId = this.clock.schedule(() => {
        this.afterRender(startedMs, diagnostics);
      }, 0);
    } catch {
      this.fail("render-error");
    }
  };

  start(create: () => SceneCore): void {
    if (this.state.kind !== "waiting") return;

    try {
      this.state = { kind: "running", core: create() };
      this.send({ type: "render.ready" });
      this.request();
    } catch {
      this.fail("initialization");
    }
  }

  snapshot(sequence: number, next: Readonly<RideSnapshot>): void {
    if (this.state.kind !== "running") return;
    this.latest = next;
    this.send({ type: "render.accepted", sequence });
  }

  resize(viewport: RenderViewport): void {
    if (this.state.kind !== "running") return;

    try {
      this.state.core.resize(viewport);
    } catch {
      this.fail("render-error");
    }
  }

  look(look: Readonly<AvatarConfig>): void {
    if (this.state.kind !== "running") return;

    try {
      this.state.core.setLook(look);
    } catch {
      this.fail("render-error");
    }
  }

  toggleCamera(): void {
    if (this.state.kind === "running")
      this.send({ type: "render.camera", mode: this.state.core.toggleCamera() });
  }

  dispose(): void {
    if (this.state.kind === "disposed") return;
    this.release();
    this.send({ type: "render.disposed" });
  }
}

export function createRenderLoop(
  clock: RenderClock,
  send: (reply: RenderReply) => void,
): RenderLoop {
  return new RenderLoop(clock, send);
}
