import { expect, it } from "vitest";

import { SeasonDefinitionSchema } from "@voltonaut/shared";

import { SEASON_AVATAR_ITEMS, SEASONS, seasonAt, START_AVATAR_CATALOG } from "./index.js";

const seasonOne = SEASONS.find((season) => season.id === "season-01");

/** "season-01#10 → jersey.season-01" for every item reward of every season. */
function rewardedItems(): readonly string[] {
  return SEASONS.flatMap((season) =>
    season.tiers.flatMap((tier) =>
      tier.rewards.flatMap((reward) =>
        reward.kind === "item" ? [`${season.id}#${tier.tier} → ${reward.itemId}`] : [],
      ),
    ),
  ).toSorted();
}

/** The same mapping read from the season items' unlock rules. */
function seasonUnlockedItems(): readonly string[] {
  return SEASON_AVATAR_ITEMS.flatMap((item) =>
    item.unlock.kind === "season"
      ? [`${item.unlock.seasonId}#${item.unlock.tier} → ${item.id}`]
      : [],
  ).toSorted();
}

function windowsOverlap(): boolean {
  return SEASONS.some((season, index) =>
    SEASONS.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        Date.parse(season.startsAt) < Date.parse(other.endsAt) &&
        Date.parse(other.startsAt) < Date.parse(season.endsAt),
    ),
  );
}

it("every season parses with SeasonDefinitionSchema", () => {
  expect(SEASONS.map((season) => SeasonDefinitionSchema.safeParse(season).success)).not.toContain(
    false,
  );
});

it("season ids are unique and seasons do not overlap", () => {
  expect(new Set(SEASONS.map((season) => season.id)).size).toBe(SEASONS.length);
  expect(windowsOverlap()).toBe(false);
});

it("season-01 runs ten weeks with 20 tiers at 1800 points each", () => {
  expect(seasonOne?.startsAt).toBe("2027-01-04T00:00:00Z");
  expect(seasonOne?.endsAt).toBe("2027-03-15T00:00:00Z");
  expect(seasonOne?.tiers.map((tier) => tier.pointsRequired)).toEqual(
    Array.from({ length: 20 }, (_, index) => 1800 * (index + 1)),
  );
});

it("item rewards and catalog season unlocks match one to one", () => {
  expect(rewardedItems()).toEqual(seasonUnlockedItems());
  expect(rewardedItems()).toEqual([
    "season-01#10 → jersey.season-01",
    "season-01#20 → wheels.season-01",
  ]);
});

it("season items are valid, unique and kept out of the start catalog", () => {
  const startIds = new Set(START_AVATAR_CATALOG.map((item) => item.id));

  expect(SEASON_AVATAR_ITEMS.map((item) => item.id).filter((id) => startIds.has(id))).toEqual([]);
  expect(new Set(SEASON_AVATAR_ITEMS.map((item) => item.id)).size).toBe(SEASON_AVATAR_ITEMS.length);
  expect(Object.isFrozen(SEASON_AVATAR_ITEMS)).toBe(true);
});

it("seasonAt returns season-01 inside and undefined outside its window", () => {
  expect(seasonAt(Date.parse("2027-01-04T00:00:00Z"))?.id).toBe("season-01");
  expect(seasonAt(Date.parse("2027-03-14T23:59:59Z"))?.id).toBe("season-01");
  expect(seasonAt(Date.parse("2027-03-15T00:00:00Z"))).toBeUndefined();
  expect(seasonAt(Date.parse("2026-11-24T12:00:00Z"))).toBeUndefined();
});
