import { createHash } from "node:crypto";

import request from "supertest";
import { expect, it } from "vitest";
import { RideDetailSchema, RideReceiptSchema, type RecordingV2 } from "@voltonaut/shared";

import { TEST_LOOP_ROUTE, TEST_LOOP_WORLD_PATH, warmupReplay } from "../testing/replay.spec.js";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";

const STORED_COLUMNS =
  "SELECT payload_json, payload_hash, receipt_json, assessment_json, export_tcx FROM rides WHERE id = ?";

interface StoredRide {
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly receipt_json: string;
  readonly assessment_json: string;
  readonly export_tcx: string;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Test database handles expose mutable SQLite state.
function storedRide(db: ReturnType<typeof getDatabase>, rideId: string): StoredRide {
  const stored = db.$client.prepare<[string], StoredRide>(STORED_COLUMNS).get(rideId);

  if (stored === undefined) throw new Error(`test: ride ${rideId} was not stored`);

  return stored;
}

interface Admission {
  readonly assessmentKeys: readonly string[];
  readonly exportTcx: string;
}

/** Uploads twice and checks storage and detail; returns what differs between both forms. */
async function admitTwice(ride: RecordingV2): Promise<Admission> {
  const test = await createTestApp();

  try {
    const owner = await loginTestUser(test.app, test.mail, "world@example.com");
    const server = httpServerOf(test.app);
    const post = () => request(server).post("/v2/rides").set(bearer(owner.sessionToken));
    const receipt = RideReceiptSchema.parse(bodyOf(await post().send(ride).expect(200)));

    expect(bodyOf(await post().send(ride).expect(200))).toEqual(receipt);

    const stored = storedRide(getDatabase(test.app), ride.rideId);

    // The canonical payload keeps the reference where routeId/routeRevision always stood.
    expect(stored.payload_json).toBe(JSON.stringify(ride));
    expect(stored.payload_hash).toBe(
      createHash("sha256").update(JSON.stringify(ride)).digest("hex"),
    );
    expect(JSON.parse(stored.assessment_json)).toEqual(receipt.assessment);

    const detail = await request(server)
      .get(`/v2/rides/${ride.rideId}`)
      .set(bearer(owner.sessionToken))
      .expect(200);

    expect(RideDetailSchema.parse(bodyOf(detail))).toEqual({
      recording: ride,
      assessment: receipt.assessment,
    });

    return { assessmentKeys: Object.keys(receipt.assessment), exportTcx: stored.export_tcx };
  } finally {
    await test.app.close();
  }
}

it("admits a world path journal with the world path replay revision", async () => {
  const admission = await admitTwice(warmupReplay(TEST_LOOP_WORLD_PATH));

  expect(admission.assessmentKeys).toEqual([
    "status",
    "physicsRevision",
    "replayRevision",
    "summary",
    "source",
  ]);
  expect(admission.exportTcx).toContain("World test-loop, revision 1, path test-loop.");
});

it("admits a stored single-route journal unchanged, without a replay revision", async () => {
  const admission = await admitTwice(warmupReplay(TEST_LOOP_ROUTE));

  expect(admission.assessmentKeys).toEqual(["status", "physicsRevision", "summary", "source"]);
  expect(admission.exportTcx).toContain("Route test-loop, revision 1.");
});
