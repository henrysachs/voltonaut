import type { PreviewControl, PreviewDraw, PreviewReply, PreviewTimer } from "./previewProtocol.js";

export interface PreviewPort {
  /** Starts the worker and transfers the canvas; called exactly once. */
  readonly start: () => void;
  readonly send: (command: PreviewControl) => void;
  readonly subscribe: (listener: (reply: PreviewReply) => void) => () => void;
  readonly terminate: () => void;
}

interface PreviewCallbacks {
  readonly failed: () => void;
  readonly drawn: (draw: PreviewDraw) => void;
}

type State =
  | { readonly kind: "active" }
  | { readonly kind: "stopping"; readonly timeoutId: number }
  | { readonly kind: "stopped" };

const TERMINATE_AFTER_MS = 1000;

/**
 * Main-side lifecycle of the garage preview worker (ADR-032, after ADR-019).
 * Commands are posted in order after init, so the worker never sees one before its scene exists.
 */
class PreviewLink {
  private state: State = { kind: "active" };
  private readonly unsubscribe;

  constructor(
    private readonly port: PreviewPort,
    private readonly callbacks: PreviewCallbacks,
    private readonly timer: PreviewTimer,
  ) {
    this.unsubscribe = port.subscribe(this.receive);

    try {
      port.start();
    } catch {
      this.fail();
    }
  }

  private readonly terminate = (): void => {
    if (this.state.kind === "stopped") return;

    if (this.state.kind === "stopping") this.timer.cancel(this.state.timeoutId);
    this.state = { kind: "stopped" };
    this.unsubscribe();
    this.port.terminate();
  };

  readonly dispose = (): void => {
    if (this.state.kind !== "active") return;
    this.state = {
      kind: "stopping",
      timeoutId: this.timer.schedule(this.terminate, TERMINATE_AFTER_MS),
    };

    try {
      this.port.send({ type: "preview.dispose" });
    } catch {
      this.terminate();
    }
  };

  private fail(): void {
    if (this.state.kind !== "active") return;
    this.dispose();
    this.callbacks.failed();
  }

  private readonly receive = (reply: PreviewReply): void => {
    if (reply.type === "preview.disposed") {
      if (this.state.kind === "stopping") this.terminate();
      else this.fail();

      return;
    }

    if (this.state.kind !== "active") return;

    switch (reply.type) {
      case "preview.ready":
        break;
      case "preview.drawn":
        this.callbacks.drawn(reply.draw);
        break;
      case "preview.failed":
        this.fail();
        break;
    }
  };

  send(command: Exclude<PreviewControl, { type: "preview.dispose" }>): void {
    if (this.state.kind !== "active") return;

    try {
      this.port.send(command);
    } catch {
      this.fail();
    }
  }
}

export function createPreviewLink(
  port: PreviewPort,
  callbacks: PreviewCallbacks,
  timer: PreviewTimer,
): PreviewLink {
  return new PreviewLink(port, callbacks, timer);
}
