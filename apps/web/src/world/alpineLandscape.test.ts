import { ALPINE_PASS, createRoute, type EngineRoute } from "@voltonaut/engine";
import * as THREE from "three";
/* oxlint-disable eslint/max-lines -- Full-route terrain regression keeps the optimized raycast helpers and range cases together. */
import { expect, it } from "vitest";

import {
  createLandscapePlan,
  offsetPosition,
  TERRAIN_OFFSETS_M,
  terrainPosition,
} from "./landscape-plan.js";
import { disposeObject } from "./resources.js";
import { createTerrain } from "./terrain.js";

interface TerrainWindow {
  readonly startM: number;
  readonly endM: number;
}

interface AlpineHit {
  readonly point: { readonly y: number };
  readonly face?: { readonly normal: { readonly y: number } } | null | undefined;
}

/** Indices per terrain or apron quad: two triangles. */
const QUAD_INDICES = 6;

/** Quad bounds are widened slightly so a ray on a shared edge still tests both quads. */
const QUAD_MARGIN_M = 1e-3;

type RayHits = (x: number, y: number, z: number) => readonly THREE.Intersection[];

/**
 * Downward-ray lookup over an indexed strip mesh. A vertical ray only hits quads whose XZ
 * bounds contain it, so raycasting just those runs finds the same hits as the whole window.
 */
type StripHits = (
  x: number,
  y: number,
  z: number,
  fromRow: number,
  toRow: number,
) => readonly THREE.Intersection[];

interface AlpineTerrain {
  readonly land: StripHits;
  readonly apron: StripHits;
  /** The ground plane and any other child, raycast whole as intersectObject did. */
  readonly ground: RayHits;
}

function downRay(x: number, y: number, z: number): THREE.Raycaster {
  return new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0));
}

/** XZ bounds per quad as [minX, maxX, minZ, maxZ, …], read from the mesh's index. */
function quadBounds(
  index: Pick<THREE.BufferAttribute, "count" | "getX">,
  position: Pick<THREE.BufferAttribute, "getX" | "getZ">,
): readonly number[] {
  const bounds: number[] = [];

  for (let start = 0; start + QUAD_INDICES <= index.count; start += QUAD_INDICES) {
    const xs: number[] = [];
    const zs: number[] = [];

    for (let corner = 0; corner < QUAD_INDICES; corner += 1) {
      const vertex = index.getX(start + corner);

      xs.push(position.getX(vertex));
      zs.push(position.getZ(vertex));
    }

    bounds.push(
      Math.min(...xs) - QUAD_MARGIN_M,
      Math.max(...xs) + QUAD_MARGIN_M,
      Math.min(...zs) - QUAD_MARGIN_M,
      Math.max(...zs) + QUAD_MARGIN_M,
    );
  }

  return bounds;
}

function quadCovers(bounds: readonly number[], quad: number, x: number, z: number): boolean {
  return (
    x >= (bounds[quad * 4] ?? Number.POSITIVE_INFINITY) &&
    x <= (bounds[quad * 4 + 1] ?? Number.NEGATIVE_INFINITY) &&
    z >= (bounds[quad * 4 + 2] ?? Number.POSITIVE_INFINITY) &&
    z <= (bounds[quad * 4 + 3] ?? Number.NEGATIVE_INFINITY)
  );
}

function stripHits(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The lookup raycasts a mesh owned by this mutable Three group.
  terrain: Readonly<THREE.Group>,
  name: string,
  quadsPerRow: number,
): StripHits {
  const mesh = terrain.getObjectByName(name);
  const geometry: unknown = mesh instanceof THREE.Mesh ? mesh.geometry : undefined;
  const ownsMesh = mesh instanceof THREE.Mesh && geometry instanceof THREE.BufferGeometry;

  if (ownsMesh) {
    const index = geometry.getIndex();
    const position: unknown = geometry.getAttribute("position");

    if (index !== null && position instanceof THREE.BufferAttribute) {
      return stripLookup(
        {
          draw(start, count) {
            geometry.setDrawRange(start, count);
          },
          // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's raycast reads the raycaster and appends to the caller's hit list.
          cast(ray, hits) {
            mesh.raycast(ray, hits);
          },
        },
        quadBounds(index, position),
        quadsPerRow,
      );
    }
  }

  throw new Error(`Alpine terrain must own the indexed ${name} mesh`);
}

/** The two mesh operations the lookup needs: narrow the draw range, then raycast it. */
interface StripMesh {
  readonly draw: (start: number, count: number) => void;
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's raycast appends to the caller's mutable hit list.
  readonly cast: (ray: Readonly<THREE.Raycaster>, hits: THREE.Intersection[]) => void;
}

function stripLookup(
  strip: Readonly<StripMesh>,
  bounds: readonly number[],
  quadsPerRow: number,
): StripHits {
  return (x, y, z, fromRow, toRow) => {
    const ray = downRay(x, y, z);
    const hits: THREE.Intersection[] = [];
    const toQuad = toRow * quadsPerRow;
    let runStart = -1;

    for (let quad = fromRow * quadsPerRow; quad <= toQuad; quad += 1) {
      const covers = quad < toQuad && quadCovers(bounds, quad, x, z);

      if (covers && runStart < 0) runStart = quad;

      if (!covers && runStart >= 0) {
        strip.draw(runStart * QUAD_INDICES, (quad - runStart) * QUAD_INDICES);
        strip.cast(ray, hits);
        runStart = -1;
      }
    }

    return hits;
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The lookup raycasts meshes owned by this mutable Three group.
function alpineTerrain(terrain: Readonly<THREE.Group>): AlpineTerrain {
  return {
    land: stripHits(terrain, "route-terrain", TERRAIN_OFFSETS_M.length - 1),
    apron: stripHits(terrain, "road-terrain", 1),
    ground(x, y, z) {
      const ray = downRay(x, y, z);
      const hits: THREE.Intersection[] = [];

      for (const child of terrain.children) {
        if (child.name !== "route-terrain" && child.name !== "road-terrain") {
          hits.push(...ray.intersectObject(child));
        }
      }

      return hits;
    },
  };
}

function alpineSampleDistanceM(
  route: Readonly<EngineRoute>,
  sample: number,
  rowCount: number,
): number {
  return sample === rowCount ? route.lengthM - 0.01 : sample * 10 + 0.01;
}

function alpineTerrainWindows(
  route: Readonly<EngineRoute>,
  distanceM: number,
  nearbyM: number,
): readonly TerrainWindow[] {
  const windows: TerrainWindow[] = [
    {
      startM: Math.max(0, distanceM - nearbyM),
      endM: Math.min(route.lengthM, distanceM + nearbyM),
    },
  ];

  if (route.loop && distanceM < nearbyM) {
    windows.push({ startM: route.lengthM - nearbyM, endM: route.lengthM });
  }

  return windows;
}

function alpineShoulderHit(
  parts: Readonly<AlpineTerrain>,
  route: Readonly<EngineRoute>,
  distanceM: number,
  lateralM: number,
  nearbyM: number,
): AlpineHit | undefined {
  const rowCount = Math.ceil(route.lengthM / 10);
  const apronRowCount = Math.ceil(route.lengthM / 2);
  const apronStepM = route.lengthM / apronRowCount;
  const position = offsetPosition(route, distanceM, lateralM);
  const rayY = position.y + 20;

  // The first window with any hit decides, nearest hit first, as with intersectObject.
  for (const { startM, endM } of alpineTerrainWindows(route, distanceM, nearbyM)) {
    const startRow = Math.floor(startM / 10);
    const endRow = Math.min(rowCount, Math.ceil(endM / 10));
    const apronStart = Math.floor(startM / apronStepM);
    const apronEnd = Math.min(apronRowCount, Math.ceil(endM / apronStepM));
    let nearest: (AlpineHit & { readonly distance: number }) | undefined;

    for (const hit of [
      ...parts.ground(position.x, rayY, position.z),
      ...parts.land(position.x, rayY, position.z, startRow, endRow),
      ...parts.apron(position.x, rayY, position.z, apronStart, apronEnd),
    ]) {
      if (nearest === undefined || hit.distance < nearest.distance) nearest = hit;
    }

    if (nearest !== undefined) return nearest;
  }

  return undefined;
}

function assertAlpineShoulder(hit: AlpineHit | undefined, roadYM: number, label: string): void {
  if (hit === undefined) throw new Error(label);

  expect(hit.point.y).toBeLessThan(roadYM);
  expect(hit.point.y).toBeGreaterThan(roadYM - 0.6);
  expect(hit.face?.normal.y).toBeGreaterThan(0.9);
}

it("keeps alpine terrain offsets open after the rounded switchback", () => {
  const route = createRoute(ALPINE_PASS);
  const plan = createLandscapePlan(route, 42, false);
  const cornerCenter = route.worldPos(1500);
  const corner = terrainPosition(plan, 1500, 100);
  const straightCenter = route.worldPos(100);
  const straight = terrainPosition(plan, 100, 100);

  expect(Math.hypot(corner.x - cornerCenter.x, corner.z - cornerCenter.z)).toBeGreaterThan(90);
  expect(Math.hypot(straight.x - straightCenter.x, straight.z - straightCenter.z)).toBeGreaterThan(
    90,
  );
});

const ALPINE_SHOULDER_RANGES = [
  [0, 4000],
  [4000, 8000],
  [8000, 12_000],
  [12_000, 16_000],
  [16_000, 20_000],
  [20_000, 24_000],
  [24_000, 28_000],
  [28_000, 30_000],
] as const;

it.each(ALPINE_SHOULDER_RANGES)(
  "keeps both alpine road shoulders below the real road from %i to %i m",
  (startM, endM) => {
    const route = createRoute(ALPINE_PASS);
    const plan = createLandscapePlan(route, 42, false);
    const terrain = createTerrain(plan);
    const rowCount = Math.ceil(route.lengthM / 10);
    const nearbyM = 170;

    terrain.updateMatrixWorld(true);

    const parts = alpineTerrain(terrain);

    try {
      for (
        let sample = Math.floor(startM / 10);
        sample <= Math.ceil(Math.min(endM, route.lengthM) / 10);
        sample += 1
      ) {
        const distanceM = alpineSampleDistanceM(route, sample, rowCount);

        for (const lateralM of [-3.5, 3.5]) {
          const position = offsetPosition(route, distanceM, lateralM);

          const hit = alpineShoulderHit(parts, route, distanceM, lateralM, nearbyM);

          expect(hit).toBeDefined();
          assertAlpineShoulder(hit, position.y, `d=${distanceM}, lateral=${lateralM}`);
        }
      }
    } finally {
      disposeObject(terrain);
    }
  },
);
