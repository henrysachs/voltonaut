import { ALPINE_PASS, COAST_LOOP, NIGHT_CITY, TEST_LOOP, type RouteData } from "@voltonaut/engine";
import { describe, expect, it } from "vitest";

import {
  formatRouteLength,
  PREVIEW_HEIGHT_PX,
  PREVIEW_WIDTH_PX,
  routeElevationGainM,
  routePreviewPath,
} from "./routePreview.js";

function previewCoordinates(path: string): readonly number[] {
  return [...path.matchAll(/-?\d+(?:\.\d+)?/gu)].map((match: readonly string[]) =>
    Number(match[0]),
  );
}

function coordinateAt(coordinates: readonly number[], index: number): number {
  const value = coordinates[index];

  if (value === undefined) throw new TypeError("preview coordinate is missing");

  return value;
}

function pathCommands(path: string): readonly string[] {
  const commands = path.match(/(?<=[ ])(?<command>[ML])/gu);

  if (commands === null) throw new TypeError("preview path commands are missing");

  return commands;
}

describe("route preview path", () => {
  it.each([TEST_LOOP, COAST_LOOP, NIGHT_CITY, ALPINE_PASS])(
    "$id scales into the preview box with aspect preserved",
    (route: Readonly<RouteData>) => {
      const path = routePreviewPath(route.centerline);
      const coordinates = previewCoordinates(path);

      expect(path.startsWith("M ")).toBe(true);
      expect(path).toContain(" L ");

      for (const coordinate of coordinates) {
        expect(coordinate).toBeGreaterThanOrEqual(0);
        expect(coordinate).toBeLessThanOrEqual(Math.max(PREVIEW_WIDTH_PX, PREVIEW_HEIGHT_PX));
      }
    },
  );

  it("uses every centerline point and closes loops at their start", () => {
    const loopPath = routePreviewPath(COAST_LOOP.centerline);
    const commands = pathCommands(loopPath);

    expect(commands).toHaveLength(COAST_LOOP.centerline.length - 1);
    expect(commands.every((command) => command === "L")).toBe(true);

    const first = loopPath.slice(2, loopPath.indexOf(" L "));
    const last = loopPath.slice(loopPath.lastIndexOf("L ") + 2);

    expect(last).toBe(first);
  });

  it("maps north (max z) to the top of the preview box", () => {
    const path = routePreviewPath([
      { x: 0, z: 0 },
      { x: 0, z: 10 },
      { x: 3, z: 10 },
    ]);

    const coordinates = previewCoordinates(path);

    expect(coordinateAt(coordinates, 3)).toBeLessThan(coordinateAt(coordinates, 1));
  });
});

describe("route preview validation", () => {
  it("rejects centerlines that have no two-dimensional extent", () => {
    expect(() =>
      routePreviewPath([
        { x: 0, z: 0 },
        { x: 5, z: 0 },
      ]),
    ).toThrow(RangeError);
    expect(() => routePreviewPath([{ x: 0, z: 0 }])).toThrow(RangeError);
  });
});

describe("route card stats", () => {
  it("sums only the climbing steps of a profile", () => {
    expect(
      routeElevationGainM([
        { distanceM: 0, elevationM: 100 },
        { distanceM: 10, elevationM: 110 },
        { distanceM: 20, elevationM: 105 },
        { distanceM: 30, elevationM: 111 },
      ]),
    ).toBe(16);

    expect(
      routeElevationGainM([
        { distanceM: 0, elevationM: 10 },
        { distanceM: 10, elevationM: 5 },
      ]),
    ).toBe(0);
  });

  it("matches the designed gain of every catalog route", () => {
    expect(routeElevationGainM(ALPINE_PASS.profileSamples)).toBe(840);
    expect(routeElevationGainM(NIGHT_CITY.profileSamples)).toBeLessThan(40);
    expect(routeElevationGainM(COAST_LOOP.profileSamples)).toBeLessThan(200);
    expect(routeElevationGainM(TEST_LOOP.profileSamples)).toBeGreaterThan(90);
  });

  it("formats whole and fractional kilometre lengths", () => {
    expect(formatRouteLength(8000)).toBe("8 km");
    expect(formatRouteLength(12_500)).toBe("12.5 km");
  });
});
