import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { expect, it } from "vitest";
import { RideReceiptSchema } from "@voltonaut/shared";
import { createTestApp, getDatabase, httpServerOf } from "../testing/test-app.spec.js";
import { legacyDatabase } from "../testing/replay-upgrade.spec.js";

it("upgrades real 0000-0003 SQLite without rewriting legacy payload, hashes or receipt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "replayed-upgrade-"));

  try {
    const old = legacyDatabase(directory);

    const test = await createTestApp({
      config: { database: { path: old.path, migrationsDir: "drizzle" } },
    });

    try {
      const response = await request(httpServerOf(test.app))
        .post("/v2/rides")
        .set("Authorization", `Bearer ${old.token}`)
        .send(old.ride)
        .expect(200);

      expect(JSON.stringify(RideReceiptSchema.parse(JSON.parse(response.text)))).toBe(old.receipt);
      expect(
        getDatabase(test.app)
          .$client.prepare(
            "SELECT payload_json, payload_hash, receipt_json, export_tcx, export_hash, export_version, summary_json FROM rides",
          )
          .get(),
      ).toEqual({
        payload_json: old.payload,
        payload_hash: old.hash,
        receipt_json: old.receipt,
        export_tcx: null,
        export_hash: null,
        export_version: null,
        summary_json: null,
      });
    } finally {
      await test.app.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
