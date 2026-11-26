import type { AvatarConfig } from "@voltonaut/shared";
import * as THREE from "three";

import { createAvatarPreview } from "../../avatar/customize.js";
import type { PreviewScene } from "./previewLoop.js";
import { isVisibleViewport, type PreviewDraw, type PreviewViewport } from "./previewProtocol.js";

const MAX_PIXEL_RATIO = 1.5;

/** The garage scene from the former main-thread renderer, unchanged, now owned by the worker. */
class ThreePreviewScene implements PreviewScene {
  private readonly avatar: ReturnType<typeof createAvatarPreview>;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 30);
  private readonly groundGeometry = new THREE.CircleGeometry(1.25, 48);
  private readonly groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x173b35,
    roughness: 0.95,
    metalness: 0,
  });
  private visible = false;
  private disposed = false;

  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's native renderer is mutable and exclusively owned here.
    private readonly renderer: THREE.WebGLRenderer,
    wheelCircM: number,
  ) {
    this.avatar = createAvatarPreview(wheelCircM);
    this.camera.position.set(2.5, 1.65, 2.7);
    this.camera.lookAt(0, 0.9, 0);
    this.scene.add(new THREE.HemisphereLight(0xe9fff4, 0x15342d, 2.2));

    const keyLight = new THREE.DirectionalLight(0xfff1c7, 3);
    keyLight.position.set(2, 4, 3);
    const ground = new THREE.Mesh(this.groundGeometry, this.groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.005;
    this.avatar.root.position.y = 0.015;
    this.scene.add(keyLight, ground, this.avatar.root);
    renderer.setClearColor(0x000000, 0);
  }

  readonly render = (angleRad: number): PreviewDraw | undefined => {
    this.avatar.root.rotation.y = angleRad;

    if (!this.visible) return undefined;
    this.renderer.render(this.scene, this.camera);

    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
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
    this.groundGeometry.dispose();
    this.groundMaterial.dispose();
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
  const context = canvas.getContext("webgl2", { antialias: true, alpha: true });

  if (context === null) throw new Error("Worker WebGL2 unavailable");
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: true });
  let scene: ThreePreviewScene | undefined;

  const onLost = (event: { readonly preventDefault: () => void }): void => {
    event.preventDefault();
    lost();
  };

  try {
    scene = new ThreePreviewScene(renderer, wheelCircM);
    scene.resize(viewport);
    canvas.addEventListener("webglcontextlost", onLost);
    const owned = scene;

    return {
      render: owned.render,
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
