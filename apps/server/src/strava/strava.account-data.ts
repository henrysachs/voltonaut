import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";

import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { parseDelivery } from "./strava.delivery-state.js";
import type { OwnedDelivery } from "./strava.delivery-state.js";
import { STRAVA_TABLES } from "./strava.schema.js";
import type { StravaTables } from "./strava.schema.js";

@Injectable()
export class StravaAccountDataStore {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle metadata passes unchanged through DI.
    @Inject(STRAVA_TABLES) private readonly tables: StravaTables,
  ) {}

  public listDeliveries(userId: string): readonly OwnedDelivery[] {
    return this.db
      .select()
      .from(this.tables.deliveries)
      .where(eq(this.tables.deliveries.userId, userId))
      .orderBy(asc(this.tables.deliveries.rideId))
      .all()
      .map((row) => parseDelivery(row));
  }

  public deleteOwn(userId: string): void {
    this.db.transaction(
      () => {
        this.db
          .delete(this.tables.deliveries)
          .where(eq(this.tables.deliveries.userId, userId))
          .run();
      },
      { behavior: "immediate" },
    );
  }
}
