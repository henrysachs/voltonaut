import request from "supertest";
import { expect, it } from "vitest";
import {
  RideDetailSchema,
  RideListSchema,
  RideReceiptSchema,
  type RecordingEntryV2,
} from "@voltonaut/shared";
import { TEST_LOOP } from "@voltonaut/engine";

import { warmupReplay, recordReplay, replayed } from "../testing/replay.spec.js";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";

it("admits a raw warmup journal, persists an immutable server assessment and removes v1", async () => {
  const test = await createTestApp();

  try {
    const owner = await loginTestUser(test.app, test.mail, "journal@example.com");
    const server = httpServerOf(test.app);
    const ride = warmupReplay();
    const post = () => request(server).post("/v2/rides").set(bearer(owner.sessionToken));
    const response = await post().send(ride).expect(200);
    const receipt = RideReceiptSchema.parse(bodyOf(response));
    expect(receipt.assessment).toMatchObject({
      status: "replayed",
      source: { assurance: "client_declared", window: { kind: "continuous" } },
    });
    expect(bodyOf(await post().send(ride).expect(200))).toEqual(receipt);

    const detail = await request(server)
      .get(`/v2/rides/${ride.rideId}`)
      .set(bearer(owner.sessionToken))
      .expect(200);

    expect(RideDetailSchema.parse(bodyOf(detail))).toEqual({
      recording: ride,
      assessment: receipt.assessment,
    });
    const list = await request(server).get("/v2/rides").set(bearer(owner.sessionToken)).expect(200);
    expect(RideListSchema.parse(bodyOf(list)).rides[0]).toMatchObject({
      durationMs: 1000,
      assessment: receipt.assessment,
    });
    expect(
      getDatabase(test.app)
        .$client.prepare("SELECT export_version FROM rides WHERE id = ?")
        .get(ride.rideId),
    ).toEqual({ export_version: "tcx-1" });
    await post()
      .send({ ...ride, hardwareAttested: true })
      .expect(422);
    await request(server).post("/v1/rides").set(bearer(owner.sessionToken)).send(ride).expect(404);
  } finally {
    await test.app.close();
  }
});

function lapJournal() {
  const entries: RecordingEntryV2[] = [
    [0, 0, "arm"],
    [1, 0, "status", "trainer", "ready"],
    [2, 0, "trainer", 2000, 90, null],
    [3, 0, "boundary", "start"],
  ];

  for (let second = 0; second < 480; second += 1) {
    entries.push(
      [entries.length, second * 1000, "trainer", 2000, 90, null],
      [entries.length + 1, (second + 1) * 1000, "advance", 1],
      [entries.length + 2, (second + 1) * 1000, "boundary", second === 479 ? "finish" : "sample"],
    );
  }

  return recordReplay(entries);
}

it("keeps full 20Hz route/lap outputs through the real HTTP admission", async () => {
  const test = await createTestApp();

  try {
    const owner = await loginTestUser(test.app, test.mail, "lap@example.com");
    const ride = lapJournal();

    const response = await request(httpServerOf(test.app))
      .post("/v2/rides")
      .set(bearer(owner.sessionToken))
      .send(ride)
      .expect(200);

    const expectedAssessment = replayed(ride);

    expect(RideReceiptSchema.parse(bodyOf(response)).assessment).toEqual(expectedAssessment);
    expect(expectedAssessment.summary.distanceM).toBeGreaterThan(TEST_LOOP.lengthM);
    expect(expectedAssessment.summary.laps).toBe(1);
    expect(expectedAssessment.source.window).toEqual({ kind: "continuous" });
  } finally {
    await test.app.close();
  }
});
