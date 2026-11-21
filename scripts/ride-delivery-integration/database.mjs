/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { z } from "../../packages/shared/node_modules/zod/index.js";

const DeliveryRowSchema = z.object({
  ride_id: z.string(),
  user_id: z.string(),
  authority: z.string(),
  progress: z.string(),
});

const ObservedStateSchema = z.object({ kind: z.string() }).passthrough();

/** @param {string} database */
export function databaseSnapshot(database) {
  const db = new DatabaseSync(database, { readOnly: true });

  try {
    const rows = z
      .array(DeliveryRowSchema.readonly())
      .parse(
        db.prepare("SELECT ride_id, user_id, authority, progress FROM strava_deliveries").all(),
      );

    return rows.map((row) => {
      return {
        rideId: row.ride_id,
        userId: row.user_id,
        authority: ObservedStateSchema.parse(JSON.parse(row.authority)),
        progress: ObservedStateSchema.parse(JSON.parse(row.progress)),
      };
    });
  } finally {
    db.close();
  }
}
