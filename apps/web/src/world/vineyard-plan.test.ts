import { describe, expect, it } from "vitest";

import { biomeFromScenery } from "./biome.js";
import { heightAt } from "./heightfield.js";
import { vineyardFixture } from "./testdata/vineyardWorld.js";
import {
  CYPRESS_CLEARANCE_M,
  HOUSE_CLEARANCE_M,
  MAX_VINE_CHORDS,
  VINE_CLEARANCE_M,
  type VineChord,
} from "./vineyard-plan.js";
import { planVineyard } from "./vineyard-decor.js";

const { world, plan, vineyard } = vineyardFixture();

interface Flat {
  readonly x: number;
  readonly z: number;
}

/** Distance from a point to the nearest centerline chord of the given roads. */
function roadDistanceM(point: Flat, roads = world.regionRoads): number {
  let nearestM = Number.POSITIVE_INFINITY;

  for (const road of roads) {
    for (const [index, b] of road.centerline.entries()) {
      const a = road.centerline[index - 1];

      if (a !== undefined) {
        const dx = b.x - a.x;
        const dz = b.z - a.z;

        const t = Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz)),
        );

        nearestM = Math.min(nearestM, Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz));
      }
    }
  }

  return nearestM;
}

function closestM(points: readonly Flat[], roads = world.regionRoads): number {
  return Math.min(...points.map((point) => roadDistanceM(point, roads)));
}

/** Rise per metre along a chord, read from the drawn raster at its two ends. */
function riseOf(chord: VineChord): number {
  const halfM = chord.lengthM / 2;
  const dx = Math.cos(chord.yawRad) * halfM;
  const dz = -Math.sin(chord.yawRad) * halfM;
  const { x, z } = chord.position;

  return (
    Math.abs(heightAt(plan.terrain, x + dx, z + dz) - heightAt(plan.terrain, x - dx, z - dz)) /
    chord.lengthM
  );
}

describe("vineyard region plan", () => {
  it("is the vineyard biome with its own terrain colours", () => {
    expect(biomeFromScenery("vineyard")).toEqual({ kind: "vineyard" });
    expect(world.regions.map((region) => region.biome.kind)).toEqual([
      "forest",
      "vineyard",
      "coast",
      "night-city",
    ]);
    expect(plan.route.id).toBe("voltonaut-vineyard");
  });

  it("plants vine rows, cypresses and a few stone houses deterministically", () => {
    expect(vineyard.chords.length).toBeGreaterThan(1500);
    expect(vineyard.chords.length).toBeLessThanOrEqual(MAX_VINE_CHORDS);
    expect(vineyard.cypresses.length).toBeGreaterThan(80);
    expect(vineyard.houses.length).toBeGreaterThanOrEqual(8);
    expect(vineyard.houses.length).toBeLessThanOrEqual(40);
    expect(planVineyard(plan)).toEqual(vineyard);
  });

  it("lays every vine chord level along a contour line of the raster", () => {
    const rises = vineyard.chords.map((chord) => riseOf(chord));
    const meanRise = rises.reduce((sum, rise) => sum + rise, 0) / rises.length;

    expect(meanRise).toBeLessThan(0.03);
    expect(Math.max(...rises)).toBeLessThan(0.1);
  });

  it("keeps vines, cypresses and houses out of the corridor of every road of the world", () => {
    expect(closestM(vineyard.chords.map((chord) => chord.position))).toBeGreaterThanOrEqual(
      VINE_CLEARANCE_M - 1,
    );
    expect(closestM(vineyard.cypresses.map((cypress) => cypress.position))).toBeGreaterThanOrEqual(
      CYPRESS_CLEARANCE_M - 1,
    );
    expect(closestM(vineyard.houses.map((house) => house.position))).toBeGreaterThanOrEqual(
      HOUSE_CLEARANCE_M - 1,
    );
  });

  it("keeps decor off the other regions' roads too, not only the home path", () => {
    const others = world.regionRoads.filter((road) => road.regionId !== "vineyard");
    const points = [...vineyard.chords, ...vineyard.houses].map((item) => item.position);

    expect(others.length).toBeGreaterThan(0);
    expect(closestM(points, others)).toBeGreaterThanOrEqual(VINE_CLEARANCE_M - 1);
  });
});
