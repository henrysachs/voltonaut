import * as THREE from "three";

import type { Biome } from "./biome.js";
import type { RenderWorld } from "./render-world.js";

/** Lights a biome adds to the environment's sun and sky: the night city's blue glow (#75). */
function biomeLights(biome: Biome): readonly THREE.Light[] {
  return biome.kind === "night-city" ? [new THREE.AmbientLight(0x35405e, 1.1)] : [];
}

/**
 * Scene lights of a world's atmosphere. A light lights the whole scene, so only a world of one
 * region carries its biome's lights; per-region atmosphere follows separately (spec E10-14).
 */
export function worldAtmosphere(world: RenderWorld): readonly THREE.Light[] {
  const [only, ...others] = world.regions;

  return only !== undefined && others.length === 0 ? biomeLights(only.biome) : [];
}
