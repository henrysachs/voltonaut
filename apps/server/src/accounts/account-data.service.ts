/* oxlint-disable import/max-dependencies -- Account export and deletion run one transaction across every user-data owner port. */
import { Inject, Injectable } from "@nestjs/common";

import {
  AccountDeletionResponseSchema,
  AccountExportSchema,
  type AccountDeletionResponse,
  type AccountExport,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { AuthAccountDataService } from "../auth/auth-account-data.service.js";
import { DRIZZLE, type ServerDatabase } from "../database/drizzle.provider.js";
import { EconomyAccountDataService } from "../economy/economy.account-data.js";
import { InventoryAccountDataService } from "../inventory/inventory.account-data.js";
import { ProgressAccountDataService } from "../progress/progress.account-data.js";
import { RidesService } from "../rides/rides.service.js";
import { StravaAccountDataService } from "../strava/strava.account-data-service.js";
import { AccountsService } from "./accounts.service.js";

@Injectable()
export class AccountDataService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    @Inject(AccountsService) private readonly accounts: Readonly<AccountsService>,
    @Inject(AuthAccountDataService)
    private readonly authData: Readonly<AuthAccountDataService>,
    @Inject(RidesService) private readonly rides: Readonly<
      Pick<RidesService, "exportOwn" | "deleteOwn">
    >,
    @Inject(StravaAccountDataService)
    private readonly strava: Readonly<StravaAccountDataService>,
    @Inject(EconomyAccountDataService)
    private readonly economy: Readonly<EconomyAccountDataService>,
    @Inject(InventoryAccountDataService)
    private readonly inventory: Readonly<InventoryAccountDataService>,
    @Inject(ProgressAccountDataService)
    private readonly progress: Readonly<ProgressAccountDataService>,
  ) {}

  public exportData(userId: string, nowMs: number): AccountExport {
    return this.db.transaction(
      () => {
        const user = this.authData.currentUser(userId);
        const status = this.accounts.status(userId);

        return AccountExportSchema.parse({
          schemaVersion: 4,
          exportedAt: new Date(nowMs).toISOString(),
          account: {
            user,
            membership: status.membership,
            authorization: status.authorization,
            identities: this.authData.exportOwn(userId),
          },
          profile: this.accounts.getProfile(userId),
          rides: this.rides.exportOwn(userId),
          inventory: this.inventory.exportOwn(userId),
          progression: {
            volts: this.economy.exportOwn(userId),
            progress: this.progress.exportOwn(userId),
          },
          strava: this.strava.exportOwn(userId),
        });
      },
      { behavior: "deferred" },
    );
  }

  /**
   * Checks the confirmation, revokes Strava while its tokens still exist, then deletes (issue #140).
   * A wrong confirmation therefore never disconnects Strava.
   */
  public async deleteAccountAfterRevocation(
    userId: string,
    confirmation: string,
    nowMs: number,
  ): Promise<AccountDeletionResponse> {
    this.assertConfirmed(userId, confirmation);

    const stravaRevocation = await this.strava.revokeBeforeDeletion(userId);

    this.deleteAccount(userId, confirmation, nowMs);

    return AccountDeletionResponseSchema.parse({ stravaRevocation });
  }

  private assertConfirmed(userId: string, confirmation: string): void {
    if (confirmation !== this.authData.currentUser(userId).email)
      throw new ApiError(403, "forbidden", "deletion confirmation does not match this account");
  }

  public deleteAccount(userId: string, confirmation: string, nowMs: number): void {
    this.db.transaction(
      () => {
        this.assertConfirmed(userId, confirmation);
        this.rides.deleteOwn(userId);
        this.strava.deleteOwn(userId);
        this.inventory.deleteOwn(userId);
        this.progress.deleteOwn(userId);
        this.economy.deleteOwn(userId);
        this.accounts.deleteOwn(userId);
        this.authData.deleteAccount(userId, nowMs);
      },
      { behavior: "immediate" },
    );
  }
}
