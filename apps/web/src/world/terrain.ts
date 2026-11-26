import type { WorldPos } from "@voltonaut/engine";
import * as THREE from "three";

import {
  lakeRadius,
  TERRAIN_OFFSETS_M,
  terrainPosition,
  type LandscapePlan,
} from "./landscape-plan.js";
import {
  createForeignRoadQuery,
  createRoadApronGeometry,
  type ForeignRoadQuery,
} from "./terrainRoad.js";

/** Terrain vertex colors per biome (#75); the forest values are the original ones. */
export interface TerrainPalette {
  readonly low: number;
  readonly high: number;
  readonly shore: number;
  readonly ground: number;
}

export const FOREST_TERRAIN: TerrainPalette = {
  low: 0x466848,
  high: 0x72925a,
  shore: 0xc9bb8a,
  ground: 0x59744d,
};

function terrainColor(
  distanceM: number,
  lateralM: number,
  radius: number,
  palette: TerrainPalette,
): THREE.Color {
  const shade = (Math.sin(distanceM / 53 + lateralM / 29) + 1) / 2;

  const color = new THREE.Color(palette.low).lerp(
    new THREE.Color(palette.high),
    shade * 0.65 + 0.25,
  );

  if (radius < 1.18) {
    color.lerp(new THREE.Color(palette.shore), Math.min(1, (1.18 - radius) * 9));
  }

  return color;
}

function requiredWorldPos(positions: readonly WorldPos[], index: number): WorldPos {
  const position = positions[index];

  if (position === undefined) throw new RangeError("terrain position is missing");

  return position;
}

function terrainFaceIndices(
  positions: readonly WorldPos[],
  query: ForeignRoadQuery | undefined,
  a: number,
  b: number,
  c: number,
  fromM: number,
  toM: number,
  roadShoulder: boolean,
): readonly [number, number, number] {
  const blocked =
    query?.(
      requiredWorldPos(positions, a),
      requiredWorldPos(positions, b),
      requiredWorldPos(positions, c),
      fromM,
      toM,
      roadShoulder,
    ) ?? false;

  return blocked ? [a, a, a] : [a, b, c];
}

function terrainRowIndices(
  positions: readonly WorldPos[],
  query: ForeignRoadQuery | undefined,
  index: number,
  count: number,
  width: number,
  routeLengthM: number,
): readonly number[] {
  const indices: number[] = [];
  const fromM = ((index - 1) / count) * routeLengthM;

  for (let column = 1; column < width; column += 1) {
    const current = index * width + column;
    const toM = (index / count) * routeLengthM;
    const leftLateralM = TERRAIN_OFFSETS_M[column - 1];
    const lateralM = TERRAIN_OFFSETS_M[column];

    if (leftLateralM === undefined || lateralM === undefined) {
      throw new RangeError("terrain offset is missing");
    }

    const roadShoulder = Math.abs(leftLateralM) <= 4 && Math.abs(lateralM) <= 4;

    indices.push(
      ...terrainFaceIndices(
        positions,
        query,
        current - width - 1,
        current - width,
        current - 1,
        fromM,
        toM,
        roadShoulder,
      ),
      ...terrainFaceIndices(
        positions,
        query,
        current - width,
        current,
        current - 1,
        fromM,
        toM,
        roadShoulder,
      ),
    );
  }

  return indices;
}

function terrainGeometry(plan: LandscapePlan, palette: TerrainPalette): THREE.BufferGeometry {
  const vertices: number[] = [];
  const positions: WorldPos[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const count = Math.ceil(plan.route.lengthM / 10);
  const width = TERRAIN_OFFSETS_M.length;
  const query = plan.route.scenery === "alpine" ? createForeignRoadQuery(plan.route) : undefined;

  for (let index = 0; index <= count; index += 1) {
    const distanceM = (index / count) * plan.route.lengthM;

    for (const lateralM of TERRAIN_OFFSETS_M) {
      const position = terrainPosition(plan, distanceM, lateralM);
      const radius = lakeRadius(plan.lake, position);
      const color = terrainColor(distanceM, lateralM, radius, palette);

      vertices.push(position.x, position.y, position.z);
      positions.push(position);
      colors.push(color.r, color.g, color.b);
    }

    if (index > 0) {
      indices.push(...terrainRowIndices(positions, query, index, count, width, plan.route.lengthM));
    }
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

export function createTerrain(
  plan: LandscapePlan,
  palette: TerrainPalette = FOREST_TERRAIN,
): THREE.Group {
  const root = new THREE.Group();
  const geometry = terrainGeometry(plan, palette);

  const terrain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );

  terrain.name = "route-terrain";
  terrain.receiveShadow = true;

  geometry.computeBoundingBox();

  const bounds = geometry.boundingBox ?? new THREE.Box3();
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x, size.z),
    new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 1 }),
  );

  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, bounds.min.y - 1, center.z);
  ground.receiveShadow = true;

  root.add(ground, terrain);

  if (plan.route.scenery === "alpine") {
    const apron = new THREE.Mesh(
      createRoadApronGeometry(plan.route, palette.ground),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );

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
