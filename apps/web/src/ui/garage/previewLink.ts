import type { PreviewControl, PreviewDraw, PreviewReply, PreviewTimer } from "./previewProtocol.js";

export interface PreviewPort {
  /** Starts the worker and transfers the canvas; called exactly once. */
  readonly start: () => void;
  readonly send: (command: PreviewControl) => void;
  readonly subscribe: (listener: (reply: Readonly<PreviewReply>) => void) => () => void;
  readonly terminate: () => void;
}

interface PreviewCallbacks {
  readonly failed: () => void;
  readonly drawn: (draw: PreviewDraw) => void;
}

interface PendingCapture {
  readonly resolve: (blob: Readonly<Blob>) => void;
  readonly reject: (error: Readonly<Error>) => void;
}

type State =
  | { readonly kind: "active" }
  | { readonly kind: "stopping"; readonly timeoutId: number }
  | { readonly kind: "stopped" };

const TERMINATE_AFTER_MS = 1000;

function noop(): void {}

/**
 * Main-side lifecycle of the garage preview worker (ADR-032, after ADR-019).
 * Commands are posted in order after init, so the worker never sees one before its scene exists.
 */
class PreviewLink {
  private state: State = { kind: "active" };
  private readonly pendingCaptures = new Map<number, PendingCapture>();
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

  private rejectPendingCaptures(): void {
    for (const pending of this.pendingCaptures.values()) {
      pending.reject(new Error("Preview capture failed"));
    }

    this.pendingCaptures.clear();
  }

  private readonly terminate = (): void => {
    if (this.state.kind === "stopped") return;

    if (this.state.kind === "stopping") this.timer.cancel(this.state.timeoutId);
    this.state = { kind: "stopped" };
    this.rejectPendingCaptures();
    this.unsubscribe();
    this.port.terminate();
  };

  readonly dispose = (): void => {
    if (this.state.kind !== "active") return;
    this.rejectPendingCaptures();
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

  private readonly receive = (reply: Readonly<PreviewReply>): void => {
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
      case "preview.captured": {
        const pending = this.pendingCaptures.get(reply.requestId);

        if (pending === undefined) break;

        this.pendingCaptures.delete(reply.requestId);
        pending.resolve(reply.blob);
        break;
      }

      case "preview.failed":
        this.fail();
        break;
    }
  };

  capture(requestId: number): Promise<Blob> {
    if (this.state.kind !== "active") return Promise.reject(new Error("Preview is not active"));

    if (this.pendingCaptures.has(requestId)) {
      return Promise.reject(new Error("Duplicate preview capture request"));
    }

    let resolveCapture: (blob: Readonly<Blob>) => void = noop;
    let rejectCapture: (error: Readonly<Error>) => void = noop;

    const promise = new Promise<Blob>((resolve, reject) => {
      resolveCapture = (blob) => {
        resolve(blob);
      };

      rejectCapture = (error) => {
        reject(error);
      };
    });

    this.pendingCaptures.set(requestId, { resolve: resolveCapture, reject: rejectCapture });

    this.send({ type: "preview.capture", requestId });

    return promise;
  }

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
