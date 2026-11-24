import * as THREE from "three";

import type { EnvironmentState, WeatherKind } from "./environment.js";
import { createEnvironmentRain } from "./environmentRain.js";
import { disposeObject } from "./resources.js";
import {
  QUALITY_SETTINGS,
  type FrameInput,
  type QualityLevel,
  type RenderSystem,
  type SceneContext,
} from "./scheduler.js";

const DEFAULT_FOG_DENSITY = 0.0015;

const SKY_VERTEX_SHADER = `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = `
varying vec3 vDirection;
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 sunDirection;
uniform float sunIntensity;

void main() {
  vec3 direction = normalize(vDirection);
  float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 color = mix(horizonColor, topColor, pow(height, 0.6));
  float sunDot = max(dot(direction, sunDirection), 0.0);
  float disc = smoothstep(0.9993, 0.9997, sunDot);
  float glow = pow(sunDot, 180.0) * 0.35;
  color += vec3(1.0, 0.85, 0.6) * (disc + glow) * min(sunIntensity, 1.0);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const NIGHT_TOP = new THREE.Color(0x02040c);
const NIGHT_HORIZON = new THREE.Color(0x101827);
const DAY_TOP = new THREE.Color(0x3987c7);
const DAY_HORIZON = new THREE.Color(0xc5dce5);
const OVERCAST_TOP = new THREE.Color(0x35404b);
const OVERCAST_HORIZON = new THREE.Color(0x78838b);

type SkyUniforms = {
  readonly topColor: { value: THREE.Color };
  readonly horizonColor: { value: THREE.Color };
  readonly sunDirection: { value: THREE.Vector3 };
  readonly sunIntensity: { value: number };
};

type Sky = ReturnType<typeof createSky>;

function overcast(weather: WeatherKind): number {
  switch (weather) {
    case "clear":
      return 0;
    case "cloudy":
      return 0.35;
    case "fog":
      return 0.7;
    case "rain":
      return 0.8;
    case "storm":
      return 0.95;
    default: {
      const exhaustive: never = weather;

      return exhaustive;
    }
  }
}

function createSky() {
  const uniforms: SkyUniforms = {
    topColor: { value: DAY_TOP.clone() },
    horizonColor: { value: DAY_HORIZON.clone() },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    sunIntensity: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 12), material);

  mesh.name = "environment-sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;

  return { mesh, uniforms };
}

function createSun(): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xffefd7, 0);

  sun.name = "environment-sun";
  sun.castShadow = false;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.far = 180;
  sun.shadow.normalBias = 0.04;

  return sun;
}

function updateSky(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This function updates the environment system's owned Three sky.
  sky: Sky,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This function updates the environment system's owned scene background and fog.
  scene: THREE.Scene,
  env: Readonly<EnvironmentState>,
  riderPosition: Readonly<EnvironmentState["sunDirection"]>,
): void {
  const daylight = Math.max(0, env.sunDirection.y);
  const cloudAmount = overcast(env.weather);
  const topColor = sky.uniforms.topColor.value;
  const horizonColor = sky.uniforms.horizonColor.value;

  topColor.copy(NIGHT_TOP).lerp(DAY_TOP, daylight).lerp(OVERCAST_TOP, cloudAmount);
  horizonColor.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, daylight).lerp(OVERCAST_HORIZON, cloudAmount);

  sky.mesh.position.set(riderPosition.x, riderPosition.y, riderPosition.z);
  sky.uniforms.topColor.value.copy(topColor);
  sky.uniforms.horizonColor.value.copy(horizonColor);
  sky.uniforms.sunDirection.value.set(env.sunDirection.x, env.sunDirection.y, env.sunDirection.z);
  sky.uniforms.sunIntensity.value = env.sunIntensity;

  if (scene.background instanceof THREE.Color) scene.background.copy(horizonColor);

  if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.color.copy(horizonColor);
    scene.fog.density = env.fogDensity;
  }
}

class EnvironmentRenderer implements RenderSystem {
  readonly id = "environment";
  readonly order = 10;
  private readonly root = new THREE.Group();
  private readonly sun = createSun();
  private readonly hemisphere = new THREE.HemisphereLight(0xd5f2ff, 0x657b40, 2);
  private readonly sky = createSky();
  private readonly rain = createEnvironmentRain();
  private readonly riderPosition = new THREE.Vector3();
  private scene: THREE.Scene | undefined;
  private quality: QualityLevel = "medium";
  private disposed = false;

  constructor() {
    this.root.add(this.sun, this.sun.target, this.hemisphere, this.sky.mesh, this.rain.object);
    this.rain.setQuality(QUALITY_SETTINGS[this.quality].rainDrops);
  }

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This system installs its objects into the owned Three scene.
  init(context: SceneContext): void {
    this.scene = context.scene;
    this.scene.background = DAY_HORIZON.clone();
    this.scene.fog = new THREE.FogExp2(DAY_HORIZON, DEFAULT_FOG_DENSITY);
    this.scene.add(this.root);
  }

  update(frame: Readonly<FrameInput>): void {
    const scene = this.scene;

    if (scene === undefined || this.disposed) return;

    const { env } = frame;
    const { x, y, z } = frame.ride.worldPos;

    this.riderPosition.set(x, y, z);
    this.sun.target.position.copy(this.riderPosition);
    this.sun.position
      .set(env.sunDirection.x, env.sunDirection.y, env.sunDirection.z)
      .multiplyScalar(100)
      .add(this.riderPosition);
    this.sun.intensity = env.sunIntensity;
    this.sun.castShadow = QUALITY_SETTINGS[this.quality].shadows && env.sunIntensity > 0;
    this.hemisphere.intensity = 0.15 + Math.max(0, env.sunDirection.y) * 1.35;
    updateSky(this.sky, scene, env, this.riderPosition);
    this.rain.update(env.seed, frame.ride.tS, this.riderPosition, env.rainAmount);
  }

  setQuality(quality: QualityLevel): void {
    this.quality = quality;
    this.sun.castShadow = QUALITY_SETTINGS[quality].shadows && this.sun.intensity > 0;
    this.rain.setQuality(QUALITY_SETTINGS[quality].rainDrops);
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;

    if (this.scene !== undefined) {
      this.scene.background = null;
      this.scene.fog = null;
      this.scene = undefined;
    }

    this.sun.shadow.dispose();
    this.rain.dispose();
    disposeObject(this.root);
  }
}

export function createEnvironmentSystem(): RenderSystem {
  return new EnvironmentRenderer();
}
