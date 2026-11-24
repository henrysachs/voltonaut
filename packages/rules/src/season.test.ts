import { expect, it } from "vitest";

import {
  RewardFactsSchema,
  SeasonDefinitionSchema,
  SeasonPointsSchema,
  type RewardFacts,
} from "@voltonaut/shared";

import {
  applySeasonSection,
  dueTiers,
  isSeasonOpen,
  ridePointsDelta,
  tierForPoints,
} from "./index.js";

const season = SeasonDefinitionSchema.parse({
  id: "season-99",
  name: "Test",
  startsAt: "2027-01-04T00:00:00Z",
  endsAt: "2027-03-15T00:00:00Z",
  tiers: Array.from({ length: 20 }, (_, index) => ({
    tier: index + 1,
    pointsRequired: 1800 * (index + 1),
    rewards: [{ kind: "volts", amountVolts: 100 }],
  })),
});

const startMs = Date.parse("2027-01-04T00:00:00Z");
const endMs = Date.parse("2027-03-15T00:00:00Z");

function points(value: number) {
  return SeasonPointsSchema.parse(value);
}

function facts(activeDistanceM: number): RewardFacts {
  return RewardFactsSchema.parse({
    activeDistanceM,
    activeElevationGainM: 0,
    activeTimeS: 0,
    elevationGainM: 0,
    energyKj: 0,
  });
}

function tierNumbers(previous: number, next: number): readonly number[] {
  return dueTiers(season, points(previous), points(next)).map(({ tier }) => tier);
}

it("rejects missing inputs at public boundaries", () => {
  expect(isSeasonOpen).toThrow("Required");
  expect(tierForPoints).toThrow("Required");
  expect(dueTiers).toThrow("Required");
  expect(ridePointsDelta).toThrow("Required");
  expect(applySeasonSection).toThrow("Required");
});

it("isSeasonOpen includes start and excludes end", () => {
  expect(isSeasonOpen(season, startMs - 1)).toBe(false);
  expect(isSeasonOpen(season, startMs)).toBe(true);
  expect(isSeasonOpen(season, endMs - 1)).toBe(true);
  expect(isSeasonOpen(season, endMs)).toBe(false);
});

it("tierForPoints is 0 below tier 1 and caps at last tier", () => {
  expect(tierForPoints(season, points(0))).toBe(0);
  expect(tierForPoints(season, points(1799))).toBe(0);
  expect(tierForPoints(season, points(1800))).toBe(1);
  expect(tierForPoints(season, points(5399))).toBe(2);
  expect(tierForPoints(season, points(36_000 * 10))).toBe(20);
});

it("dueTiers returns every crossed tier and counts an exact threshold once", () => {
  expect(tierNumbers(0, 5400)).toEqual([1, 2, 3]);
  expect(tierNumbers(1800, 1800)).toEqual([]);
  expect(tierNumbers(1799, 1800)).toEqual([1]);
  expect(tierNumbers(1800, 3599)).toEqual([]);
  expect(tierNumbers(35_999, 1_000_000)).toEqual([20]);
  expect(() => dueTiers(season, points(10), points(9))).toThrow("must not decrease");
});

it("ridePointsDelta keeps whole-ride rounding", () => {
  expect(ridePointsDelta(undefined, facts(25))).toBe(0);
  expect(ridePointsDelta(facts(25), facts(50))).toBe(1);
  expect(ridePointsDelta(undefined, facts(20_000))).toBe(400);
  expect(() => ridePointsDelta(facts(50), facts(25))).toThrow("cumulative");
});

it("adds points and crossed tiers for a section inside the window", () => {
  const result = applySeasonSection({
    season,
    currentPoints: points(1700),
    before: facts(1000),
    after: facts(11_000),
    sectionAtMs: startMs,
  });

  expect(result.points).toBe(1900);
  expect(result.newTiers.map(({ tier }) => tier)).toEqual([1]);
  expect(Object.isFrozen(result)).toBe(true);
});

it("uses section time, not confirmation time, and ignores sections outside the window", () => {
  const section = { season, currentPoints: points(1700), before: undefined, after: facts(5000) };

  expect(applySeasonSection({ ...section, sectionAtMs: endMs - 1 }).points).toBe(1800);
  expect(applySeasonSection({ ...section, sectionAtMs: endMs })).toEqual({
    points: 1700,
    newTiers: [],
  });
  expect(applySeasonSection({ ...section, sectionAtMs: startMs - 1 }).newTiers).toEqual([]);
});
