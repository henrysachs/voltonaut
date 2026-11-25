import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";

import { InventoryController } from "./inventory.controller.js";
import { INVENTORY_TABLES, type InventoryTables } from "./inventory.schema.js";
import { InventoryService } from "./inventory.service.js";

@Module({})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest dynamic modules expose their registration factory on the decorated class.
export class InventoryModule {
  public static register(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Module registration passes the original Drizzle table metadata into DI.
    tables: InventoryTables,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The registered economy module exports the ledger service this module books through.
    economy: DynamicModule,
  ): DynamicModule {
    return {
      module: InventoryModule,
      imports: [economy],
      controllers: [InventoryController],
      providers: [InventoryService, { provide: INVENTORY_TABLES, useValue: tables }],
    };
  }
}
