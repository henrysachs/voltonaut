import * as THREE from "three";

import { FINE_SPACING_M, heightAt, type Heightfield, type TerrainTile } from "./heightfield.js";
import { LAKE_SHORE_RADIUS, lakeRadius } from "./lake-plan.js";
import type { LandscapePlan } from "./landscape-plan.js";
import type { RoadSample } from "./road-plan.js";

/** Tiles merged into one mesh per side: 4 × 4 tiles (1024 m) keep draw calls low. */
export const RENDER_CHUNK_TILES = 4;

/** Terrain vertex colors per biome (#75); the forest values are the original ones. */
export interface TerrainPalette {
  readonly low: number;
  readonly high: number;
  readonly shore: number;
  /** Colour of the alpine road apron. */
  readonly ground: number;
}

export const FOREST_TERRAIN: TerrainPalette = {
  low: 0x466848,
  high: 0x72925a,
  shore: 0xc9bb8a,
  ground: 0x59744d,
};

interface ChunkStyle {
  readonly plan: LandscapePlan;
  readonly low: Rgb;
  readonly high: Rgb;
  readonly shore: Rgb;
}

interface ChunkBuffers {
  readonly vertices: number[];
  readonly normals: number[];
  readonly colors: number[];
  readonly indices: number[];
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function rgb(hex: number): Rgb {
  const color = new THREE.Color(hex);

  return { r: color.r, g: color.g, b: color.b };
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  };
}

/** Vertex colour: low–high shading in world space, sand inside the lake shore. */
function terrainColor(style: ChunkStyle, x: number, z: number): Rgb {
  const shade = (Math.sin(x / 53 + z / 29) + 1) / 2;
  const color = mix(style.low, style.high, shade * 0.65 + 0.25);
  const radius = lakeRadius(style.plan.lake, { x, z });

  return radius < LAKE_SHORE_RADIUS
    ? mix(color, style.shore, Math.min(1, (LAKE_SHORE_RADIUS - radius) * 9))
    : color;
}

function unitNormal(dx: number, dz: number): readonly [number, number, number] {
  const length = Math.hypot(dx, 2 * FINE_SPACING_M, dz);

  return [dx / length, (2 * FINE_SPACING_M) / length, dz / length];
}

/**
 * Unit normal from the raster with a fixed 8 m step, so shared border points of two tiles agree.
 * Inside a fine tile the neighbours are its own points, which heightAt returns exactly.
 */
function tileNormal(
  field: Heightfield,
  tile: TerrainTile,
  i: number,
  j: number,
): readonly [number, number, number] {
  const stride = tile.cells + 1;

  const inside =
    tile.spacingM === FINE_SPACING_M && i > 0 && j > 0 && i < tile.cells && j < tile.cells;

  if (inside) {
    const at = (di: number, dj: number): number => tile.heightsM[(j + dj) * stride + i + di] ?? 0;

    return unitNormal(at(-1, 0) - at(1, 0), at(0, -1) - at(0, 1));
  }

  const x = tile.originX + i * tile.spacingM;
  const z = tile.originZ + j * tile.spacingM;

  return unitNormal(
    heightAt(field, x - FINE_SPACING_M, z) - heightAt(field, x + FINE_SPACING_M, z),
    heightAt(field, x, z - FINE_SPACING_M) - heightAt(field, x, z + FINE_SPACING_M),
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The chunk buffers are filled in place before they become Three attributes.
function appendTile(style: ChunkStyle, tile: TerrainTile, buffers: ChunkBuffers): void {
  const first = buffers.vertices.length / 3;
  const stride = tile.cells + 1;

  for (const [index, heightM] of tile.heightsM.entries()) {
    const x = tile.originX + (index % stride) * tile.spacingM;
    const z = tile.originZ + Math.floor(index / stride) * tile.spacingM;
    const color = terrainColor(style, x, z);

    buffers.vertices.push(x, heightM, z);
    buffers.normals.push(
      ...tileNormal(style.plan.terrain, tile, index % stride, Math.floor(index / stride)),
    );
    buffers.colors.push(color.r, color.g, color.b);
  }

  for (let j = 0; j < tile.cells; j += 1) {
    for (let i = 0; i < tile.cells; i += 1) {
      const a = first + j * stride + i;

      // Diagonal a–d, triangles (a, c, d) and (a, d, b): the same split as heightAt.
      buffers.indices.push(a, a + stride, a + stride + 1, a, a + stride + 1, a + 1);
    }
  }
}

function chunkGeometry(style: ChunkStyle, tiles: readonly TerrainTile[]): THREE.BufferGeometry {
  const buffers: ChunkBuffers = { vertices: [], normals: [], colors: [], indices: [] };

  for (const tile of tiles) appendTile(style, tile, buffers);

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.vertices, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeBoundingSphere();

  return geometry;
}

/** One geometry per 4 × 4 tiles of the world raster, in tile order (spec E10-12). */
export function createTerrainGeometries(
  plan: LandscapePlan,
  palette: TerrainPalette = FOREST_TERRAIN,
): readonly THREE.BufferGeometry[] {
  const chunks = new Map<string, TerrainTile[]>();
  const style = { plan, low: rgb(palette.low), high: rgb(palette.high), shore: rgb(palette.shore) };

  for (const tile of plan.terrain.tiles) {
    const column = Math.floor(tile.column / RENDER_CHUNK_TILES);
    const key = `${column}:${Math.floor(tile.row / RENDER_CHUNK_TILES)}`;
    const chunk = chunks.get(key) ?? [];

    chunk.push(tile);
    chunks.set(key, chunk);
  }

  return Array.from(chunks.values(), (tiles: readonly TerrainTile[]) =>
    chunkGeometry(style, tiles),
  );
}

/** The alpine road apron as one indexed ribbon in the palette's ground colour (#138). */
function apronGeometry(apron: readonly RoadSample[], groundColor: number): THREE.BufferGeometry {
  const color = new THREE.Color(groundColor);
  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const [index, sample] of apron.entries()) {
    vertices.push(
      sample.left.x,
      sample.left.y,
      sample.left.z,
      sample.right.x,
      sample.right.y,
      sample.right.z,
    );
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);

    if (index > 0) {
      const base = index * 2;

      // Same split as ribbonTriangles: (Lₖ₋₁, Rₖ₋₁, Lₖ), (Lₖ, Rₖ₋₁, Rₖ).
      indices.push(base - 2, base - 1, base, base, base - 1, base + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

/** The world terrain: one mesh per render chunk sharing one vertex-coloured material. */
export function createTerrain(
  plan: LandscapePlan,
  palette: TerrainPalette = FOREST_TERRAIN,
): THREE.Group {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });

  root.name = "world-terrain";

  for (const geometry of createTerrainGeometries(plan, palette)) {
    const mesh = new THREE.Mesh(geometry, material);

    mesh.name = "terrain-chunk";
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  if (plan.apron.length > 0) {
    const apron = new THREE.Mesh(apronGeometry(plan.apron, palette.ground), material);

    apron.name = "road-terrain";
    apron.receiveShadow = true;
    root.add(apron);
  }

  return root;
}

export function createLake(plan: LandscapePlan): THREE.Group {
  const root = new THREE.Group();

  const glints = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x80bec0,
      roughness: 0.4,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
    28,
  );

  const transform = new THREE.Object3D();

  for (let index = 0; index < 28; index += 1) {
    const angle = index * 2.4;
    const radius = Math.sqrt((index + 0.5) / 28) * 0.83;

    transform.position.set(
      Math.cos(angle) * radius * plan.lake.alongRadiusM,
      0.025,
      Math.sin(angle) * radius * plan.lake.acrossRadiusM,
    );
    transform.rotation.x = -Math.PI / 2;
    transform.scale.set(2 + (index % 4), 0.12, 1);
    transform.updateMatrix();
    glints.setMatrixAt(index, transform.matrix);
  }

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshStandardMaterial({ color: 0x328c98, roughness: 0.26, metalness: 0.2 }),
  );

  water.name = "lake-water";
  water.rotation.x = -Math.PI / 2;
  water.scale.set(plan.lake.alongRadiusM, plan.lake.acrossRadiusM, 1);
  root.rotation.y = -plan.lake.headingRad;
  root.position.set(plan.lake.center.x, plan.lake.waterYM, plan.lake.center.z);
  root.add(water, glints);

  return root;
}
