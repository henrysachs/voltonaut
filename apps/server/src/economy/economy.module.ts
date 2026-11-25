import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";

import { EconomyController } from "./economy.controller.js";
import { EconomyService } from "./economy.service.js";
import { ECONOMY_TABLES } from "./economy.schema.js";
import type { EconomyTables } from "./economy.schema.js";

@Module({})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest dynamic modules expose their registration factory on the decorated class.
export class EconomyModule {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Module registration passes the original Drizzle table metadata into DI.
  public static register(tables: EconomyTables): DynamicModule {
    return {
      module: EconomyModule,
      controllers: [EconomyController],
      providers: [EconomyService, { provide: ECONOMY_TABLES, useValue: tables }],
      exports: [EconomyService],
    };
  }
}
