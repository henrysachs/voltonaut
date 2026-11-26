import type { PreviewPort } from "./previewLink.js";
import type {
  PreviewCommand,
  PreviewControl,
  PreviewReply,
  PreviewViewport,
} from "./previewProtocol.js";

function ignoreReply(): void {}

export class BrowserPreviewPort implements PreviewPort {
  private worker: Worker | undefined;
  private receive: (reply: PreviewReply) => void = ignoreReply;

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This port transfers the owned native canvas exactly once.
    private readonly canvas: HTMLCanvasElement,
    private readonly wheelCircM: number,
    private readonly viewport: () => PreviewViewport,
  ) {}

  private readonly onMessage = (event: { readonly data: PreviewReply }): void => {
    this.receive(event.data);
  };

  private readonly onError = (): void => {
    this.receive({ type: "preview.failed", reason: "worker-error" });
  };

  start(): void {
    this.worker = new Worker(new URL("./previewWorker.ts", import.meta.url), {
      type: "module",
      name: "garage-preview",
    });
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onError);
    this.worker.addEventListener("messageerror", this.onError);
    const offscreen = this.canvas.transferControlToOffscreen();

    const init: PreviewCommand = {
      type: "preview.init",
      canvas: offscreen,
      wheelCircM: this.wheelCircM,
      viewport: this.viewport(),
    };

    this.worker.postMessage(init, [offscreen]);
  }

  send(command: PreviewControl): void {
    this.worker?.postMessage(command);
  }

  subscribe(listener: (reply: PreviewReply) => void): () => void {
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
