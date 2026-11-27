import { describe, expect, it } from "vitest";

import type { ElevationSample } from "../../elevation/profile.js";
import { createRoute, type RouteData } from "../../elevation/route.js";
import { worldPathRoute } from "../registry.js";
import { FELSENTAL_WORLD } from "./felsental.js";
import { FELSENTAL, TEST_WORLDS, VOLTONAUT, WORLDS } from "./index.js";

const PATH = { worldId: "felsental", worldRevision: "1", pathId: "felsental" } as const;

function felsental(): RouteData {
  const route = worldPathRoute(WORLDS, PATH);

  if (route === undefined) throw new Error("test: felsental is not registered");

  return route;
}

/** Grade in percent between each pair of neighbouring samples inside [fromM, toM]. */
function sampleGradesPct(
  samples: readonly ElevationSample[],
  fromM = 0,
  toM = Number.POSITIVE_INFINITY,
): readonly number[] {
  const grades: number[] = [];

  for (const [index, sample] of samples.entries()) {
    const next = samples[index + 1];

    if (next === undefined || sample.distanceM < fromM || next.distanceM > toM) continue;

    grades.push(
      ((next.elevationM - sample.elevationM) / (next.distanceM - sample.distanceM)) * 100,
    );
  }

  return grades;
}

/** Absolute grade change from each sample pair to the next, across the lap line too. */
function lapGradeStepsPct(grades: readonly number[]): readonly number[] {
  return grades.map((grade, index) => Math.abs((grades[index + 1] ?? grades[0] ?? grade) - grade));
}

function steinbruch(): { readonly startM: number; readonly endM: number } {
  const segment = felsental().segments.find((candidate) => candidate.id === "steinbruch");

  if (segment === undefined) throw new Error("test: felsental has no Steinbruch segment");

  return segment;
}

describe("Felsental world (spec E10-15 AK1)", () => {
  it("is registered as world felsental with revision 1 and one stone-age loop path", () => {
    expect(WORLDS).toContain(FELSENTAL);
    expect(FELSENTAL).toMatchObject({ id: "felsental", name: "Felsental", revision: "1" });
    expect(FELSENTAL.routes.map((route) => route.id)).toEqual(["felsental"]);
    expect(felsental()).toMatchObject({
      id: "felsental",
      name: "Felsental",
      loop: true,
      scenery: "stone-age",
    });
  });

  it("is a native network: one region, one node and one edge that closes on it", () => {
    expect(FELSENTAL_WORLD.legacyRoute).toBeUndefined();
    expect(FELSENTAL_WORLD.regions).toEqual([
      { id: "felsental", name: "Felsental", scenery: "stone-age" },
    ]);
    expect(FELSENTAL_WORLD.nodes).toHaveLength(1);
    expect(FELSENTAL_WORLD.edges).toHaveLength(1);
    expect(FELSENTAL_WORLD.edges[0]?.fromNodeId).toBe(FELSENTAL_WORLD.nodes[0]?.id);
    expect(FELSENTAL_WORLD.edges[0]?.toNodeId).toBe(FELSENTAL_WORLD.nodes[0]?.id);
  });

  it("runs about 9 km and builds a valid engine route", () => {
    const route = createRoute(felsental());

    expect(route.lengthM).toBeGreaterThanOrEqual(8500);
    expect(route.lengthM).toBeLessThanOrEqual(9500);
  });

  it("closes the loop in plan and in elevation", () => {
    const { centerline, profileSamples } = felsental();

    expect(centerline.at(-1)).toStrictEqual(centerline[0]);
    expect(profileSamples.at(-1)?.elevationM).toBe(profileSamples[0]?.elevationM);
    expect(FELSENTAL_WORLD.nodes[0]?.elevationM).toBe(profileSamples[0]?.elevationM);
  });

  it("resolves its path only in its own world and revision", () => {
    expect(worldPathRoute([FELSENTAL], PATH)?.id).toBe("felsental");
    expect(worldPathRoute(TEST_WORLDS, PATH)).toBeUndefined();
    expect(worldPathRoute([VOLTONAUT], { ...PATH, worldId: "voltonaut" })).toBeUndefined();
    expect(worldPathRoute(WORLDS, { ...PATH, worldRevision: "2" })).toBeUndefined();
  });
});

describe("Felsental revision 1 geometry", () => {
  it("keeps the revision 1 geometry: start, extent and profile marks", () => {
    const route = createRoute(felsental());
    const xs = felsental().centerline.map((point) => point.x);
    const zs = felsental().centerline.map((point) => point.z);
    const start = route.worldPos(0);

    expect(route.lengthM).toBe(9000);
    expect(felsental().centerline).toHaveLength(721);
    expect(start.x).toBeCloseTo(1974.56, 2);
    expect(start.y).toBe(140);
    expect(start.z).toBeCloseTo(49.86, 2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3949, 0);
    expect(Math.max(...zs)).toBeCloseTo(648, 0);
    expect(Math.min(...zs)).toBeCloseTo(-727, 0);
    expect(route.profile.elevationAt(1000)).toBe(140);
    expect(route.profile.elevationAt(1200)).toBeCloseTo(144, 9);
    expect(route.profile.elevationAt(3200)).toBeCloseTo(246.5, 9);
    expect(route.profile.elevationAt(3600)).toBeCloseTo(250.5, 9);
    expect(route.profile.elevationAt(5300)).toBeCloseTo(195.25, 9);
    expect(route.profile.elevationAt(8000)).toBe(140);
  });
});

describe("Felsental profile (spec E10-15 AK2)", () => {
  it("starts and ends on a flat valley floor", () => {
    const samples = felsental().profileSamples;

    expect(sampleGradesPct(samples, 0, 1000).every((grade) => grade === 0)).toBe(true);
    expect(sampleGradesPct(samples, 6800, 9000).every((grade) => grade === 0)).toBe(true);
  });

  it("puts the Steinbruch KOM over a 2 km climb at 4–8 % with a mean near 5 %", () => {
    const { startM, endM } = steinbruch();
    const route = createRoute(felsental());
    const grades = sampleGradesPct(felsental().profileSamples, startM, endM);

    const meanPct =
      ((route.profile.elevationAt(endM) - route.profile.elevationAt(startM)) / (endM - startM)) *
      100;

    expect(felsental().segments).toEqual([
      { id: "steinbruch", name: "Steinbruch", kind: "kom", startM, endM },
    ]);
    expect(endM - startM).toBeGreaterThanOrEqual(1900);
    expect(endM - startM).toBeLessThanOrEqual(2100);
    expect(grades).toHaveLength((endM - startM) / 10);
    expect(Math.min(...grades)).toBeGreaterThanOrEqual(4 - 1e-9);
    expect(Math.max(...grades)).toBeLessThanOrEqual(8);
    expect(Math.max(...grades)).toBeGreaterThan(6.5);
    expect(meanPct).toBeGreaterThanOrEqual(4.5);
    expect(meanPct).toBeLessThanOrEqual(5.5);
  });

  it("descends after the climb back to the valley floor", () => {
    const { endM } = steinbruch();
    const route = createRoute(felsental());
    const topM = route.profile.elevationAt(endM + 400);

    expect(topM - route.profile.elevationAt(0)).toBeGreaterThan(100);
    expect(Math.min(...sampleGradesPct(felsental().profileSamples, endM + 600, 6800))).toBeLessThan(
      -5,
    );
  });

  it("bounds the grade and its change between neighbouring samples over the whole lap", () => {
    const grades = sampleGradesPct(felsental().profileSamples);

    expect(grades).toHaveLength(900);
    expect(Math.max(...grades.map((grade) => Math.abs(grade)))).toBeLessThanOrEqual(8);
    expect(Math.max(...lapGradeStepsPct(grades))).toBeLessThanOrEqual(0.5);
  });
});
