import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { environmentAt, type EnvironmentScript, type WeatherKind } from "./environment.js";
import { createEnvironmentSystem } from "./environmentSystem.js";
import { QUALITY_SETTINGS, type FrameInput } from "./scheduler.js";

const route = createRoute(TEST_LOOP);
const snapshot = createEngine({ route, profile: DEFAULT_RIDER_PROFILE }).snapshot();

function frame(weather: WeatherKind, timeOfDayS = 43_200, seed = 42, timeS = 1): FrameInput {
  const script: EnvironmentScript = [{ startS: 0, weather }];

  return {
    ride: {
      ...snapshot,
      tS: timeS,
      worldPos: { x: 10, y: 20, z: 30 },
    },
    dtS: 0.05,
    alpha: 1,
    env: environmentAt(seed, timeOfDayS, script),
  };
}

function fixture() {
  const scene = new THREE.Scene();
  const system = createEnvironmentSystem();

  system.init({ scene, route });

  return { scene, system };
}

type SceneView = Readonly<Pick<THREE.Scene, "background" | "fog" | "getObjectByName">>;

interface RainGeometry {
  readonly drawRange: { readonly count: number };
  readonly getAttribute: (
    name: string,
  ) => THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  readonly addEventListener: (type: "dispose", listener: () => void) => void;
}

interface RainLine {
  readonly visible: boolean;
  readonly geometry: RainGeometry;
}

interface RainView {
  readonly visible: boolean;
  readonly drawCount: number;
  readonly positionY: number;
  readonly positions: () => readonly number[];
  readonly onDispose: (listener: () => void) => void;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This type guard only checks the named Three object's runtime type.
function isRainLine(object: THREE.Object3D | RainLine | undefined): object is RainLine {
  return object instanceof THREE.LineSegments && object.geometry instanceof THREE.BufferGeometry;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This test helper only reads the named Three object.
function sunOf(scene: SceneView): THREE.DirectionalLight {
  const object = scene.getObjectByName("environment-sun");

  if (object instanceof THREE.DirectionalLight) return object;

  throw new TypeError("Environment sun missing");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This test helper only reads the named Three object.
function rainOf(scene: SceneView): RainView {
  const object = scene.getObjectByName("environment-rain");

  if (!isRainLine(object)) throw new Error("Environment rain missing");

  return {
    visible: object.visible,
    drawCount: object.geometry.drawRange.count,
    positionY: object.position.y,
    positions: () => {
      const position = object.geometry.getAttribute("position");

      if (position instanceof THREE.BufferAttribute) return Array.from(position.array);

      throw new TypeError("Environment rain positions missing");
    },
    onDispose: (listener) => {
      object.geometry.addEventListener("dispose", listener);
    },
  };
}

function worldRainHeights(rain: RainView): readonly number[] {
  const positions = rain.positions();
  const heights: number[] = [];

  for (let offset = 1; offset < rain.drawCount * 3; offset += 6) {
    const localY = positions[offset];

    if (localY === undefined) throw new TypeError("Environment rain height missing");

    heights.push(localY + rain.positionY);
  }

  return heights;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This test helper only reads the scene fog.
function fogOf(scene: SceneView): THREE.FogExp2 {
  if (scene.fog instanceof THREE.FogExp2) return scene.fog;

  throw new TypeError("Environment fog missing");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This test helper only reads the scene background color.
function skyColorOf(scene: SceneView): THREE.Color {
  if (scene.background instanceof THREE.Color) return scene.background.clone();

  throw new TypeError("Environment sky missing");
}

describe("environment render system", () => {
  it("applies sun, fog and sky from the supplied snapshot without changing the ride", () => {
    const { scene, system } = fixture();
    const input = frame("rain", 18 * 60 * 60);
    const rideBefore = structuredClone(input.ride);

    system.update(input);

    const sun = sunOf(scene);
    const direction = sun.position.clone().sub(sun.target.position).normalize();

    expect(sun.intensity).toBe(input.env.sunIntensity);
    expect(direction.x).toBeCloseTo(input.env.sunDirection.x);
    expect(direction.y).toBeCloseTo(input.env.sunDirection.y);
    expect(direction.z).toBeCloseTo(input.env.sunDirection.z);
    expect(sun.target.position.x).toBe(10);
    expect(sun.target.position.y).toBe(20);
    expect(sun.target.position.z).toBe(30);
    expect(fogOf(scene).density).toBe(input.env.fogDensity);
    expect(scene.getObjectByName("environment-sky")).toBeInstanceOf(THREE.Mesh);
    expect(input.ride).toEqual(rideBefore);

    system.dispose();
  });

  it("changes the visible sky between noon and midnight", () => {
    const { scene, system } = fixture();

    system.update(frame("clear", 43_200));
    const noon = skyColorOf(scene);
    system.update(frame("clear", 0));
    const midnight = skyColorOf(scene);

    expect(noon).toBeInstanceOf(THREE.Color);
    expect(midnight).toBeInstanceOf(THREE.Color);
    expect(noon).not.toEqual(midnight);
    expect(sunOf(scene).intensity).toBe(0);

    system.dispose();
  });
});

describe("environment shadows", () => {
  it("disables high-quality shadow maps at night and restores them in daylight", () => {
    const { scene, system } = fixture();

    system.setQuality("high");
    system.update(frame("clear", 0));
    expect(sunOf(scene).castShadow).toBe(false);
    system.update(frame("clear", 43_200));
    expect(sunOf(scene).castShadow).toBe(true);

    system.dispose();
  });
});

describe("environment rain", () => {
  it("creates seeded rain only for wet weather and scales it by quality", () => {
    const { scene, system } = fixture();

    system.update(frame("clear"));
    expect(rainOf(scene).visible).toBe(false);
    expect(rainOf(scene).drawCount).toBe(0);

    system.update(frame("storm"));
    const mediumCount = rainOf(scene).drawCount;

    expect(rainOf(scene).visible).toBe(true);
    expect(mediumCount).toBeGreaterThan(0);
    expect(mediumCount).toBe(QUALITY_SETTINGS.medium.rainDrops * 2);

    system.setQuality("low");
    system.update(frame("storm"));
    expect(rainOf(scene).visible).toBe(false);
    expect(rainOf(scene).drawCount).toBe(0);
    expect(sunOf(scene).castShadow).toBe(false);

    system.setQuality("high");
    system.update(frame("storm"));
    expect(rainOf(scene).visible).toBe(true);
    expect(rainOf(scene).drawCount).toBeGreaterThan(mediumCount);
    expect(sunOf(scene).castShadow).toBe(true);

    system.dispose();
  });

  it("rebuilds deterministic drop positions only when the seed changes", () => {
    const { scene, system } = fixture();
    const rain = rainOf(scene);

    system.update(frame("rain", 43_200, 42));
    const first = rain.positions();
    system.update(frame("rain", 43_201, 42));
    expect(rain.positions()).toEqual(first);
    system.update(frame("rain", 43_200, 43));
    const second = rain.positions();
    expect(second).not.toEqual(first);
    system.update(frame("rain", 43_200, 43));
    expect(rain.positions()).toEqual(second);

    system.dispose();
  });
});

describe("environment rain motion", () => {
  it("wraps every drop through a rider-centered full cycle", () => {
    const { scene, system } = fixture();
    const periodS = 24 / 18;

    system.update(frame("storm", 43_200, 42, 0));
    const start = worldRainHeights(rainOf(scene));
    system.update(frame("storm", 43_200, 42, periodS / 2));
    expect(worldRainHeights(rainOf(scene))).not.toEqual(start);
    expect(rainOf(scene).positionY).toBe(20);
    system.update(frame("storm", 43_200, 42, periodS));
    expect(worldRainHeights(rainOf(scene))).toEqual(start);
    expect(rainOf(scene).positionY).toBe(20);

    system.dispose();
  });

  it("keeps active drops visible and deterministic inside the rider column", () => {
    const { scene, system } = fixture();

    system.update(frame("storm", 43_200, 42, 1));
    const rain = rainOf(scene);
    const heights = worldRainHeights(rain);

    expect(rain.visible).toBe(true);
    expect(rain.drawCount).toBeGreaterThan(0);
    expect(rain.positionY).toBe(20);

    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(8);
      expect(height).toBeLessThanOrEqual(32);
    }

    system.update(frame("storm", 43_200, 42, 1));
    expect(worldRainHeights(rainOf(scene))).toEqual(heights);

    system.dispose();
  });
});

describe("environment lifecycle", () => {
  it("owns a stable scheduler slot and releases its scene objects", () => {
    const { scene, system } = fixture();

    expect(system.id).toBe("environment");
    expect(system.order).toBe(10);
    system.update(frame("rain"));
    const rain = rainOf(scene);
    let disposals = 0;

    rain.onDispose(() => {
      disposals += 1;
    });
    system.dispose();
    system.dispose();

    expect(disposals).toBe(1);
    expect(scene.children).toHaveLength(0);
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
  });
});
