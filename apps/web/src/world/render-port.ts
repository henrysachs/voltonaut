import type { RenderPort } from "./render-link.js";
import type {
  RenderCommand,
  RenderControl,
  RenderReply,
  RenderViewport,
} from "./render-protocol.js";

function ignoreReply(): void {}

export class BrowserRenderPort implements RenderPort {
  private worker: Worker | undefined;
  private receive: (reply: RenderReply) => void = ignoreReply;

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This port transfers the owned native canvas exactly once.
    private readonly canvas: HTMLCanvasElement,
    private readonly routeId: string,
    private readonly wheelCircM: number,
    private readonly viewport: () => RenderViewport,
  ) {}

  private readonly onMessage = (event: { readonly data: RenderReply }): void => {
    this.receive(event.data);
  };

  private readonly onError = (): void => {
    this.receive({ type: "render.failed", reason: "worker-error" });
  };

  start(): void {
    this.worker = new Worker(new URL("./render-worker.ts", import.meta.url), {
      type: "module",
      name: "ride-render",
    });
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onError);
    this.worker.addEventListener("messageerror", this.onError);
    const offscreen = this.canvas.transferControlToOffscreen();

    const init: RenderCommand = {
      type: "render.init",
      canvas: offscreen,
      routeId: this.routeId,
      wheelCircM: this.wheelCircM,
      viewport: this.viewport(),
    };

    this.worker.postMessage(init, [offscreen]);
  }

  send(command: RenderControl): void {
    this.worker?.postMessage(command);
  }

  subscribe(listener: (reply: RenderReply) => void): () => void {
    this.receive = listener;

    return () => {
      this.receive = ignoreReply;
      this.worker?.removeEventListener("message", this.onMessage);
      this.worker?.removeEventListener("error", this.onError);
      this.worker?.removeEventListener("messageerror", this.onError);
    };
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }
}
