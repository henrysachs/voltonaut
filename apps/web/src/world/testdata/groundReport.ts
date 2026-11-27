/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's scene graph objects are mutable by contract; these helpers only read them. */
import type { World } from "@voltonaut/engine";
import * as THREE from "three";

import { DressingGroup, type Drawable, type Footing } from "../dressing-group.js";
import { heightAt, type Heightfield } from "../heightfield.js";
import { regionDressings } from "../region-dressing.js";
import { renderWorldOf } from "../render-world.js";
import { planWorldLandscape } from "../world-landscape.js";

/**
 * A standing base may clear the drawn terrain by at most this much under any of its corners:
 * the 5 cm the road clearance gate allows (road-clearance.test.ts), invisible from the chase camera.
 */
export const FLOAT_TOLERANCE_M = 0.05;

/** One instance of a placed drawable as the renderer draws it. */
interface Instance {
  readonly label: string;
  /** Column-major world matrix, as Three stores it. */
  readonly matrix: readonly number[];
  readonly local: LocalGeometry;
}

/** A geometry's vertices once: all of them and the corners of its base, as flat x, y, z runs. */
interface LocalGeometry {
  readonly all: Float32Array;
  readonly base: Float32Array;
}

/** What the invariant found in one world's dressing; every list must stay empty. */
export interface GroundReport {
  readonly standing: number;
  readonly unplaced: readonly string[];
  readonly lights: readonly string[];
  readonly floating: readonly string[];
  readonly swallowed: readonly string[];
  readonly wet: readonly string[];
}

interface Placed {
  readonly part: Drawable | THREE.Object3D;
  readonly footing: Footing | undefined;
  readonly path: string;
}

/** Every child of the dressing groups with the footing its group placed it with. */
function placedParts(group: DressingGroup, path: string): readonly Placed[] {
  return group.children.flatMap((child, index) => {
    const childPath = `${path}/${child.name || child.type}[${index}]`;

    if (child instanceof DressingGroup) return placedParts(child, childPath);

    return [{ part: child, footing: group.footingOf(child), path: childPath }];
  });
}

const localCache = new WeakMap<THREE.BufferGeometry, LocalGeometry>();

/** The base is every vertex at the lowest local height; computed once per shared geometry. */
function localGeometry(geometry: THREE.BufferGeometry): LocalGeometry {
  const known = localCache.get(geometry);

  if (known !== undefined) return known;

  const position = geometry.getAttribute("position");
  const all = new Float32Array(position.count * 3);
  let lowestY = Number.POSITIVE_INFINITY;

  for (let index = 0; index < position.count; index += 1) {
    all.set([position.getX(index), position.getY(index), position.getZ(index)], index * 3);
    lowestY = Math.min(lowestY, position.getY(index));
  }

  const base: number[] = [];

  for (let offset = 0; offset < all.length; offset += 3) {
    if ((all[offset + 1] ?? 0) <= lowestY + 1e-6) base.push(...all.subarray(offset, offset + 3));
  }

  const found = { all, base: Float32Array.from(base) };

  localCache.set(geometry, found);

  return found;
}

function instancesOf(part: Drawable, path: string): readonly Instance[] {
  const local = localGeometry(part.geometry);

  if (part instanceof THREE.InstancedMesh) {
    const matrix = new THREE.Matrix4();

    return Array.from({ length: part.count }, (_, index) => {
      part.getMatrixAt(index, matrix);

      return {
        label: `${path}#${index}`,
        matrix: [...matrix.premultiply(part.matrixWorld).elements],
        local,
      };
    });
  }

  return [{ label: path, matrix: [...part.matrixWorld.elements], local }];
}

function isDrawable(part: THREE.Object3D): part is Drawable {
  return (
    part instanceof THREE.Mesh || part instanceof THREE.Points || part instanceof THREE.LineSegments
  );
}

/** Standing instances: the roles of a prop footing repeat over its instances. */
function standingInstances(parts: readonly Placed[]): readonly Instance[] {
  return parts.flatMap(({ part, footing, path }) => {
    if (footing?.kind !== "prop" || !isDrawable(part)) return [];

    return instancesOf(part, path).filter(
      (_, index) => footing.roles[index % footing.roles.length] === "stands",
    );
  });
}

/** Drawn water surfaces, probed by one reused downward ray. */
interface WaterProbe {
  readonly surfaces: readonly THREE.Object3D[];
  readonly ray: THREE.Raycaster;
  readonly field: Heightfield;
}

/** Water depth above the terrain at a point, if any water is drawn there. */
function waterDepthAt(probe: WaterProbe, x: number, z: number): number | undefined {
  probe.ray.ray.origin.set(x, 1e5, z);

  const hit = probe.ray.intersectObjects([...probe.surfaces], false)[0];
  const groundM = heightAt(probe.field, x, z);

  return hit !== undefined && hit.point.y > groundM ? hit.point.y - groundM : undefined;
}

/** What one standing instance's base and body meet on the drawn terrain. */
interface Contact {
  /** Largest height of a base corner above the terrain under it. */
  readonly gapM: number;
  /** Terrain under the centre minus the instance's own vertical midpoint. */
  readonly buriedM: number;
  /** Water depth under a base corner or the centre, if any. */
  readonly wetM: number | undefined;
}

/** World y of the local point at `offset`, from the column-major matrix m. */
function worldY(m: readonly number[], points: Float32Array, offset: number): number {
  const x = points[offset] ?? 0;
  const y = points[offset + 1] ?? 0;
  const z = points[offset + 2] ?? 0;

  return (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
}

function worldXz(
  m: readonly number[],
  points: Float32Array,
  offset: number,
): readonly [number, number] {
  const x = points[offset] ?? 0;
  const y = points[offset + 1] ?? 0;
  const z = points[offset + 2] ?? 0;

  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ];
}

function contactOf({ matrix: m, local }: Instance, water: WaterProbe): Contact {
  const centreX = m[12] ?? 0;
  const centreZ = m[14] ?? 0;
  let gapM = Number.NEGATIVE_INFINITY;
  let wetM = waterDepthAt(water, centreX, centreZ);

  for (let offset = 0; offset < local.base.length; offset += 3) {
    const [x, z] = worldXz(m, local.base, offset);

    gapM = Math.max(gapM, worldY(m, local.base, offset) - heightAt(water.field, x, z));
    wetM ??= waterDepthAt(water, x, z);
  }

  let lowM = Number.POSITIVE_INFINITY;
  let highM = Number.NEGATIVE_INFINITY;

  for (let offset = 0; offset < local.all.length; offset += 3) {
    const y = worldY(m, local.all, offset);

    lowM = Math.min(lowM, y);
    highM = Math.max(highM, y);
  }

  return { gapM, buriedM: heightAt(water.field, centreX, centreZ) - (lowM + highM) / 2, wetM };
}

function lightsOf(groups: readonly DressingGroup[]): readonly string[] {
  const lights: string[] = [];

  for (const group of groups) {
    group.traverse((object) => {
      if (object instanceof THREE.Light) lights.push(`${group.name}/${object.type}`);
    });
  }

  return lights;
}

/**
 * The ground invariant of one dressing: every standing instance's base corners rest on the drawn
 * terrain within FLOAT_TOLERANCE_M, the terrain under its centre stays below its own midpoint, and
 * no base corner or centre stands in drawn water.
 */
export function groundReport(groups: readonly DressingGroup[], field: Heightfield): GroundReport {
  const parts = groups.flatMap((group) => {
    group.updateMatrixWorld(true);

    return placedParts(group, group.name);
  });

  const water: WaterProbe = {
    surfaces: parts.flatMap(({ part, footing }) => (footing?.kind === "water" ? [part] : [])),
    ray: new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0)),
    field,
  };

  const standing = standingInstances(parts);
  const contacts = standing.map((instance) => ({ instance, ...contactOf(instance, water) }));

  return {
    standing: standing.length,
    unplaced: parts.flatMap(({ footing, path }) => (footing === undefined ? [path] : [])),
    lights: lightsOf(groups),
    floating: contacts.flatMap(({ instance, gapM }) =>
      gapM > FLOAT_TOLERANCE_M ? [`${instance.label} +${gapM.toFixed(3)} m`] : [],
    ),
    swallowed: contacts.flatMap(({ instance, buriedM }) => (buriedM > 0 ? [instance.label] : [])),
    wet: contacts.flatMap(({ instance, wetM }) =>
      wetM === undefined ? [] : [`${instance.label} ${wetM.toFixed(2)} m deep`],
    ),
  };
}

/** A world's dressing exactly as the landscape system builds it, with the raster it draws. */
export interface WorldDressing {
  readonly groups: readonly DressingGroup[];
  readonly terrain: Heightfield;
}

export function worldDressing(world: World): WorldDressing {
  const view = renderWorldOf(world);
  const { landscape } = planWorldLandscape(view);

  return {
    groups: regionDressings(view, landscape.plans).map((dressing) => dressing.group),
    terrain: landscape.terrain,
  };
}
