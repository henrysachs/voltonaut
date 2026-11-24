import {
  ItemDefSchema,
  SeasonDefinitionSchema,
  type ItemDef,
  type SeasonDefinition,
  type SeasonReward,
} from "@voltonaut/shared";

import { isSeasonOpen } from "./season.js";

/** Tier rewards for season 01: two exclusive catalog items, Volts otherwise (⚠️ starting values). */
const SEASON_01_ITEMS: ReadonlyMap<number, string> = new Map([
  [10, "jersey.season-01"],
  [20, "wheels.season-01"],
]);

function seasonOneReward(tier: number): SeasonReward {
  const itemId = SEASON_01_ITEMS.get(tier);

  return itemId === undefined
    ? { kind: "volts", amountVolts: 200 + 20 * tier }
    : { kind: "item", itemId };
}

const season01 = {
  id: "season-01",
  name: "Winterblitz",
  startsAt: "2027-01-04T00:00:00Z",
  endsAt: "2027-03-15T00:00:00Z",
  tiers: Array.from({ length: 20 }, (_, index) => ({
    tier: index + 1,
    pointsRequired: 1800 * (index + 1),
    rewards: [seasonOneReward(index + 1)],
  })),
};

export const SEASONS: readonly SeasonDefinition[] = Object.freeze([
  SeasonDefinitionSchema.parse(season01),
]);

/**
 * Season-exclusive avatar items. They are not part of the documented start
 * catalog; the garage lists them once season progress exists (spec E6-06 phase C).
 */
export const SEASON_AVATAR_ITEMS: readonly ItemDef[] = Object.freeze([
  ItemDefSchema.parse({
    id: "jersey.season-01",
    slot: "jersey",
    name: "Winterblitz",
    assetRef: "procedural://rider/jersey/season-01",
    colorable: 2,
    unlock: { kind: "season", seasonId: "season-01", tier: 10 },
    rarity: "epic",
  }),
  ItemDefSchema.parse({
    id: "wheels.season-01",
    slot: "wheels",
    name: "Winterblitz",
    assetRef: "procedural://bike/wheels/season-01",
    colorable: 0,
    unlock: { kind: "season", seasonId: "season-01", tier: 20 },
    rarity: "legendary",
  }),
]);

/** The season whose window contains atMs, if any. */
export function seasonAt(atMs: number): SeasonDefinition | undefined {
  return SEASONS.find((season) => isSeasonOpen(season, atMs));
}
