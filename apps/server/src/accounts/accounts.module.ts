import { Module, type DynamicModule } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";

import { ACCOUNTS_TABLES, type AccountsTables } from "./accounts.schema.js";
import { AccountsController } from "./accounts.controller.js";
import { AccountDataService } from "./account-data.service.js";
import { AccountsService } from "./accounts.service.js";
import { AdminUsersController } from "./admin-users.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminOriginGuard } from "./admin-origin.guard.js";
import { AuthDirectory } from "../auth/auth-directory.js";

@Module({})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest dynamic modules expose their registration factory on the decorated class.
export class AccountsModule {
  /* oxlint-disable typescript/prefer-readonly-parameter-types -- Nest dynamic modules require their original mutable provider metadata. */
  public static register(
    tables: Readonly<AccountsTables>,
    rides: Readonly<DynamicModule>,
    strava: Readonly<DynamicModule>,
    economy: Readonly<DynamicModule>,
  ): DynamicModule {
    return {
      module: AccountsModule,
      imports: [AuthModule, rides, strava, economy],
      controllers: [AccountsController, AdminUsersController],
      providers: [
        AccountsService,
        AccountDataService,
        AuthDirectory,
        AdminGuard,
        AdminOriginGuard,
        { provide: ACCOUNTS_TABLES, useValue: tables },
      ],
    };
  }
  /* oxlint-enable typescript/prefer-readonly-parameter-types */
}
