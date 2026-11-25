import { encryptTokens } from "../strava/strava.crypto.js";
import { seedOwners, type SeedDatabase } from "../testing/migration-harness.spec.js";

/** The last migration before `0005_strava_delivery` gave connections generations and revisions. */
export const BEFORE_STRAVA_DELIVERY = "0004_replayed_ride_exports";

/** Seeds two encrypted Strava connections into a database at `BEFORE_STRAVA_DELIVERY`. */
export function seedLegacyStrava(
  db: SeedDatabase,
  key: string,
  tokens: Parameters<typeof encryptTokens>[0],
) {
  seedOwners(db, [
    { id: "first", email: "first@example.test", createdAt: 123 },
    { id: "second", email: "second@example.test", createdAt: 123 },
  ]);

  for (const { userId, athleteId } of [
    { userId: "first", athleteId: "41" },
    { userId: "second", athleteId: "42" },
  ]) {
    db.$client
      .prepare(
        "INSERT INTO strava_connections(user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope) VALUES (?,?,'connected',?,999999,'activity:write')",
      )
      .run(userId, athleteId, encryptTokens(tokens, key, userId, athleteId));
  }

  return db.$client.prepare("SELECT * FROM strava_connections ORDER BY user_id").all();
}
