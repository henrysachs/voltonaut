import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";

import { ACCOUNTS_TABLES } from "./accounts.schema.js";
import type { AccountsTables } from "./accounts.schema.js";
import { AccountsController } from "./accounts.controller.js";
import { AccountsService } from "./accounts.service.js";

@Module({})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest dynamic modules expose their registration factory on the decorated class.
export class AccountsModule {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Module registration passes the original Drizzle table metadata into DI.
  public static register(tables: AccountsTables): DynamicModule {
    return {
      module: AccountsModule,
      controllers: [AccountsController],
      providers: [AccountsService, { provide: ACCOUNTS_TABLES, useValue: tables }],
    };
  }
}
