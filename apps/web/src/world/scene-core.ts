import { createRoute, TEST_ROUTES, type EngineRoute, type RideSnapshot } from "@voltonaut/engine";
import * as THREE from "three";

import { createRider } from "../avatar/rider.js";
import { createRideCamera, type CameraMode } from "./camera.js";
import { createEnvironmentSystem } from "./environmentSystem.js";
import { createFrameSampler, type EnvironmentSettings, type FrameSampler } from "./frame.js";
import { billboardsInView, createLandscapeSystem } from "./landscape.js";
import type { RenderViewport, SceneDiagnostics } from "./render-protocol.js";
import { createRoadSystem } from "./road.js";
import { createScheduler, QUALITY_SETTINGS } from "./scheduler.js";

export interface SceneCore {
  readonly render: (snapshot: Readonly<RideSnapshot>, nowMs: number) => SceneDiagnostics;
  readonly resize: (viewport: RenderViewport) => void;
  readonly toggleCamera: () => CameraMode;
  readonly dispose: () => void;
}

export function resolveRenderRoute(routeId: string): EngineRoute {
  const data = TEST_ROUTES[routeId];

  if (data === undefined) throw new Error(`Unsupported render route: ${routeId}`);

  return createRoute(data);
}

class ThreeSceneCore implements SceneCore {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1500);
  private readonly rideCamera = createRideCamera(this.camera);
  private readonly sampler: FrameSampler;
  private readonly rider;
  private readonly scheduler;
  private disposed = false;

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's native renderer is mutable and exclusively owned here.
    private readonly renderer: THREE.WebGLRenderer,
    route: EngineRoute,
    wheelCircM: number,
    environment: Readonly<EnvironmentSettings>,
  ) {
    this.rider = createRider(wheelCircM);
    this.sampler = createFrameSampler(environment);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = QUALITY_SETTINGS.medium.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scheduler = createScheduler(
      [
        createEnvironmentSystem(),
        createLandscapeSystem(),
        createRoadSystem(),
        this.rider.system,
        this.rideCamera.system,
      ],
      { scene: this.scene, route },
    );
    this.scheduler.setQuality("medium");
  }

  readonly render = (snapshot: Readonly<RideSnapshot>, nowMs: number): SceneDiagnostics => {
    const frame = this.sampler.sample(snapshot, nowMs);

    this.scheduler.update(frame);
    this.renderer.render(this.scene, this.camera);

    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      distanceM: frame.ride.distanceM,
      rider: this.rider.position(),
      headingRad: this.rider.headingRad(),
      crankRad: this.rider.crankRad(),
      camera: this.rideCamera.mode(),
      weather: frame.env.weather,
      timeOfDayS: frame.env.timeOfDayS,
      rainAmount: frame.env.rainAmount,
      cameraPosition: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      },
      widthPx: this.renderer.domElement.width,
      heightPx: this.renderer.domElement.height,
      billboardsInView: billboardsInView(this.scene, this.camera),
    };
  };

  readonly resize = (viewport: RenderViewport): void => {
    this.renderer.setPixelRatio(
      Math.min(viewport.devicePixelRatio, QUALITY_SETTINGS.medium.pixelRatio),
    );
    this.renderer.setSize(viewport.widthCssPx, viewport.heightCssPx, false);
    this.camera.aspect = viewport.widthCssPx / viewport.heightCssPx;
    this.camera.updateProjectionMatrix();
  };

  readonly toggleCamera = (): CameraMode => {
    this.rideCamera.toggle();

    return this.rideCamera.mode();
  };

  readonly dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler.dispose();
    this.renderer.dispose();

    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
  };
}

export function createSceneCore(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Ownership of Three's mutable native renderer transfers to the core.
  renderer: THREE.WebGLRenderer,
  route: EngineRoute,
  wheelCircM: number,
  environment: Readonly<EnvironmentSettings>,
): SceneCore {
  return new ThreeSceneCore(renderer, route, wheelCircM, environment);
}
