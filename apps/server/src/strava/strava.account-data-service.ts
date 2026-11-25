import { Inject, Injectable } from "@nestjs/common";
import type { AccountExport } from "@voltonaut/shared";
import { StravaAccountDataStore } from "./strava.account-data.js";
import { StravaService } from "./strava.service.js";
import { StravaStore } from "./strava.store.js";

export { StravaAccountDataStore } from "./strava.account-data.js";

@Injectable()
export class StravaAccountDataService {
  public constructor(
    @Inject(StravaStore) private readonly store: Readonly<StravaStore>,
    @Inject(StravaAccountDataStore) private readonly data: Readonly<StravaAccountDataStore>,
    @Inject(StravaService) private readonly connection: Readonly<Pick<StravaService, "status">>,
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

  public deleteOwn(userId: string): void {
    this.store.deleteOwn(userId);
    this.data.deleteOwn(userId);
  }
}
