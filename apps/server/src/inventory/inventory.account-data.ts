import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { InventoryAccountExportSchema, type InventoryAccountExport } from "@voltonaut/shared";
import { DRIZZLE, type ServerDatabase } from "../database/drizzle.provider.js";
import { INVENTORY_TABLES, type InventoryTables } from "./inventory.schema.js";
import { InventoryService } from "./inventory.service.js";

/** Account export/deletion port for the inventory; the inventory module stays the only owner of the table. */
@Injectable()
export class InventoryAccountDataService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    @Inject(INVENTORY_TABLES) private readonly tables: InventoryTables,
    @Inject(InventoryService) private readonly inventory: Readonly<Pick<InventoryService, "list">>,
  ) {}

  /** Only purchased items; catalog defaults are owned by every account and carry no personal data. */
  public exportOwn(userId: string): InventoryAccountExport {
    return InventoryAccountExportSchema.parse({
      items: this.inventory.list(userId).items.filter((item) => item.source !== "default"),
    });
  }

  public deleteOwn(userId: string): void {
    const { inventory } = this.tables;

    this.db.delete(inventory).where(eq(inventory.userId, userId)).run();
  }
}
