import { createHash } from "node:crypto";
import { CompletedLocalRideSchema, type CompletedLocalRide } from "@voltonaut/shared";
import type { ServerConfig } from "../config.js";
import { seedOwners, upgradeFrom, type SeedDatabase } from "./migration-harness.spec.js";
import { recording } from "./recording.spec.js";

interface LegacyCopy {
  readonly ride: CompletedLocalRide;
  readonly payload: string;
  readonly hash: string;
  readonly receipt: string;
  readonly token: string;
}

function insertLegacy(db: SeedDatabase, old: LegacyCopy, nowMs: number): void {
  seedOwners(db, [{ id: "old-owner", email: "upgrade@example.com", createdAt: nowMs }]);
  db.$client
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      createHash("sha256").update(old.token).digest("hex"),
      "old-owner",
      nowMs,
      nowMs,
      nowMs + 60000,
    );
  db.$client
    .prepare(
      "INSERT INTO rides (id, user_id, payload_json, payload_hash, receipt_json, assessment_json, started_at, uploaded_at, duration_ms, distance_m, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      old.ride.rideId,
      "old-owner",
      old.payload,
      old.hash,
      old.receipt,
      JSON.stringify({ status: "unverified", reason: "legacy_missing_replay" }),
      old.ride.startedAt,
      nowMs,
      1000,
      5,
      "sim",
    );
}

/** A real SQLite file at 0003 holding one legacy ride and its owner's session. */
export function legacyDatabase(): LegacyCopy & { readonly headConfig: ServerConfig } {
  const ride = CompletedLocalRideSchema.parse(recording());
  const payload = JSON.stringify(ride);
  const hash = createHash("sha256").update(payload).digest("hex");

  const receipt = JSON.stringify({
    rideId: ride.rideId,
    storage: "stored",
    assessment: { status: "unverified", reason: "legacy_missing_replay" },
  });

  const old = { ride, payload, hash, receipt, token: "temporary-upgrade-session" };

  const upgrade = upgradeFrom("0003_strava_connection", (db) => {
    insertLegacy(db, old, Date.now());
  });

  return { ...old, headConfig: upgrade.headConfig };
}
