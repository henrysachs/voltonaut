/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's renderer, scene and camera are mutable; the bloom pipeline renders them and owns its targets. */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import type { Biome } from "./biome.js";
import { nightAmount, type EnvironmentState } from "./environment.js";

/** Bloom strength at full night per biome; the world uses the strongest (peakBloom). */
const BIOME_BLOOM: Readonly<Record<Biome["kind"], number>> = {
  forest: 0,
  coast: 0,
  alpine: 0,
  "night-city": 0.7,
  vineyard: 0,
  "stone-age": 0,
};

/** Linear HDR luminance above which a pixel blooms. */
export const BLOOM_THRESHOLD = 1.05;
const BLOOM_RADIUS = 0.45;

/** 2× looked the same as 4× in a side-by-side night frame and halves the multisample memory. */
const MSAA_SAMPLES = 2;

/** Strongest bloom any region of the world asks for at full night. */
export function peakBloom(biomes: readonly Biome[]): number {
  return Math.max(0, ...biomes.map((biome) => BIOME_BLOOM[biome.kind]));
}

export interface FramePresenter {
  /** Draws the frame, with bloom scaled by how dark it is. */
  readonly render: (env: Readonly<Pick<EnvironmentState, "sunDirection">>) => void;
  readonly setSize: (widthCssPx: number, heightCssPx: number) => void;
  readonly dispose: () => void;
}

interface BloomChain {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly output: OutputPass;
}

function createChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): BloomChain {
  const size = renderer.getSize(new THREE.Vector2());

  // EffectComposer targets are not multisampled by default; match the antialiased canvas.
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: MSAA_SAMPLES,
  });

  const composer = new EffectComposer(renderer, target);
  const bloom = new UnrealBloomPass(size, 0, BLOOM_RADIUS, BLOOM_THRESHOLD);
  const output = new OutputPass();

  // The last pass draws to the canvas; without a swap only one HDR target is ever allocated.
  output.needsSwap = false;

  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(output);

  return { composer, bloom, output };
}

/**
 * Renders straight to the canvas while the strength is 0 (day, Low quality, no glowing biome);
 * otherwise scene → bloom → tone mapping.
 */
export function createFramePresenter(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  peakStrength: number,
): FramePresenter {
  let chain: BloomChain | undefined;

  return {
    render(env) {
      const strength = peakStrength * nightAmount(env);

      if (strength <= 0) {
        renderer.render(scene, camera);

        return;
      }

      chain ??= createChain(renderer, scene, camera);
      chain.bloom.strength = strength;
      chain.composer.render();
    },
    setSize(widthCssPx, heightCssPx) {
      chain?.composer.setPixelRatio(renderer.getPixelRatio());
      chain?.composer.setSize(widthCssPx, heightCssPx);
    },
    dispose() {
      chain?.bloom.dispose();
      chain?.output.dispose();
      chain?.composer.dispose();
      chain = undefined;
    },
  };
}
