import { CompletedLocalRideSchema, type CompletedLocalRide } from "@voltonaut/shared";

export interface RideDatabase {
  readonly list: () => Promise<readonly CompletedLocalRide[]>;
  /** Atomic insert, with capacity and immutable-ID checks inside the database transaction. */
  readonly insert: (ride: CompletedLocalRide) => Promise<void>;
}

export interface RideStore {
  readonly list: () => Promise<readonly CompletedLocalRide[]>;
  readonly save: (ride: CompletedLocalRide) => Promise<void>;
}

export function createRideStore(database: RideDatabase): RideStore {
  return {
    list: () => database.list(),
    async save(ride) {
      const parsed = CompletedLocalRideSchema.safeParse(ride);

      if (!parsed.success) {
        throw new Error("Aufnahme ungültig. Nicht gespeichert.");
      }

      await database.insert(parsed.data);
    },
  };
}
