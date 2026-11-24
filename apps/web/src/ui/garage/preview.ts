import type { AvatarConfig } from "@voltonaut/shared";
import * as THREE from "three";

import { createAvatarPreview } from "../../avatar/customize.js";

export interface GaragePreviewView {
  readonly setLook: (config: AvatarConfig) => void;
  readonly setAutoRotate: (enabled: boolean) => void;
  readonly rotateBy: (angleRad: number) => void;
  readonly dispose: () => void;
}

class GaragePreviewRenderer implements GaragePreviewView {
  readonly #canvas = document.createElement("canvas");
  readonly #renderer: THREE.WebGLRenderer;
  readonly #avatar: ReturnType<typeof createAvatarPreview>;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(35, 1, 0.05, 30);
  readonly #groundGeometry = new THREE.CircleGeometry(1.25, 48);
  readonly #groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x173b35,
    roughness: 0.95,
    metalness: 0,
  });
  readonly #observer: ResizeObserver;
  #angleRad = -0.65;
  #lastTimeMs: number | undefined;
  #rafId = 0;
  #disposed = false;
  #rendered = false;
  #autoRotate: boolean;

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The renderer owns the host's canvas child.
    private readonly host: HTMLElement,
    wheelCircM: number,
  ) {
    this.#canvas.className = "garage__canvas";
    this.#canvas.setAttribute("role", "img");
    this.#canvas.setAttribute("aria-label", "Provisorische 3D-Vorschau von Fahrer und Rad");
    this.#renderer = new THREE.WebGLRenderer({
      canvas: this.#canvas,
      antialias: true,
      alpha: true,
    });
    this.#avatar = createAvatarPreview(wheelCircM);
    this.#autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.#observer = new ResizeObserver(() => {
      this.#resize();
    });
    this.#buildScene();
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.#renderer.setClearColor(0x000000, 0);
    this.host.append(this.#canvas);
    this.#observer.observe(this.host);
    this.#resize();
    this.#rafId = requestAnimationFrame(this.#frame);
  }

  setLook(config: AvatarConfig): void {
    this.#avatar.setLook(config);
  }

  setAutoRotate(enabled: boolean): void {
    this.#autoRotate = enabled;
  }

  rotateBy(angleRad: number): void {
    this.#angleRad += angleRad;
    this.#avatar.root.rotation.y = this.#angleRad;
  }

  readonly dispose = (): void => {
    if (this.#disposed) return;

    this.#disposed = true;
    cancelAnimationFrame(this.#rafId);
    this.#observer.disconnect();
    this.#avatar.dispose();
    this.#groundGeometry.dispose();
    this.#groundMaterial.dispose();
    this.#renderer.dispose();
    this.#canvas.remove();
  };

  #buildScene(): void {
    this.#camera.position.set(2.5, 1.65, 2.7);
    this.#camera.lookAt(0, 0.9, 0);
    this.#scene.add(new THREE.HemisphereLight(0xe9fff4, 0x15342d, 2.2));

    const keyLight = new THREE.DirectionalLight(0xfff1c7, 3);
    keyLight.position.set(2, 4, 3);
    const ground = new THREE.Mesh(this.#groundGeometry, this.#groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.005;
    this.#avatar.root.position.y = 0.015;
    this.#scene.add(keyLight, ground, this.#avatar.root);
  }

  readonly #frame = (timeMs: number): void => {
    if (this.#disposed) return;

    const elapsedS =
      this.#lastTimeMs === undefined ? 0 : Math.min((timeMs - this.#lastTimeMs) / 1000, 0.1);

    this.#lastTimeMs = timeMs;

    if (this.#autoRotate) this.#angleRad += elapsedS * 0.22;

    this.#avatar.root.rotation.y = this.#angleRad;

    if (this.host.clientWidth > 0 && this.host.clientHeight > 0) {
      this.#renderer.render(this.#scene, this.#camera);

      if (!this.#rendered) {
        this.#rendered = true;
        this.#canvas.dataset["previewReady"] = "true";
      }
    }

    this.#rafId = requestAnimationFrame(this.#frame);
  };

  #resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;

    if (width === 0 || height === 0) return;

    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }
}

export function createGaragePreviewView(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The renderer owns the host's canvas child.
  host: HTMLElement,
  wheelCircM: number,
): GaragePreviewView | null {
  try {
    return new GaragePreviewRenderer(host, wheelCircM);
  } catch {
    return null;
  }
}
