import { Inject, Injectable } from "@nestjs/common";
import type { AccountExport, StravaRevocationOutcome } from "@voltonaut/shared";
import { StravaAccountDataStore } from "./strava.account-data.js";
import { StravaService } from "./strava.service.js";
import { StravaStore } from "./strava.store.js";

export { StravaAccountDataStore } from "./strava.account-data.js";

@Injectable()
export class StravaAccountDataService {
  public constructor(
    @Inject(StravaStore) private readonly store: Readonly<StravaStore>,
    @Inject(StravaAccountDataStore) private readonly data: Readonly<StravaAccountDataStore>,
    @Inject(StravaService)
    private readonly connection: Readonly<Pick<StravaService, "status" | "disconnect">>,
  ) {}

  public exportOwn(userId: string): AccountExport["strava"] {
    return {
      status: this.connection.status(userId),
      deliveries: this.data.listDeliveries(userId).map((delivery) => ({
        deliveryId: delivery.deliveryId,
        rideId: delivery.rideId,
        authority: delivery.authority,
        progress: delivery.progress,
      })),
    };
  }

  /**
   * Revokes the Strava grant before the account is deleted (issue #140): afterwards the tokens are
   * gone and nothing could revoke it. Never throws; the deletion does not depend on Strava.
   */
  public async revokeBeforeDeletion(userId: string): Promise<StravaRevocationOutcome> {
    if (this.store.connection(userId) === undefined) return "not_connected";

    try {
      await this.connection.disconnect(userId);
    } catch {
      return "failed";
    }

    // A confirmed revocation removes the connection; anything left is still authorized at Strava.
    return this.store.connection(userId) === undefined ? "revoked" : "failed";
  }

  public deleteOwn(userId: string): void {
    this.store.deleteOwn(userId);
    this.data.deleteOwn(userId);
  }
}
