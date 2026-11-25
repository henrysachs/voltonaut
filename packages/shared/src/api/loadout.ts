import { z } from "zod";

import { AvatarConfigSchema } from "../avatarCatalog.js";

/** Catalog item id, same bounds as the avatar catalog. */
const ItemIdSchema = z.string().trim().min(1).max(120);

/** Stored equipment of an account; `updatedAt: null` is the default loadout without a row (spec E7-05 AK4). */
export const LoadoutResponseSchema = z
  .object({
    loadout: AvatarConfigSchema,
    updatedAt: z.string().datetime().nullable(),
  })
  .strict()
  .readonly();

export const LoadoutUpdateSchema = z.object({ loadout: AvatarConfigSchema }).strict().readonly();

/** Input of the pure loadout decision in `@voltonaut/rules`. */
export const LoadoutDecisionInputSchema = z
  .object({
    loadout: AvatarConfigSchema,
    ownedItemIds: z.array(ItemIdSchema).max(1000).readonly(),
  })
  .strict()
  .readonly();

export type LoadoutResponse = z.infer<typeof LoadoutResponseSchema>;

export type LoadoutUpdate = z.infer<typeof LoadoutUpdateSchema>;

export type LoadoutDecisionInput = z.input<typeof LoadoutDecisionInputSchema>;
