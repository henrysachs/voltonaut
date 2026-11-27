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
  readonly matrix: THREE.Matrix4;
  readonly geometry: THREE.BufferGeometry;
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

const vertexCache = new WeakMap<THREE.BufferGeometry, readonly THREE.Vector3[]>();

function vertices(geometry: THREE.BufferGeometry): readonly THREE.Vector3[] {
  const known = vertexCache.get(geometry);

  if (known !== undefined) return known;

  const position = geometry.getAttribute("position");

  const found = Array.from({ length: position.count }, (_, index) =>
    new THREE.Vector3().fromBufferAttribute(position, index),
  );

  vertexCache.set(geometry, found);

  return found;
}

/** The corners of a geometry's base: its vertices at the lowest local height. */
function baseCorners(geometry: THREE.BufferGeometry): readonly THREE.Vector3[] {
  const all = vertices(geometry);
  const lowestY = Math.min(...all.map((vertex) => vertex.y));

  return all.filter((vertex) => vertex.y <= lowestY + 1e-6);
}

function instancesOf(part: Drawable, path: string): readonly Instance[] {
  const { geometry } = part;

  if (part instanceof THREE.InstancedMesh) {
    return Array.from({ length: part.count }, (_, index) => {
      const matrix = new THREE.Matrix4();

      part.getMatrixAt(index, matrix);

      return {
        label: `${path}#${index}`,
        matrix: matrix.premultiply(part.matrixWorld),
        geometry,
      };
    });
  }

  return [{ label: path, matrix: part.matrixWorld.clone(), geometry }];
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

const down = new THREE.Vector3(0, -1, 0);

/** Water surface height above the terrain at a point, if any water is drawn there. */
function waterAbove(
  water: readonly THREE.Object3D[],
  field: Heightfield,
  point: THREE.Vector3,
): number | undefined {
  const hit = new THREE.Raycaster(new THREE.Vector3(point.x, 1e5, point.z), down).intersectObjects(
    [...water],
    false,
  )[0];

  const groundM = heightAt(field, point.x, point.z);

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

function contactOf(
  { matrix, geometry }: Instance,
  water: readonly THREE.Object3D[],
  field: Heightfield,
): Contact {
  const corner = new THREE.Vector3();
  const centre = new THREE.Vector3().setFromMatrixPosition(matrix);
  let gapM = Number.NEGATIVE_INFINITY;
  let wetM = waterAbove(water, field, centre);

  for (const local of baseCorners(geometry)) {
    corner.copy(local).applyMatrix4(matrix);
    gapM = Math.max(gapM, corner.y - heightAt(field, corner.x, corner.z));
    wetM ??= waterAbove(water, field, corner);
  }

  const heights = vertices(geometry).map((local) => corner.copy(local).applyMatrix4(matrix).y);
  const midM = (Math.min(...heights) + Math.max(...heights)) / 2;

  return { gapM, buriedM: heightAt(field, centre.x, centre.z) - midM, wetM };
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

  const water = parts.flatMap(({ part, footing }) => (footing?.kind === "water" ? [part] : []));
  const standing = standingInstances(parts);
  const contacts = standing.map((instance) => ({ instance, ...contactOf(instance, water, field) }));

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

const reports = new Map<World, GroundReport>();

/** The dressing of a world exactly as the landscape system builds it, on the raster it draws. */
export function worldReport(world: World): GroundReport {
  const known = reports.get(world);

  if (known !== undefined) return known;

  const view = renderWorldOf(world);
  const { landscape } = planWorldLandscape(view);

  const report = groundReport(
    regionDressings(view, landscape.plans).map((dressing) => dressing.group),
    landscape.terrain,
  );

  reports.set(world, report);

  return report;
}
