import type { EngineRoute, RideSnapshot } from "@voltonaut/engine";
import * as THREE from "three";

import { createRider } from "../avatar/rider.js";
import { createRideCamera } from "./camera.js";
import { createEnvironmentSystem } from "./environment.js";
import { createFrameSampler } from "./frame.js";
import { createRoadSystem } from "./road.js";
import {
  createScheduler,
  QUALITY_SETTINGS,
  type RenderSystem,
  type Scheduler,
} from "./scheduler.js";

const MAX_RENDER_YIELD_MS = 250;

export interface RideSceneOptions {
  readonly host: Readonly<HTMLElement>;
  readonly route: EngineRoute;
  readonly snapshot: () => Readonly<RideSnapshot> | undefined;
  readonly wheelCircM: number;
  readonly debug: boolean;
}

export interface RideScene {
  readonly dispose: () => void;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The fallback appends a message to the browser's mutable DOM contract.
function showUnavailable(host: Readonly<HTMLElement>): RideScene {
  const message = document.createElement("p");

  message.className = "scene__unavailable";
  message.textContent = "3D unavailable. Your ride, devices and HUD still work.";
  message.setAttribute("role", "status");
  host.append(message);

  return {
    dispose() {
      message.remove();
    },
  };
}

class RideSceneDriver implements RideScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1500);
  private readonly rideCamera = createRideCamera(this.camera);
  private readonly sampler = createFrameSampler();
  private readonly debug = document.createElement("output");
  private readonly cameraButton = document.createElement("button");
  private readonly observer = new ResizeObserver(() => {
    this.resize();
  });
  private readonly rider;
  private readonly scheduler: Scheduler;
  private lastDebugMs = -Infinity;
  private frameMs = 0;
  private frameStartedMs = 0;
  private rafId = 0;
  private timerId = 0;
  private disposed = false;

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The scene owns the DOM host children and WebGL canvas.
    private readonly options: RideSceneOptions,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This driver owns the mutable Three renderer.
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.rider = createRider(options.wheelCircM);
    renderer.domElement.setAttribute("aria-label", "3D ride scene");
    renderer.domElement.className = "scene__canvas";
    this.debug.className = "scene__debug";
    this.debug.hidden = !options.debug;
    this.debug.setAttribute("aria-label", "Render diagnostics");
    this.cameraButton.className = "scene__camera";
    this.cameraButton.type = "button";
    this.cameraButton.textContent = "Camera: chase · C";
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = QUALITY_SETTINGS.medium.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scheduler = createScheduler(
      [
        createEnvironmentSystem(),
        createRoadSystem(),
        this.rider.system,
        this.rideCamera.system,
        this.debugSystem(),
      ],
      { scene: this.scene, route: options.route },
    );
    this.scheduler.setQuality("medium");
    options.host.append(renderer.domElement, this.cameraButton, this.debug);
    this.observer.observe(options.host);
    this.resize();
    this.cameraButton.addEventListener("click", this.toggleCamera);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("pagehide", this.dispose);
    renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
    this.rafId = requestAnimationFrame(this.animate);
  }

  private debugSystem(): RenderSystem {
    return {
      id: "debug",
      order: 110,
      init() {},
      update: (frame) => {
        if (this.frameMs - this.lastDebugMs < 250) {
          return;
        }

        this.lastDebugMs = this.frameMs;
        const position = this.rider.position();
        const { render } = this.renderer.info;

        this.debug.textContent = `${render.calls} calls · ${render.triangles} triangles · ${this.rideCamera.mode()}`;
        this.debug.dataset["calls"] = String(render.calls);
        this.debug.dataset["triangles"] = String(render.triangles);
        this.debug.dataset["riderX"] = String(position.x);
        this.debug.dataset["riderY"] = String(position.y);
        this.debug.dataset["riderZ"] = String(position.z);
        this.debug.dataset["headingRad"] = String(this.rider.headingRad());
        this.debug.dataset["crankRad"] = String(this.rider.crankRad());
        this.debug.dataset["distanceM"] = String(frame.ride.distanceM);
        this.debug.dataset["camera"] = this.rideCamera.mode();
        this.debug.dataset["cameraX"] = String(this.camera.position.x);
        this.debug.dataset["cameraY"] = String(this.camera.position.y);
        this.debug.dataset["cameraZ"] = String(this.camera.position.z);
      },
      setQuality() {},
      dispose: () => {
        this.debug.remove();
      },
    };
  }

  private resize(): void {
    const width = Math.max(1, this.options.host.clientWidth);
    const height = Math.max(1, this.options.host.clientHeight);

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, QUALITY_SETTINGS.medium.pixelRatio),
    );
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private readonly toggleCamera = (): void => {
    this.rideCamera.toggle();
    this.cameraButton.textContent = `Camera: ${this.rideCamera.mode()} · C`;
  };

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- KeyboardEvent is the browser listener contract.
  private readonly onKey = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (
      event.key.toLowerCase() === "c" &&
      !event.repeat &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      this.toggleCamera();
    }
  };

  readonly dispose = (): void => {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.clearTimeout(this.timerId);
    this.observer.disconnect();
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("pagehide", this.dispose);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.cameraButton.removeEventListener("click", this.toggleCamera);
    this.scheduler.dispose();
    this.renderer.dispose();

    if (!this.renderer.getContext().isContextLost()) {
      this.renderer.forceContextLoss();
    }

    this.renderer.domElement.remove();
    this.cameraButton.remove();
  };

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Event is the browser listener contract.
  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.dispose();
    showUnavailable(this.options.host);
  };

  private readonly animate = (nowMs: number): void => {
    if (this.disposed) {
      return;
    }

    this.frameStartedMs = performance.now();
    this.frameMs = nowMs;
    const snapshot = this.options.snapshot();

    if (snapshot !== undefined) {
      this.scheduler.update(this.sampler.sample(snapshot, nowMs));
      this.renderer.render(this.scene, this.camera);
    }

    this.timerId = window.setTimeout(this.afterPresent, 0);
  };

  private readonly afterPresent = (): void => {
    // Include browser presentation, not just Three's asynchronous command submission.
    // Bound the yield so a background-tab suspension cannot delay resuming the scene.
    const frameCostMs = Math.min(performance.now() - this.frameStartedMs, MAX_RENDER_YIELD_MS);

    this.timerId = window.setTimeout(this.requestFrame, frameCostMs);
  };

  private readonly requestFrame = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The renderer takes ownership of browser DOM objects in these options.
export function startRideScene(options: RideSceneOptions): RideScene {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { antialias: true, alpha: false });

  if (context === null) {
    return showUnavailable(options.host);
  }

  return new RideSceneDriver(
    options,
    new THREE.WebGLRenderer({ canvas, context, antialias: true }),
  );
}
