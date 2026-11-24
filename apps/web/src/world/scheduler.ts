import type { EngineRoute, RideSnapshot } from "@voltonaut/engine";
import type * as THREE from "three";

import type { EnvironmentState } from "./environment.js";

export type QualityLevel = "low" | "medium" | "high" | "ultra";

interface QualitySettings {
  readonly pixelRatio: number;
  readonly shadows: boolean;
  readonly rainDrops: number;
}

export const QUALITY_SETTINGS: Readonly<Record<QualityLevel, QualitySettings>> = {
  low: { pixelRatio: 1, shadows: false, rainDrops: 0 },
  medium: { pixelRatio: 1.25, shadows: true, rainDrops: 500 },
  high: { pixelRatio: 1.5, shadows: true, rainDrops: 900 },
  ultra: { pixelRatio: 2, shadows: true, rainDrops: 1400 },
};

export interface FrameInput {
  readonly ride: Readonly<RideSnapshot>;
  readonly dtS: number;
  readonly alpha: number;
  readonly env: EnvironmentState;
}

export interface SceneContext {
  readonly scene: THREE.Scene;
  readonly route: EngineRoute;
}

export interface RenderSystem {
  readonly id: string;
  readonly order: number;
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's scene graph is mutable and owned by the render systems.
  readonly init: (context: SceneContext) => void;
  readonly update: (frame: FrameInput) => void;
  readonly setQuality: (quality: QualityLevel) => void;
  readonly dispose: () => void;
}

export interface Scheduler {
  readonly update: (frame: FrameInput) => void;
  readonly setQuality: (quality: QualityLevel) => void;
  readonly dispose: () => void;
}

export function createScheduler<Context>(
  systems: readonly (Omit<RenderSystem, "init"> & { readonly init: (context: Context) => void })[],
  context: Context,
): Scheduler {
  const ordered = systems.toSorted((left, right) => left.order - right.order);
  const initialized: typeof ordered = [];
  let disposed = false;

  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;

    for (const system of initialized.toReversed()) {
      system.dispose();
    }
  };

  try {
    for (const system of ordered) {
      initialized.push(system);
      system.init(context);
    }
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    update(frame) {
      if (!disposed) {
        for (const system of ordered) {
          system.update(frame);
        }
      }
    },
    setQuality(quality) {
      if (!disposed) {
        for (const system of ordered) {
          system.setQuality(quality);
        }
      }
    },
    dispose,
  };
}
