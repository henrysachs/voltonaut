import { array, assert, integer, property, tuple } from "fast-check";
import { expect, it } from "vitest";

import { RewardFactsSchema, SeasonDefinitionSchema, SeasonPointsSchema } from "@voltonaut/shared";

import { dueTiers, ridePointsDelta, tierForPoints } from "./index.js";

const season = SeasonDefinitionSchema.parse({
  id: "season-98",
  name: "Property",
  startsAt: "2027-01-04T00:00:00Z",
  endsAt: "2027-03-15T00:00:00Z",
  tiers: Array.from({ length: 25 }, (_, index) => ({
    tier: index + 1,
    pointsRequired: 700 * (index + 1) + index * index,
    rewards: [{ kind: "volts", amountVolts: 50 }],
  })),
});

const anyPoints = integer({ min: 0, max: 30_000 });

function sorted(values: readonly number[]): readonly number[] {
  return values.toSorted((a, b) => a - b);
}

function tiersBetween(previous: number, next: number): readonly number[] {
  return dueTiers(season, SeasonPointsSchema.parse(previous), SeasonPointsSchema.parse(next)).map(
    ({ tier }) => tier,
  );
}

it("split sections equal the whole: no tier is granted twice or skipped", () => {
  assert(
    property(
      tuple(anyPoints, anyPoints, anyPoints),
      (values: readonly [number, number, number]) => {
        const [a = 0, b = 0, c = 0] = sorted(values);

        expect([...tiersBetween(a, b), ...tiersBetween(b, c)]).toEqual(tiersBetween(a, c));
      },
    ),
  );
});

it("tierForPoints is monotonic and matches the tiers due from zero", () => {
  assert(
    property(anyPoints, (value) => {
      const tier = tierForPoints(season, SeasonPointsSchema.parse(value));

      expect(tier).toBeLessThanOrEqual(tierForPoints(season, SeasonPointsSchema.parse(value + 1)));
      expect(tiersBetween(0, value)).toHaveLength(tier);
    }),
  );
});

it("cumulative section deltas sum to the whole-ride points", () => {
  assert(
    property(
      array(integer({ min: 0, max: 5000 }), { maxLength: 12 }),
      (steps: readonly number[]) => {
        let total = 0;

        const cumulative = steps.map((step) => (total += step));

        const factsAt = cumulative.map((distanceM) =>
          RewardFactsSchema.parse({
            activeDistanceM: distanceM,
            activeElevationGainM: 0,
            activeTimeS: 0,
            elevationGainM: 0,
            energyKj: 0,
          }),
        );

        const deltas = factsAt.map((facts, index) => ridePointsDelta(factsAt[index - 1], facts));

        expect(deltas.reduce((sum, delta) => sum + delta, 0)).toBe(Math.floor(total / 50));
      },
    ),
  );
});
