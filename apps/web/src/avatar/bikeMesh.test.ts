import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { mergeGeometries } from "./bikeMesh.js";

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
