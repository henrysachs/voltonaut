import type { AvatarConfig } from "@voltonaut/shared";
import * as THREE from "three";

import { createAvatarPreview } from "../../avatar/customize.js";
import type { PreviewScene } from "./previewLoop.js";
import { DEFAULT_PREVIEW_ORBIT, type PreviewOrbit } from "./previewOrbit.js";
import { isVisibleViewport, type PreviewDraw, type PreviewViewport } from "./previewProtocol.js";

const MAX_PIXEL_RATIO = 1.5;
const STUDIO_BACKGROUND = 0x101a18;
const CAMERA_TARGET = new THREE.Vector3(0, 0.95, 0);
const CAMERA_RADIUS = 3.6;

class ThreePreviewScene implements PreviewScene {
  private readonly avatar: ReturnType<typeof createAvatarPreview>;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 30);
  private readonly floorGeometry = new THREE.CircleGeometry(7, 64);
  private readonly floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x182420,
    roughness: 0.96,
    metalness: 0,
  });
  private readonly platformGeometry = new THREE.CylinderGeometry(1.34, 1.38, 0.08, 64);
  private readonly platformMaterial = new THREE.MeshStandardMaterial({
    color: 0x26312d,
    roughness: 0.82,
    metalness: 0.12,
  });
  private readonly ringGeometry = new THREE.TorusGeometry(1.19, 0.012, 8, 64);
  private readonly ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x86a79a,
    roughness: 0.42,
    metalness: 0.6,
    emissive: 0x173d34,
    emissiveIntensity: 0.35,
  });
  private readonly hemisphere = new THREE.HemisphereLight(0xdcebe4, 0x17221e, 1.1);
  private readonly keyLight = new THREE.DirectionalLight(0xfff1d6, 3.2);
  private readonly fillLight = new THREE.DirectionalLight(0x9fc8ff, 1.1);
  private readonly rimLight = new THREE.DirectionalLight(0xc4ffe8, 2.4);
  private visible = false;
  private disposed = false;

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's native renderer is mutable and exclusively owned here.
    private readonly renderer: THREE.WebGLRenderer,
    private readonly canvas: Readonly<OffscreenCanvas>,
    wheelCircM: number,
  ) {
    this.avatar = createAvatarPreview(wheelCircM);
    this.scene.background = new THREE.Color(STUDIO_BACKGROUND);
    this.#addLights();
    this.#addSet();
    this.#positionCamera(DEFAULT_PREVIEW_ORBIT);
    renderer.setClearColor(STUDIO_BACKGROUND, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  #addLights(): void {
    this.keyLight.position.set(-3, 5, 4);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.left = -3;
    this.keyLight.shadow.camera.right = 3;
    this.keyLight.shadow.camera.top = 4;
    this.keyLight.shadow.camera.bottom = -2;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 12;
    this.keyLight.shadow.bias = -0.0005;
    this.fillLight.position.set(4, 2, 2);
    this.rimLight.position.set(1, 3, -4);
  }

  #addSet(): void {
    const floor = new THREE.Mesh(this.floorGeometry, this.floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.045;
    floor.receiveShadow = true;

    const platform = new THREE.Mesh(this.platformGeometry, this.platformMaterial);
    platform.receiveShadow = true;
    platform.castShadow = true;

    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.045;

    this.avatar.root.position.y = 0.05;
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The traversal marks the worker-owned avatar meshes as shadow casters.
    this.avatar.root.traverse((object: Readonly<THREE.Object3D>) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.scene.add(
      this.hemisphere,
      this.keyLight,
      this.fillLight,
      this.rimLight,
      floor,
      platform,
      ring,
      this.avatar.root,
    );
  }

  #positionCamera(orbit: Readonly<PreviewOrbit>): void {
    const horizontalRadius = Math.cos(orbit.pitchRad) * CAMERA_RADIUS;

    this.camera.position.set(
      CAMERA_TARGET.x + Math.sin(orbit.yawRad) * horizontalRadius,
      CAMERA_TARGET.y + Math.sin(orbit.pitchRad) * CAMERA_RADIUS,
      CAMERA_TARGET.z + Math.cos(orbit.yawRad) * horizontalRadius,
    );
    this.camera.lookAt(CAMERA_TARGET);
  }

  #draw(angleRad: number, orbit: Readonly<PreviewOrbit>): PreviewDraw | undefined {
    this.avatar.root.rotation.y = angleRad;
    this.#positionCamera(orbit);

    if (!this.visible) return undefined;
    this.renderer.render(this.scene, this.camera);

    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  readonly render = (angleRad: number, orbit: Readonly<PreviewOrbit>): PreviewDraw | undefined => {
    return this.#draw(angleRad, orbit);
  };

  readonly capture = async (angleRad: number, orbit: Readonly<PreviewOrbit>): Promise<Blob> => {
    if (this.disposed || this.#draw(angleRad, orbit) === undefined) {
      throw new Error("Preview canvas is not visible");
    }

    const blob = await this.canvas.convertToBlob({ type: "image/png" });

    if (blob.type !== "image/png") throw new Error("Preview capture must be a PNG");

    return blob;
  };

  /** A closed menu reports a zero-sized host; the last real size stays and nothing is drawn. */
  readonly resize = (viewport: PreviewViewport): void => {
    this.visible = isVisibleViewport(viewport);

    if (!this.visible) return;
    this.renderer.setPixelRatio(Math.min(viewport.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(viewport.widthCssPx, viewport.heightCssPx, false);
    this.camera.aspect = viewport.widthCssPx / viewport.heightCssPx;
    this.camera.updateProjectionMatrix();
  };

  readonly setLook = (look: Readonly<AvatarConfig>): void => {
    this.avatar.setLook(look);
  };

  readonly dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.avatar.dispose();
    this.floorGeometry.dispose();
    this.floorMaterial.dispose();
    this.platformGeometry.dispose();
    this.platformMaterial.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    this.hemisphere.dispose();
    this.keyLight.dispose();
    this.fillLight.dispose();
    this.rimLight.dispose();
    this.scene.clear();
    this.renderer.dispose();

    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
  };
}

/** Builds the scene on a transferred canvas; throws when WebGL2 is unavailable. */
export function createPreviewScene(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The worker owns the transferred native canvas and its GL lifecycle.
  canvas: OffscreenCanvas,
  wheelCircM: number,
  viewport: PreviewViewport,
  lost: () => void,
): PreviewScene {
  const context = canvas.getContext("webgl2", { antialias: true, alpha: false });

  if (context === null) throw new Error("Worker WebGL2 unavailable");
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: false });
  let scene: ThreePreviewScene | undefined;

  const onLost = (event: { readonly preventDefault: () => void }): void => {
    event.preventDefault();
    lost();
  };

  try {
    scene = new ThreePreviewScene(renderer, canvas, wheelCircM);
    scene.resize(viewport);
    canvas.addEventListener("webglcontextlost", onLost);
    const owned = scene;

    return {
      render: owned.render,
      capture: owned.capture,
      resize: owned.resize,
      setLook: owned.setLook,
      dispose() {
        canvas.removeEventListener("webglcontextlost", onLost);
        owned.dispose();
      },
    };
  } catch (error) {
    if (scene === undefined) {
      renderer.dispose();

      if (!context.isContextLost()) renderer.forceContextLoss();
    } else scene.dispose();
    throw error;
  }
}
