import { assert, constantFrom, property, record, subarray, tuple } from "fast-check";
import { expect, it } from "vitest";

import type { AvatarConfig } from "@voltonaut/shared";

import {
  AVATAR_SLOTS,
  START_AVATAR_CATALOG,
  avatarColorOptions,
  avatarItemIdForSlot,
  avatarItemsForSlot,
  decideLoadout,
} from "./index.js";

function ids(slot: Parameters<typeof avatarItemsForSlot>[0]) {
  return constantFrom(...avatarItemsForSlot(slot).map((item) => item.id));
}

function colors(slot: Parameters<typeof avatarColorOptions>[0]) {
  return constantFrom(...avatarColorOptions(slot));
}

const anyLoadout = record({
  rider: record({
    skinTone: colors("skin"),
    jerseyId: ids("jersey"),
    jerseyColors: tuple(colors("jersey"), colors("jersey")),
    helmetId: ids("helmet"),
    helmetColor: colors("helmet"),
    shoesId: ids("shoes"),
    glassesId: ids("glasses"),
  }),
  bike: record({ frameId: ids("frame"), frameColor: colors("frame"), wheelsId: ids("wheels") }),
});

const anyOwned = subarray(START_AVATAR_CATALOG.map((item) => item.id));

/** The decision the property expects: ownership is the only thing left to differ. */
function expectedKind(loadout: Readonly<AvatarConfig>, ownedItemIds: readonly string[]) {
  const worn = AVATAR_SLOTS.map((slot) => avatarItemIdForSlot(loadout, slot));

  return worn.every((id) => ownedItemIds.includes(id)) ? "valid" : "not_owned";
}

it("a palette loadout is valid exactly when every item in it is owned", () => {
  assert(
    property(
      anyLoadout,
      anyOwned,
      (loadout: Readonly<AvatarConfig>, ownedItemIds: readonly string[]) => {
        expect(decideLoadout({ loadout, ownedItemIds }).kind).toBe(
          expectedKind(loadout, ownedItemIds),
        );
      },
    ),
  );
});
