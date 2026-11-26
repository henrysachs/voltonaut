import { AvatarConfigSchema, type AvatarConfig } from "@voltonaut/shared";

import type {
  PreviewDraw,
  PreviewFailure,
  PreviewReply,
  PreviewTimer,
  PreviewViewport,
} from "./previewProtocol.js";

/** The worker-owned three scene; `render` returns undefined when nothing was drawn. */
export interface PreviewScene {
  readonly render: (angleRad: number) => PreviewDraw | undefined;
  readonly resize: (viewport: PreviewViewport) => void;
  readonly setLook: (look: Readonly<AvatarConfig>) => void;
  readonly dispose: () => void;
}

export interface PreviewClock extends PreviewTimer {
  readonly requestFrame: (callback: (nowMs: number) => void) => number;
  readonly cancelFrame: (id: number) => void;
}

const AUTO_ROTATE_RAD_PER_S = 0.22;
const MAX_FRAME_STEP_S = 0.1;

type State =
  | { readonly kind: "waiting" }
  | { readonly kind: "running"; readonly scene: PreviewScene }
  | { readonly kind: "failed" | "disposed" };

type FirstDraw =
  | { readonly kind: "pending" }
  | { readonly kind: "confirming" }
  | { readonly kind: "reported" };

/** Worker-side rAF loop of the garage preview: angle, auto-rotate and first-draw readiness. */
class PreviewLoop {
  private state: State = { kind: "waiting" };
  private firstDraw: FirstDraw = { kind: "pending" };
  private angleRad = -0.65;
  private autoRotate = false;
  private lastFrameMs: number | undefined;
  private frameId = 0;
  private timerId = 0;

  constructor(
    private readonly clock: PreviewClock,
    private readonly send: (reply: PreviewReply) => void,
  ) {}

  private release(next: Extract<State, { kind: "failed" | "disposed" }>): void {
    this.clock.cancelFrame(this.frameId);
    this.clock.cancel(this.timerId);
    const previous = this.state;

    this.state = next;

    if (previous.kind === "running") previous.scene.dispose();
  }

  fail(reason: PreviewFailure): void {
    if (this.state.kind === "failed" || this.state.kind === "disposed") return;
    this.release({ kind: "failed" });
    this.send({ type: "preview.failed", reason });
  }

  private readonly animate = (nowMs: number): void => {
    if (this.state.kind !== "running") return;

    const elapsedS =
      this.lastFrameMs === undefined
        ? 0
        : Math.min((nowMs - this.lastFrameMs) / 1000, MAX_FRAME_STEP_S);

    this.lastFrameMs = nowMs;

    if (this.autoRotate) this.angleRad += elapsedS * AUTO_ROTATE_RAD_PER_S;

    try {
      const draw = this.state.scene.render(this.angleRad);

      if (draw !== undefined) this.confirmFirstDraw(draw);
    } catch {
      this.fail("render-error");

      return;
    }

    this.frameId = this.clock.requestFrame(this.animate);
  };

  /** Readiness is a real draw with geometry plus one following worker task, as in ADR-019. */
  private confirmFirstDraw(draw: PreviewDraw): void {
    if (this.firstDraw.kind !== "pending" || draw.calls === 0 || draw.triangles === 0) return;
    this.firstDraw = { kind: "confirming" };
    this.timerId = this.clock.schedule(() => {
      if (this.state.kind !== "running" || this.firstDraw.kind !== "confirming") return;
      this.firstDraw = { kind: "reported" };
      this.send({ type: "preview.drawn", draw });
    }, 0);
  }

  start(create: () => PreviewScene): void {
    if (this.state.kind !== "waiting") return;

    try {
      this.state = { kind: "running", scene: create() };
    } catch {
      this.fail("initialization");

      return;
    }

    this.send({ type: "preview.ready" });
    this.frameId = this.clock.requestFrame(this.animate);
  }

  /** The look crosses a worker boundary, so it is parsed before it reaches the avatar. */
  look(candidate: Readonly<AvatarConfig>): void {
    if (this.state.kind !== "running") return;

    const parsed = AvatarConfigSchema.safeParse(candidate);

    if (!parsed.success) {
      this.fail("invalid-look");

      return;
    }

    try {
      this.state.scene.setLook(parsed.data);
    } catch {
      this.fail("render-error");
    }
  }

  setAutoRotate(enabled: boolean): void {
    this.autoRotate = enabled;
  }

  rotateBy(angleRad: number): void {
    if (Number.isFinite(angleRad)) this.angleRad += angleRad;
  }

  resize(viewport: PreviewViewport): void {
    if (this.state.kind !== "running") return;

    try {
      this.state.scene.resize(viewport);
    } catch {
      this.fail("render-error");
    }
  }

  dispose(): void {
    if (this.state.kind === "disposed") return;
    this.release({ kind: "disposed" });
    this.send({ type: "preview.disposed" });
  }
}

export function createPreviewLoop(
  clock: PreviewClock,
  send: (reply: PreviewReply) => void,
): PreviewLoop {
  return new PreviewLoop(clock, send);
}
