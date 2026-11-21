/// <reference types="node" />
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "../../packages/shared/node_modules/zod/index.js";
import { sha256 } from "./artifact.mjs";

const DeliveryRowSchema = z.object({
  ride_id: z.string(),
  user_id: z.string(),
  authority: z.string(),
  progress: z.string(),
});

const RideRowSchema = z.object({
  payload_json: z.string(),
  payload_hash: z.string(),
  assessment_json: z.string(),
  export_tcx: z.string(),
  export_hash: z.string(),
  export_version: z.literal("tcx-1"),
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

/** @param {{readonly artifacts: string; readonly database: string; readonly uploads: readonly { readonly tcx: string }[]}} options */
export async function verifyDatabase(options) {
  const shared = await import("../../packages/shared/dist/index.js");
  const captures = await capturedFiles(options.artifacts);

  const db = new DatabaseSync(options.database, { readOnly: true });

  try {
    const evidence = captures.map((capture) => {
      const recording = shared.RecordingV2Schema.parse(JSON.parse(capture));

      const row = RideRowSchema.parse(
        db
          .prepare(
            "SELECT payload_json, payload_hash, assessment_json, export_tcx, export_hash, export_version FROM rides WHERE id = ?",
          )
          .get(recording.rideId),
      );

      assert.deepEqual(JSON.parse(row.payload_json), recording);
      assert.equal(row.payload_hash, sha256(row.payload_json));
      const assessment = shared.RideAssessmentSchema.parse(JSON.parse(row.assessment_json));

      assert.equal(assessment.status, "replayed");
      const tcx = shared.serializeRideTcx(shared.projectRecordingTrack(recording));

      assert.equal(row.export_tcx, tcx);
      assert.equal(row.export_hash, sha256(tcx));
      const uploaded = options.uploads.filter((upload) => upload.tcx === tcx);

      assert.ok(uploaded.length <= 1, "Fake does not deduplicate repeated POSTs");

      return {
        rideId: recording.rideId,
        payloadHash: row.payload_hash,
        exportHash: row.export_hash,
        assessment,
        providerPosts: uploaded.length,
      };
    });

    await writeFile(
      join(options.artifacts, "database-proof.json"),
      JSON.stringify(evidence, null, 2),
    );
  } finally {
    db.close();
  }
}

/** @param {string} artifacts */
async function capturedFiles(artifacts) {
  const files = await readdir(artifacts);

  return Promise.all(
    files.flatMap((file) =>
      /^capture-[a-f0-9-]{36}\.json$/u.test(file) ? [readFile(join(artifacts, file), "utf8")] : [],
    ),
  );
}
