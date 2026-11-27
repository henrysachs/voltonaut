import { createRoute, KOM_CLIMB } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import { showInView, type RegionDressing } from "./region-dressing.js";
import {
  DRESSING_MARGIN_M,
  regionBounds,
  regionInView,
  VIEW_RANGE_M,
  type RegionBounds,
} from "./region-visibility.js";

const box: RegionBounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };

function dressing(bounds: RegionBounds): RegionDressing {
  return { group: new THREE.Group(), bounds };
}

it("wraps the home road with the dressing margin", () => {
  expect(regionBounds(createRoute(KOM_CLIMB))).toEqual({
    minX: -DRESSING_MARGIN_M,
    maxX: 2500 + DRESSING_MARGIN_M,
    minZ: -DRESSING_MARGIN_M,
    maxZ: DRESSING_MARGIN_M,
  });
});

it("sees a region from inside and up to the view range outside it", () => {
  expect(VIEW_RANGE_M).toBe(1500);
  expect(regionInView(box, 50, 50)).toBe(true);
  expect(regionInView(box, 100 + VIEW_RANGE_M, 50)).toBe(true);
  expect(regionInView(box, 100 + VIEW_RANGE_M + 1, 50)).toBe(false);
  expect(regionInView(box, 50, -VIEW_RANGE_M - 1)).toBe(false);
  expect(regionInView(box, -1000, -1000)).toBe(true);
  expect(regionInView(box, -1100, -1100)).toBe(false);
});

it("hides only the regions out of view in a world of several", () => {
  const near = dressing(box);
  const far = dressing({ minX: 9000, maxX: 9100, minZ: 0, maxZ: 100 });

  showInView([near, far], 50, 50);
  expect([near.group.visible, far.group.visible]).toEqual([true, false]);
  showInView([near, far], 9050, 50);
  expect([near.group.visible, far.group.visible]).toEqual([false, true]);
});

it("always shows the single region of a single-route world", () => {
  const only = dressing({ minX: 9000, maxX: 9100, minZ: 0, maxZ: 100 });

  showInView([only], 0, 0);
  expect(only.group.visible).toBe(true);
});
