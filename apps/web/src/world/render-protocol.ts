import type { RideSnapshot } from "@voltonaut/engine";

import type { CameraMode } from "./camera.js";
import type { EnvironmentSettings, WeatherKind } from "./environment.js";

export interface RenderViewport {
  readonly widthCssPx: number;
  readonly heightCssPx: number;
  readonly devicePixelRatio: number;
}

export function createRenderViewport(
  widthCssPx: number,
  heightCssPx: number,
  devicePixelRatio: number,
): RenderViewport {
  return {
    widthCssPx: Math.max(1, widthCssPx),
    heightCssPx: Math.max(1, heightCssPx),
    devicePixelRatio,
  };
}

interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SceneDiagnostics {
  readonly calls: number;
  readonly triangles: number;
  readonly distanceM: number;
  readonly rider: Position;
  readonly headingRad: number;
  readonly crankRad: number;
  readonly camera: CameraMode;
  readonly weather: WeatherKind;
  readonly timeOfDayS: number;
  readonly rainAmount: number;
  readonly cameraPosition: Position;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Billboards whose centre is in the camera frustum, per road side (spec E8-02). */
  readonly billboardsInView: { readonly left: number; readonly right: number };
}

export type RenderControl =
  | {
      readonly type: "render.snapshot";
      readonly sequence: number;
      readonly snapshot: Readonly<RideSnapshot>;
    }
  | { readonly type: "render.resize"; readonly viewport: RenderViewport }
  | { readonly type: "render.toggleCamera" }
  | { readonly type: "render.dispose" };

export type RenderCommand =
  | RenderControl
  | {
      readonly type: "render.init";
      readonly canvas: OffscreenCanvas;
      readonly routeId: string;
      readonly wheelCircM: number;
      readonly environment: EnvironmentSettings;
      readonly viewport: RenderViewport;
    };

export type RenderFailure = "initialization" | "context-lost" | "worker-error" | "render-error";

export type RenderReply =
  | { readonly type: "render.ready" }
  | { readonly type: "render.accepted"; readonly sequence: number }
  | {
      readonly type: "render.frame";
      readonly stage: "after-render-task";
      readonly diagnostics: SceneDiagnostics;
    }
  | { readonly type: "render.camera"; readonly mode: CameraMode }
  | { readonly type: "render.failed"; readonly reason: RenderFailure }
  | { readonly type: "render.disposed" };

export interface RenderTimer {
  readonly schedule: (callback: () => void, delayMs: number) => number;
  readonly cancel: (id: number) => void;
}
