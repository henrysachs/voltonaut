import { randomUUID, createHash } from "node:crypto";
import { expect, it } from "vitest";
import request from "supertest";
import {
  DEFAULT_RIDER_PROFILE,
  RideReceiptSchema,
  type RecordingV2,
  type RideAssessment,
} from "@voltonaut/shared";

import { warmupReplay, recordReplay } from "../testing/replay.spec.js";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import { RidesService, type OwnStravaSource } from "./rides.service.js";

function readySource(
  source: OwnStravaSource,
): Extract<OwnStravaSource, { readonly kind: "ready" }> {
  if (source.kind !== "ready") throw new Error("Expected declared source");

  return source;
}

function changedDistance(ride: RecordingV2, distanceM: number): RecordingV2 {
  return {
    ...ride,
    observations: ride.observations.map((observation, index) => {
      if (index !== ride.observations.length - 1) return observation;

      return { ...observation, snapshot: { ...observation.snapshot, distanceM } };
    }),
  };
}

function verifyTcxSource(source: Extract<OwnStravaSource, { readonly kind: "ready" }>): void {
  expect(source.exportHash).toBe(createHash("sha256").update(source.tcx).digest("hex"));
  expect(source.tcx).toContain("2026-11-20T12:00:01.000Z");
  expect(source.tcx).toContain("<TotalTimeSeconds>1</TotalTimeSeconds>");
  expect(source.tcx).toContain("<ax:Watts>300</ax:Watts>");
  expect(source.tcx).not.toContain("<ax:Watts>250</ax:Watts>");
  expect(source.tcx).not.toMatch(/Position|Latitude|Longitude/u);
  expect(source).toMatchObject({
    assurance: "client_declared",
    policy: "declared_ble_v1",
    exportVersion: "tcx-1",
  });
}

function unverifiedRecordings(base: RecordingV2): readonly RecordingV2[] {
  return [
    { ...base, rideId: randomUUID(), journalState: "incomplete" },
    {
      ...base,
      rideId: randomUUID(),
      initialization: { ...base.initialization, physicsRevision: "engine-next" },
    },
    { ...changedDistance(base, 100), rideId: randomUUID() },
  ];
}

function failedAssessmentReason(assessment: RideAssessment): string {
  if (assessment.status === "replayed") throw new Error("Expected rejected or unverified");

  return assessment.reason;
}

it("serves only owned immutable export bytes under explicit declared BLE policy", async () => {
  const test = await createTestApp({ config: { rideSourcePolicy: "declared_ble_v1" } });

  try {
    const alice = await loginTestUser(test.app, test.mail, "source@example.com");
    const server = httpServerOf(test.app);
    const ride = warmupReplay();
    await request(server)
      .put("/v1/me/profile")
      .set(bearer(alice.sessionToken))
      .send({ ...DEFAULT_RIDER_PROFILE, massKg: 99 })
      .expect(200);

    const response = await request(server)
      .post("/v2/rides")
      .set(bearer(alice.sessionToken))
      .send(ride)
      .expect(200);

    const receipt = RideReceiptSchema.parse(bodyOf(response));
    expect(receipt.assessment.status).toBe("replayed");
    const service = test.app.get<RidesService>(RidesService);
    const source = readySource(service.loadOwnStravaSource(alice.user.id, ride.rideId));
    expect(source.kind).toBe("ready");

    verifyTcxSource(source);

    const before = getDatabase(test.app)
      .$client.prepare("SELECT * FROM rides WHERE id = ?")
      .get(ride.rideId);

    await request(server).post("/v2/rides").set(bearer(alice.sessionToken)).send(ride).expect(200);
    expect(service.loadOwnStravaSource(alice.user.id, ride.rideId)).toEqual(source);
    expect(
      getDatabase(test.app).$client.prepare("SELECT * FROM rides WHERE id = ?").get(ride.rideId),
    ).toEqual(before);
    expect(() => service.loadOwnStravaSource("foreign", ride.rideId)).toThrow("ride not found");
    expect(() => service.loadOwnStravaSource(alice.user.id, randomUUID())).toThrow(
      "ride not found",
    );
  } finally {
    await test.app.close();
  }
});

it("defaults source export policy off independently of connection settings", async () => {
  const test = await createTestApp();

  try {
    const owner = await loginTestUser(test.app, test.mail, "policy@example.com");
    const ride = warmupReplay();
    const service = test.app.get<RidesService>(RidesService);
    const receipt = service.store(owner.user.id, ride, Date.now());
    expect(receipt.assessment.status).toBe("replayed");
    expect(service.loadOwnStravaSource(owner.user.id, ride.rideId)).toEqual({
      kind: "blocked",
      reason: "policy_disabled",
    });
  } finally {
    await test.app.close();
  }
});

it.each([1, 20])(
  "blocks declared simulation at scale %s without changing replay consistency",
  async (scale) => {
    const test = await createTestApp({ config: { rideSourcePolicy: "declared_ble_v1" } });

    try {
      const owner = await loginTestUser(test.app, test.mail, "sim-source@example.com");

      const original = recordReplay(
        [
          [0, 0, "arm"],
          [1, 0, "status", "trainer", "ready"],
          [2, 0, "trainer", 250, 90, null],
          [3, 0, "boundary", "start"],
          [4, 1000, "advance", 1],
          [5, 1000, "boundary", "finish"],
        ],
        scale,
      );

      const ride: RecordingV2 = {
        ...original,
        initialization: { ...original.initialization, source: "sim" },
      };

      const service = test.app.get<RidesService>(RidesService);

      expect(service.store(owner.user.id, ride, Date.now()).assessment.status).toBe("replayed");
      expect(service.loadOwnStravaSource(owner.user.id, ride.rideId)).toEqual({
        kind: "blocked",
        reason: "window_blocked",
      });
    } finally {
      await test.app.close();
    }
  },
);

it("stores honest rejected/unverified assessments without any export", async () => {
  const test = await createTestApp({ config: { rideSourcePolicy: "declared_ble_v1" } });

  try {
    const owner = await loginTestUser(test.app, test.mail, "unverified@example.com");
    const server = httpServerOf(test.app);
    const base = warmupReplay();

    const service = test.app.get<RidesService>(RidesService);

    await Promise.all(
      unverifiedRecordings(base).map(async (ride) => {
        const response = await request(server)
          .post("/v2/rides")
          .set(bearer(owner.sessionToken))
          .send(ride)
          .expect(200);

        const receipt = RideReceiptSchema.parse(bodyOf(response));
        expect(receipt.assessment.status).not.toBe("replayed");
        expect(service.loadOwnStravaSource(owner.user.id, ride.rideId)).toEqual({
          kind: "blocked",
          reason: failedAssessmentReason(receipt.assessment),
        });
        expect(
          getDatabase(test.app)
            .$client.prepare(
              "SELECT export_tcx, export_hash, export_version, summary_json FROM rides WHERE id = ?",
            )
            .get(ride.rideId),
        ).toEqual({
          export_tcx: null,
          export_hash: null,
          export_version: null,
          summary_json: null,
        });
      }),
    );
  } finally {
    await test.app.close();
  }
});

it("fails closed with 422 when an otherwise parsed journal has no safe bounded projection", async () => {
  const test = await createTestApp();

  try {
    const owner = await loginTestUser(test.app, test.mail, "unsafe@example.com");
    const ride = warmupReplay();
    const unsafe = changedDistance(ride, 0);

    await request(httpServerOf(test.app))
      .post("/v2/rides")
      .set(bearer(owner.sessionToken))
      .send(unsafe)
      .expect(422);
    expect(
      getDatabase(test.app).$client.prepare("SELECT count(*) AS total FROM rides").get(),
    ).toEqual({ total: 0 });
  } finally {
    await test.app.close();
  }
});
