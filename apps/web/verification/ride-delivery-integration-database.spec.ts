/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  RecordingV2Schema,
  RideAssessmentSchema,
  projectRecordingTrack,
  serializeRideTcx,
} from "@voltonaut/shared";
import { z } from "../../../packages/shared/node_modules/zod/index.js";

const RideRowSchema = z.object({
  payload_json: z.string(),
  payload_hash: z.string(),
  assessment_json: z.string(),
  export_tcx: z.string(),
  export_hash: z.string(),
  export_version: z.literal("tcx-1"),
});

export async function verifyDatabase(options: {
  readonly artifacts: string;
  readonly database: string;
  readonly uploads: readonly { readonly tcx: string }[];
}): Promise<void> {
  const captures = await capturedFiles(options.artifacts);
  const db = new DatabaseSync(options.database, { readOnly: true });

  try {
    const evidence = captures.map((capture) => {
      const recording = RecordingV2Schema.parse(JSON.parse(capture));

      const row = RideRowSchema.parse(
        db
          .prepare(
            "SELECT payload_json, payload_hash, assessment_json, export_tcx, export_hash, export_version FROM rides WHERE id = ?",
          )
          .get(recording.rideId),
      );

      assert.deepEqual(JSON.parse(row.payload_json), recording);
      assert.equal(row.payload_hash, createHash("sha256").update(row.payload_json).digest("hex"));
      const assessment = RideAssessmentSchema.parse(JSON.parse(row.assessment_json));

      assert.equal(assessment.status, "replayed");
      const tcx = serializeRideTcx(projectRecordingTrack(recording));

      assert.equal(row.export_tcx, tcx);
      assert.equal(row.export_hash, createHash("sha256").update(tcx).digest("hex"));
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

async function capturedFiles(artifacts: string): Promise<readonly string[]> {
  const files = await readdir(artifacts);

  return Promise.all(
    files.flatMap((file) =>
      /^capture-[a-f0-9-]{36}\.json$/u.test(file) ? [readFile(join(artifacts, file), "utf8")] : [],
    ),
  );
}
