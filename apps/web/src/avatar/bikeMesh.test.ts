import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { mergeGeometries } from "./bikeMesh.js";
import { createRiderModel } from "./rider.js";

function countDisposals(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The listener is attached to a mutable Three geometry owned by the test.
  geometry: THREE.BufferGeometry,
): () => number {
  let disposals = 0;

  geometry.addEventListener("dispose", () => {
    disposals += 1;
  });

  return () => disposals;
}

describe("merged bike geometry", () => {
  it("merges indexed and non-indexed parts and frees every input exactly once", () => {
    const indexed = new THREE.BoxGeometry(1, 1, 1);
    const flat = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const indexedDisposals = countDisposals(indexed);
    const flatDisposals = countDisposals(flat);

    const merged = mergeGeometries([indexed, flat]);

    expect(merged.index).toBeNull();
    expect(merged.getAttribute("position").count).toBe(72);
    expect(indexedDisposals()).toBe(1);
    expect(flatDisposals()).toBe(1);
  });
});

function normalGaps(
  name: string,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three geometries are mutable library objects only inspected here.
  geometry: Readonly<THREE.BufferGeometry>,
): readonly string[] {
  const normal = geometry.getAttribute("normal");
  const drawn = geometry.index?.array ?? Array.from({ length: normal.count }, (_, at) => at);
  const gaps: string[] = [];

  for (const vertex of drawn) {
    const length = Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));

    if (Math.abs(length - 1) > 1e-3) gaps.push(`${name}#${vertex}`);
  }

  return gaps;
}

function riderNormalGaps(): readonly string[] {
  const gaps: string[] = [];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal supplies its mutable scene objects.
  createRiderModel(2.1).root.traverse((object) => {
    const geometry: unknown = object instanceof THREE.Mesh ? object.geometry : undefined;

    if (geometry instanceof THREE.BufferGeometry) gaps.push(...normalGaps(object.name, geometry));
  });

  return gaps;
}

describe("drawn triangles", () => {
  it("drops zero-area triangles while merging", () => {
    const sliver = new THREE.BufferGeometry();
    const realTriangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const collinearTriangle = [0, 0, 0, 1, 0, 0, 2, 0, 0];

    sliver.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([...realTriangle, ...collinearTriangle], 3),
    );

    expect(mergeGeometries([sliver]).getAttribute("position").count).toBe(3);
  });

  it("leaves the rider and bike no drawn vertex without a unit normal", () => {
    expect(riderNormalGaps()).toEqual([]);
  });
});
