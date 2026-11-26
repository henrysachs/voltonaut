import type { RideSnapshot } from "@voltonaut/engine";
import type { AvatarConfig } from "@voltonaut/shared";

import type { CameraMode } from "./camera.js";
import type {
  RenderControl,
  RenderReply,
  RenderTimer,
  RenderViewport,
  SceneDiagnostics,
} from "./render-protocol.js";

export interface RenderPort {
  readonly start: () => void;
  readonly send: (command: RenderControl) => void;
  readonly subscribe: (listener: (reply: RenderReply) => void) => () => void;
  readonly terminate: () => void;
}

interface RenderCallbacks {
  readonly failed: () => void;
  readonly frame: (diagnostics: SceneDiagnostics) => void;
  readonly camera: (mode: CameraMode) => void;
}

type State =
  | { readonly kind: "starting" | "running" }
  | { readonly kind: "stopping"; readonly timeoutId: number }
  | { readonly kind: "stopped" };

type Mailbox = { readonly kind: "idle" } | { readonly kind: "awaiting"; readonly sequence: number };

/** Only presentation snapshots may be replaced; device/engine/recording events never enter this link. */
class RenderLink {
  private state: State = { kind: "starting" };
  private mailbox: Mailbox = { kind: "idle" };
  private pending: Readonly<RideSnapshot> | undefined;
  private lastSnapshot: Readonly<RideSnapshot> | undefined;
  /** The latest look; kept until the worker is ready so an early garage result is not lost. */
  private wornLook: Readonly<AvatarConfig> | undefined;
  private sequence = 0;
  private readonly unsubscribe;

  constructor(
    private readonly port: RenderPort,
    private readonly callbacks: RenderCallbacks,
    private readonly timer: RenderTimer,
  ) {
    this.unsubscribe = port.subscribe(this.receive);

    try {
      port.start();
    } catch {
      this.fail();
    }
  }

  private active(): boolean {
    return this.state.kind === "starting" || this.state.kind === "running";
  }

  private readonly terminate = (): void => {
    if (this.state.kind === "stopped") return;

    if (this.state.kind === "stopping") this.timer.cancel(this.state.timeoutId);
    this.state = { kind: "stopped" };
    this.unsubscribe();
    this.port.terminate();
  };

  readonly dispose = (): void => {
    if (!this.active()) return;
    this.state = { kind: "stopping", timeoutId: this.timer.schedule(this.terminate, 1000) };
    this.pending = undefined;
    this.lastSnapshot = undefined;

    try {
      this.port.send({ type: "render.dispose" });
    } catch {
      this.terminate();
    }
  };

  private fail(): void {
    if (!this.active()) return;
    this.dispose();
    this.callbacks.failed();
  }

  private send(command: RenderControl): void {
    if (!this.active()) return;

    try {
      this.port.send(command);
    } catch {
      this.fail();
    }
  }

  private flush(): void {
    if (this.state.kind !== "running" || this.mailbox.kind !== "idle" || this.pending === undefined)
      return;
    this.sequence += 1;
    this.mailbox = { kind: "awaiting", sequence: this.sequence };
    const snapshot = this.pending;

    this.pending = undefined;
    this.send({ type: "render.snapshot", sequence: this.sequence, snapshot });
  }

  private readonly receive = (reply: RenderReply): void => {
    if (reply.type === "render.disposed") {
      if (this.state.kind === "stopping") this.terminate();
      else if (this.active()) this.fail();

      return;
    }

    if (!this.active()) return;

    switch (reply.type) {
      case "render.ready":
        if (this.state.kind === "starting") {
          this.state = { kind: "running" };

          if (this.wornLook !== undefined) this.send({ type: "render.look", look: this.wornLook });
          this.flush();
        }

        break;
      case "render.accepted":
        if (this.mailbox.kind === "awaiting" && this.mailbox.sequence === reply.sequence) {
          this.mailbox = { kind: "idle" };
          this.flush();
        }

        break;
      case "render.frame":
        if (this.state.kind === "running") this.callbacks.frame(reply.diagnostics);
        break;
      case "render.camera":
        this.callbacks.camera(reply.mode);
        break;
      case "render.failed":
        this.fail();
        break;
    }
  };

  snapshot(snapshot: Readonly<RideSnapshot>): void {
    if (!this.active() || snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    this.pending = snapshot;
    this.flush();
  }

  look(look: Readonly<AvatarConfig>): void {
    if (!this.active()) return;
    this.wornLook = look;

    if (this.state.kind === "running") this.send({ type: "render.look", look });
  }

  resize(viewport: RenderViewport): void {
    this.send({ type: "render.resize", viewport });
  }

  toggleCamera(): void {
    this.send({ type: "render.toggleCamera" });
  }
}

export function createRenderLink(
  port: RenderPort,
  callbacks: RenderCallbacks,
  timer: RenderTimer,
): RenderLink {
  return new RenderLink(port, callbacks, timer);
}
