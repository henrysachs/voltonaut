import type { AvatarConfig } from "@voltonaut/shared";

import { createPreviewLink } from "./previewLink.js";
import { BrowserPreviewPort } from "./previewPort.js";
import type { PreviewViewport } from "./previewProtocol.js";
import type { PreviewOrbit } from "./previewOrbit.js";

export interface GaragePreviewView {
  readonly setLook: (config: AvatarConfig) => void;
  readonly setAutoRotate: (enabled: boolean) => void;
  readonly setOrbit: (orbit: Readonly<PreviewOrbit>) => void;
  readonly capture: () => Promise<Blob>;
  readonly dispose: () => void;
}

type State = { readonly kind: "starting" | "active" } | { readonly kind: "failed" | "disposed" };

/**
 * Main side of the garage preview (ADR-032). The canvas is transferred once to the preview
 * worker, which owns WebGL, three, the avatar and the rAF loop; main keeps DOM, size and input.
 */
class GaragePreviewWorkerView implements GaragePreviewView {
  readonly #canvas = document.createElement("canvas");
  readonly #observer = new ResizeObserver(() => {
    this.#link.send({ type: "preview.resize", viewport: this.#viewport() });
  });
  readonly #link;
  #state: State = { kind: "starting" };
  #nextCaptureRequestId = 0;

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The view owns the host's canvas child.
    private readonly host: HTMLElement,
    wheelCircM: number,
    unavailable: () => void,
  ) {
    this.#canvas.className = "garage__canvas";
    this.#canvas.setAttribute("role", "img");
    this.#canvas.setAttribute("aria-label", "Provisorische 3D-Vorschau von Fahrer und Rad");
    this.#canvas.setAttribute("aria-busy", "true");
    this.host.append(this.#canvas);
    this.#link = createPreviewLink(
      new BrowserPreviewPort(this.#canvas, wheelCircM, () => this.#viewport()),
      {
        failed: () => {
          const reported = this.#state.kind === "active";

          this.#state = { kind: "failed" };
          this.#detach();

          if (reported) unavailable();
        },
        drawn: () => {
          this.#canvas.dataset["previewReady"] = "true";
          this.#canvas.setAttribute("aria-busy", "false");
        },
      },
      {
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: (id) => {
          window.clearTimeout(id);
        },
      },
    );

    if (this.#state.kind === "starting") {
      this.#state = { kind: "active" };
      this.#observer.observe(this.host);
    }
  }

  get failed(): boolean {
    return this.#state.kind === "failed";
  }

  #viewport(): PreviewViewport {
    return {
      widthCssPx: this.host.clientWidth,
      heightCssPx: this.host.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
    };
  }

  setLook(config: AvatarConfig): void {
    this.#link.send({ type: "preview.look", look: config });
  }

  setAutoRotate(enabled: boolean): void {
    this.#link.send({ type: "preview.autoRotate", enabled });
  }

  setOrbit(orbit: Readonly<PreviewOrbit>): void {
    this.#link.send({ type: "preview.orbit", orbit });
  }

  capture(): Promise<Blob> {
    this.#nextCaptureRequestId += 1;

    return this.#link.capture(this.#nextCaptureRequestId);
  }

  #detach(): void {
    this.#observer.disconnect();
    this.#canvas.remove();
  }

  readonly dispose = (): void => {
    if (this.#state.kind === "disposed") return;
    this.#state = { kind: "disposed" };
    this.#detach();
    this.#link.dispose();
  };
}

/** Null when the browser cannot move the preview off main; there is no main-thread fallback. */
export function createGaragePreviewView(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The view owns the host's canvas child.
  host: HTMLElement,
  wheelCircM: number,
  unavailable: () => void,
): GaragePreviewView | null {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;

  const view = new GaragePreviewWorkerView(host, wheelCircM, unavailable);

  return view.failed ? null : view;
}
