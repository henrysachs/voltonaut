import type { RideSnapshot } from "@voltonaut/engine";

import { createRenderLink } from "./render-link.js";
import { BrowserRenderPort } from "./render-port.js";
import {
  createRenderViewport,
  type RenderViewport,
  type SceneDiagnostics,
} from "./render-protocol.js";

export interface RideSceneOptions {
  readonly host: Readonly<HTMLElement>;
  readonly routeId: string;
  readonly snapshot: () => Readonly<RideSnapshot> | undefined;
  readonly wheelCircM: number;
  readonly debug: boolean;
}

export interface RideScene {
  readonly dispose: () => void;
}

function statusMessage(text: string): HTMLParagraphElement {
  const message = document.createElement("p");

  message.className = "scene__unavailable";
  message.textContent = text;
  message.setAttribute("role", "status");

  return message;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM children are owned and removed by this scene.
function showUnavailable(host: Readonly<HTMLElement>): RideScene {
  const message = statusMessage("3D unavailable. Your ride, devices and HUD still work.");

  host.append(message);

  return {
    dispose() {
      message.remove();
    },
  };
}

class RideSceneBridge implements RideScene {
  private readonly canvas = document.createElement("canvas");
  private readonly button = document.createElement("button");
  private readonly debug = document.createElement("output");
  private readonly loading = statusMessage(
    "Preparing 3D. Your ride, devices and HUD already work.",
  );
  private readonly observer = new ResizeObserver(() => {
    this.link.resize(this.viewport());
  });
  private readonly link;
  private state:
    | { readonly kind: "active" }
    | { readonly kind: "failed"; readonly fallback: RideScene }
    | { readonly kind: "disposed" } = { kind: "active" };
  private rafId = 0;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The bridge owns DOM children, listeners and the transferred canvas.
  constructor(private readonly options: RideSceneOptions) {
    this.canvas.className = "scene__canvas";
    this.canvas.setAttribute("aria-label", "3D ride scene");
    this.canvas.setAttribute("aria-busy", "true");
    this.button.className = "scene__camera";
    this.button.type = "button";
    this.button.textContent = "Camera: chase · C";
    this.debug.className = "scene__debug";
    this.debug.hidden = !options.debug;
    this.debug.setAttribute("aria-label", "Render diagnostics");
    this.loading.style.position = "absolute";
    this.loading.style.inset = "0";
    this.loading.style.pointerEvents = "none";
    options.host.append(this.canvas, this.button, this.debug, this.loading);
    this.button.addEventListener("click", this.toggleCamera);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("pagehide", this.dispose);
    this.link = createRenderLink(
      new BrowserRenderPort(this.canvas, options.routeId, options.wheelCircM, () =>
        this.viewport(),
      ),
      {
        failed: () => {
          this.detach();
          this.state = { kind: "failed", fallback: showUnavailable(options.host) };
        },
        frame: (diagnostics) => {
          this.updateDiagnostics(diagnostics);
        },
        camera: (mode) => {
          this.button.textContent = `Camera: ${mode} · C`;
        },
      },
      {
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: (id) => {
          window.clearTimeout(id);
        },
      },
    );

    if (this.state.kind === "active") {
      this.observer.observe(options.host);
      this.rafId = requestAnimationFrame(this.pump);
    }
  }

  private viewport(): RenderViewport {
    return createRenderViewport(
      this.options.host.clientWidth,
      this.options.host.clientHeight,
      window.devicePixelRatio,
    );
  }

  private updateDiagnostics(d: SceneDiagnostics): void {
    this.debug.textContent = `${d.calls} calls · ${d.triangles} triangles · ${d.camera}`;
    this.debug.dataset["calls"] = String(d.calls);
    this.debug.dataset["triangles"] = String(d.triangles);
    this.debug.dataset["riderX"] = String(d.rider.x);
    this.debug.dataset["riderY"] = String(d.rider.y);
    this.debug.dataset["riderZ"] = String(d.rider.z);
    this.debug.dataset["headingRad"] = String(d.headingRad);
    this.debug.dataset["crankRad"] = String(d.crankRad);
    this.debug.dataset["distanceM"] = String(d.distanceM);
    this.debug.dataset["camera"] = d.camera;
    this.debug.dataset["cameraX"] = String(d.cameraPosition.x);
    this.debug.dataset["cameraY"] = String(d.cameraPosition.y);
    this.debug.dataset["cameraZ"] = String(d.cameraPosition.z);
    this.debug.dataset["frameStage"] = "after-render-task";

    // The browser owns visible presentation; this marks only a completed render + following task.
    if (d.calls > 0 && d.triangles > 0) {
      this.loading.remove();
      this.canvas.setAttribute("aria-busy", "false");
    }
  }

  private readonly pump = (): void => {
    if (this.state.kind !== "active") return;
    const snapshot = this.options.snapshot();

    if (snapshot !== undefined) this.link.snapshot(snapshot);
    this.rafId = requestAnimationFrame(this.pump);
  };

  private readonly toggleCamera = (): void => {
    this.link.toggleCamera();
  };

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- KeyboardEvent is the native browser listener contract.
  private readonly onKey = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable)
    )
      return;

    if (
      event.key.toLowerCase() === "c" &&
      !event.repeat &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    )
      this.toggleCamera();
  };

  private detach(): void {
    cancelAnimationFrame(this.rafId);
    this.observer.disconnect();
    this.button.removeEventListener("click", this.toggleCamera);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("pagehide", this.dispose);
    this.canvas.remove();
    this.button.remove();
    this.debug.remove();
    this.loading.remove();
  }

  readonly dispose = (): void => {
    if (this.state.kind === "disposed") return;

    if (this.state.kind === "failed") this.state.fallback.dispose();
    this.state = { kind: "disposed" };
    this.detach();
    this.link.dispose();
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The bridge takes ownership of browser DOM children.
export function startRideScene(options: RideSceneOptions): RideScene {
  return new RideSceneBridge(options);
}
