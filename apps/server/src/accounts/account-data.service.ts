import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { AccountExportSchema, type AccountExport } from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { AuthAccountDataService } from "../auth/auth-account-data.service.js";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { RidesService } from "../rides/rides.service.js";
import { StravaAccountDataService } from "../strava/strava.account-data-service.js";
import { AccountsService } from "./accounts.service.js";
import { ACCOUNTS_TABLES } from "./accounts.schema.js";
import type { AccountsTables } from "./accounts.schema.js";

@Injectable()
export class AccountDataService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    @Inject(ACCOUNTS_TABLES) private readonly tables: AccountsTables,
    @Inject(AccountsService) private readonly accounts: Readonly<AccountsService>,
    @Inject(AuthAccountDataService)
    private readonly authData: Readonly<AuthAccountDataService>,
    @Inject(RidesService) private readonly rides: Readonly<
      Pick<RidesService, "exportOwn" | "deleteOwn">
    >,
    @Inject(StravaAccountDataService)
    private readonly strava: Readonly<StravaAccountDataService>,
  ) {}

  public exportData(userId: string, nowMs: number): AccountExport {
    return this.db.transaction(
      () => {
        const user = this.authData.currentUser(userId);
        const status = this.accounts.status(userId);

        return AccountExportSchema.parse({
          schemaVersion: 1,
          exportedAt: new Date(nowMs).toISOString(),
          account: {
            user,
            membership: status.membership,
            authorization: status.authorization,
          },
          profile: this.accounts.getProfile(userId),
          rides: this.rides.exportOwn(userId),
          inventory: { status: "not_stored" },
          progression: { status: "not_stored" },
          strava: this.strava.exportOwn(userId),
        });
      },
      { behavior: "deferred" },
    );
  }

  public deleteAccount(userId: string, confirmation: string, nowMs: number): void {
    this.db.transaction(
      () => {
        const user = this.authData.currentUser(userId);

        if (confirmation !== user.email)
          throw new ApiError(403, "forbidden", "deletion confirmation does not match this account");

        this.rides.deleteOwn(userId);
        this.strava.deleteOwn(userId);
        this.db.delete(this.tables.profiles).where(eq(this.tables.profiles.userId, userId)).run();
        this.db
          .delete(this.tables.accountStatus)
          .where(eq(this.tables.accountStatus.userId, userId))
          .run();
        this.authData.deleteAccount(userId, nowMs);
      },
      { behavior: "immediate" },
    );
  }
}
