import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { DEFAULT_AVATAR_CONFIG, decideLoadout } from "@voltonaut/rules";
import {
  AvatarConfigSchema,
  LoadoutResponseSchema,
  LoadoutUpdateSchema,
  type LoadoutResponse,
  type LoadoutUpdate,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { CLOCK, type Clock } from "../clock.js";
import { DRIZZLE, type ServerDatabase } from "../database/drizzle.provider.js";
import { INVENTORY_TABLES, type InventoryTables } from "./inventory.schema.js";
import { InventoryService } from "./inventory.service.js";

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Drizzle owns mutable driver state and table metadata. */
@Injectable()
export class LoadoutService {
  private readonly loadouts: InventoryTables["avatarLoadouts"];

  public constructor(
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    @Inject(INVENTORY_TABLES) tables: InventoryTables,
    @Inject(InventoryService) private readonly inventory: Readonly<Pick<InventoryService, "list">>,
    @Inject(CLOCK) private readonly clock: Readonly<Clock>,
  ) {
    this.loadouts = tables.avatarLoadouts;
  }

  /** The stored loadout, or the catalog default without a row (spec E7-05 AK4). */
  public get(userId: string): LoadoutResponse {
    const row = this.db.select().from(this.loadouts).where(eq(this.loadouts.userId, userId)).get();

    if (row === undefined)
      return LoadoutResponseSchema.parse({ loadout: DEFAULT_AVATAR_CONFIG, updatedAt: null });

    const raw: unknown = JSON.parse(row.loadoutJson);

    return LoadoutResponseSchema.parse({
      loadout: AvatarConfigSchema.parse(raw),
      updatedAt: new Date(row.updatedAt).toISOString(),
    });
  }

  /**
   * Ownership check and write in one immediate transaction (spec E7-05 AK3), so an item
   * the account does not own at commit time is never stored.
   */
  public save(userId: string, update: Readonly<LoadoutUpdate>): LoadoutResponse {
    const { loadout } = LoadoutUpdateSchema.parse(update);

    return this.db.transaction(
      () => {
        const ownedItemIds = this.inventory.list(userId).items.map((item) => item.itemId);
        const decision = decideLoadout({ loadout, ownedItemIds });

        if (decision.kind === "not_owned")
          throw new ApiError(409, "not_owned", `not owned: ${decision.itemIds.join(", ")}`);

        if (decision.kind !== "valid")
          throw new ApiError(
            422,
            "validation_failed",
            `${decision.kind}: ${decision.slots.join(", ")}`,
          );

        const values = {
          userId,
          loadoutJson: JSON.stringify(loadout),
          updatedAt: this.clock.nowMs(),
        };

        this.db
          .insert(this.loadouts)
          .values(values)
          .onConflictDoUpdate({
            target: this.loadouts.userId,
            set: { loadoutJson: values.loadoutJson, updatedAt: values.updatedAt },
          })
          .run();

        return this.get(userId);
      },
      { behavior: "immediate" },
    );
  }

  public deleteOwn(userId: string): void {
    this.db.delete(this.loadouts).where(eq(this.loadouts.userId, userId)).run();
  }
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */
