import { expect, it } from "vitest";

import { blendedShades, FOREST_TERRAIN, shadesOf } from "./terrain-shades.js";

const black = shadesOf({ low: 0x000000, high: 0x000000, shore: 0x000000, ground: 0 });
const white = shadesOf({ low: 0xffffff, high: 0xffffff, shore: 0xffffff, ground: 0 });

it("returns a fully weighted region's shades unchanged", () => {
  const forest = shadesOf(FOREST_TERRAIN);

  expect(blendedShades([forest], [1])).toBe(forest);
  expect(blendedShades([black, white], [0, 1])).toBe(white);
});

it("mixes every shade channel by weight", () => {
  const half = blendedShades([black, white], [0.5, 0.5]);

  expect(half.low).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  expect(half.high).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  expect(half.shore).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  expect(blendedShades([black, white], [0.75, 0.25]).low.g).toBeCloseTo(0.25, 12);
});
