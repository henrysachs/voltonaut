import * as THREE from "three";

const MAX_RAIN_DROPS = 1400;
const RAIN_HEIGHT_M = 24;
const RAIN_SPEED_MPS = 18;
const RAIN_HALF_HEIGHT_M = RAIN_HEIGHT_M / 2;
const RAIN_STREAK_M = 0.65;

interface RainPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function noise(seed: number, index: number): number {
  let value = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1), 0x85ebca6b);

  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  value ^= value >>> 16;

  return (value >>> 0) / 0x1_0000_0000;
}

function wrappedHeight(baseY: number, timeS: number): number {
  const phase = (timeS * RAIN_SPEED_MPS) % RAIN_HEIGHT_M;
  const shifted = baseY - phase + RAIN_HALF_HEIGHT_M;

  return (((shifted % RAIN_HEIGHT_M) + RAIN_HEIGHT_M) % RAIN_HEIGHT_M) - RAIN_HALF_HEIGHT_M;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- These functions fill the rain system's owned position buffers.
function writeSeed(positions: Float32Array, baseHeights: Float32Array, seed: number): void {
  for (let drop = 0; drop < MAX_RAIN_DROPS; drop += 1) {
    const offset = drop * 6;
    const x = (noise(seed, drop * 3) - 0.5) * 50;
    const z = (noise(seed, drop * 3 + 2) - 0.5) * 50;

    baseHeights[drop] = (noise(seed, drop * 3 + 1) - 0.5) * RAIN_HEIGHT_M;
    positions[offset] = x;
    positions[offset + 2] = z;
    positions[offset + 3] = x + 0.08;
    positions[offset + 5] = z;
  }
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This function fills the rain system's owned position buffer.
function writeFall(positions: Float32Array, baseHeights: Float32Array, timeS: number): void {
  for (let drop = 0; drop < MAX_RAIN_DROPS; drop += 1) {
    const offset = drop * 6;
    const y = wrappedHeight(baseHeights[drop] ?? 0, timeS);

    positions[offset + 1] = y;
    positions[offset + 4] = y - RAIN_STREAK_M;
  }
}

class RainRenderer {
  readonly object: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly positions = new Float32Array(MAX_RAIN_DROPS * 6);
  private readonly baseHeights = new Float32Array(MAX_RAIN_DROPS);
  private seed = 42;
  private dropLimit = 0;
  private disposed = false;

  constructor() {
    const geometry = new THREE.BufferGeometry();

    const material = new THREE.LineBasicMaterial({
      color: 0xb5d2e2,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    writeSeed(this.positions, this.baseHeights, this.seed);
    writeFall(this.positions, this.baseHeights, 0);
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setDrawRange(0, 0);
    this.object = new THREE.LineSegments(geometry, material);
    this.object.name = "environment-rain";
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.object.renderOrder = 2;
  }

  update(seed: number, timeS: number, position: Readonly<RainPosition>, amount: number): void {
    if (this.disposed) return;

    const dropCount = Math.round(MAX_RAIN_DROPS * amount);
    const qualityCount = Math.min(dropCount, this.dropLimit);

    this.object.position.set(position.x, position.y, position.z);
    this.object.visible = qualityCount > 0;
    this.object.geometry.setDrawRange(0, qualityCount * 2);

    if (qualityCount === 0) return;

    const attribute = this.object.geometry.getAttribute("position");

    if (attribute instanceof THREE.BufferAttribute && attribute.array instanceof Float32Array) {
      if (this.seed !== seed) {
        writeSeed(attribute.array, this.baseHeights, seed);
        this.seed = seed;
      }

      writeFall(attribute.array, this.baseHeights, timeS);
      attribute.needsUpdate = true;
    }
  }

  setQuality(dropLimit: number): void {
    this.dropLimit = dropLimit;
    this.object.visible = false;
    this.object.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}

export function createEnvironmentRain(): RainRenderer {
  return new RainRenderer();
}
