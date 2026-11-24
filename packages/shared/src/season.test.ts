import type { z } from "zod";
import { expect, it } from "vitest";

import { SeasonDefinitionSchema, SeasonPointsSchema, UnlockRuleSchema } from "./index.js";

type SeasonCandidate = z.input<typeof SeasonDefinitionSchema>;

function tiers(thresholds: readonly number[]): SeasonCandidate["tiers"] {
  return thresholds.map((pointsRequired, index) => ({
    tier: index + 1,
    pointsRequired,
    rewards: [index % 2 === 0 ? { kind: "volts", amount: 250 } : { kind: "item", itemId: "x" }],
  }));
}

function linear(count: number, step = 1800): readonly number[] {
  return Array.from({ length: count }, (_, index) => step * (index + 1));
}

const valid: SeasonCandidate = {
  id: "season-01",
  name: "Winterblitz",
  startsAt: "2027-01-04T00:00:00Z",
  endsAt: "2027-03-15T00:00:00Z",
  tiers: tiers(linear(20)),
};

function issuePaths(candidate: Readonly<SeasonCandidate>): readonly string[] {
  const result = SeasonDefinitionSchema.safeParse(candidate);

  const paths: string[] = [];

  for (const issue of result.error?.issues ?? []) paths.push(issue.path.join("."));

  return paths;
}

it("accepts a minimal valid 20-tier season", () => {
  expect(issuePaths(valid)).toEqual([]);
});

it("rejects endsAt <= startsAt", () => {
  expect(issuePaths({ ...valid, endsAt: valid.startsAt })).toContain("endsAt");
});

it("accepts exactly 56 and 84 days and rejects anything outside", () => {
  expect(issuePaths({ ...valid, endsAt: "2027-02-28T00:00:00Z" })).toContain("endsAt");
  expect(issuePaths({ ...valid, endsAt: "2027-03-01T00:00:00Z" })).toEqual([]);
  expect(issuePaths({ ...valid, endsAt: "2027-03-29T00:00:00Z" })).toEqual([]);
  expect(issuePaths({ ...valid, endsAt: "2027-03-29T00:00:01Z" })).toContain("endsAt");
});

it("rejects tiers that are not numbered 1..n consecutively", () => {
  const gap = tiers(linear(21)).filter((tier) => tier.tier !== 5);

  expect(issuePaths({ ...valid, tiers: gap })).toContain("tiers.4.tier");
});

it("rejects pointsRequired that is not strictly increasing or not positive", () => {
  const flat = [1800, 3600, 3600, ...linear(20).slice(3)];

  expect(issuePaths({ ...valid, tiers: tiers(flat) })).toContain("tiers.2.pointsRequired");
  expect(issuePaths({ ...valid, tiers: tiers(linear(20, 0)) })).toContain("tiers.0.pointsRequired");
});

it("rejects unknown reward kinds, extra fields and malformed ids", () => {
  const routeTier = { tier: 1, pointsRequired: 1800, rewards: [{ kind: "route", routeId: "x" }] };

  expect(
    SeasonDefinitionSchema.safeParse({ ...valid, tiers: [routeTier, ...valid.tiers.slice(1)] })
      .success,
  ).toBe(false);
  expect(SeasonDefinitionSchema.safeParse({ ...valid, premium: true }).success).toBe(false);
  expect(issuePaths({ ...valid, id: "winter" })).toContain("id");
});

it("rejects fewer than 20 tiers", () => {
  expect(issuePaths({ ...valid, tiers: tiers(linear(19)) })).toContain("tiers");
});

it("requires safe non-negative integer season points", () => {
  expect(SeasonPointsSchema.safeParse(0).success).toBe(true);
  expect(SeasonPointsSchema.safeParse(-1).success).toBe(false);
  expect(SeasonPointsSchema.safeParse(1.5).success).toBe(false);
});

it("accepts a season tier unlock and rejects tier 0", () => {
  expect(UnlockRuleSchema.parse({ kind: "season", seasonId: "season-01", tier: 3 })).toEqual({
    kind: "season",
    seasonId: "season-01",
    tier: 3,
  });
  expect(
    UnlockRuleSchema.safeParse({ kind: "season", seasonId: "season-01", tier: 0 }).success,
  ).toBe(false);
});
