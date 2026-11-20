import { expect, it } from "vitest";

import { CompletedLocalRideSchema, MAX_LOCAL_RIDE_MS, type LocalRidePoint } from "./localRide.js";
import { DEFAULT_RIDER_PROFILE } from "./profile.js";

const record = {
  schemaVersion: 1,
  rideId: "550e8400-e29b-41d4-a716-446655440000",
  startedAt: "2026-11-20T12:00:00.000Z",
  metadata: {
    source: "sim",
    routeId: "test-loop",
    routeRevision: "1",
    physicsClockScale: 20,
    profile: DEFAULT_RIDER_PROFILE,
  },
  samples: [
    { elapsedMs: 0, distanceM: 0, powerW: 0, cadenceRpm: 0, gap: false },
    { elapsedMs: 1000, distanceM: 10, gap: true },
  ],
};

it("preserves absent readings and real zero, independent of the physics clock", () => {
  const ride = CompletedLocalRideSchema.parse(record);
  expect(ride.samples[0]?.powerW).toBe(0);
  expect(ride.samples[1]?.powerW).toBeUndefined();
  expect(ride.metadata.physicsClockScale).toBe(20);
});

it("keeps existing local V1 files compatible without rewriting UUID case", () => {
  const rideId = record.rideId.toUpperCase();

  expect(CompletedLocalRideSchema.parse({ ...record, rideId }).rideId).toBe(rideId);
});

it.each([
  [],
  [{ elapsedMs: 0, distanceM: 0, gap: true }],
  [
    { elapsedMs: 0, distanceM: 0, gap: true },
    { elapsedMs: 1000, distanceM: 0, gap: true },
  ],
  [
    { elapsedMs: 1, distanceM: 0, powerW: 1, gap: false },
    { elapsedMs: 1000, distanceM: 0, gap: true },
  ],
  [
    { elapsedMs: 0, distanceM: 1, powerW: 1, gap: false },
    { elapsedMs: 1000, distanceM: 2, gap: true },
  ],
  [
    { elapsedMs: 0, distanceM: 0, powerW: 1, gap: false },
    { elapsedMs: 0, distanceM: 2, gap: true },
  ],
  [
    { elapsedMs: 0, distanceM: 0, powerW: 1, gap: false },
    { elapsedMs: 500, distanceM: 2, gap: true },
  ],
  [
    { elapsedMs: 0, distanceM: 0, powerW: 1, gap: false },
    { elapsedMs: 1000, distanceM: 2, gap: true },
    { elapsedMs: 2000, distanceM: 1, gap: true },
  ],
  [
    { elapsedMs: 0, distanceM: 0, powerW: 1, gap: false },
    { elapsedMs: 5000, distanceM: 2, gap: false },
  ],
  [
    { elapsedMs: 0, distanceM: 0, powerW: 1, gap: false },
    { elapsedMs: MAX_LOCAL_RIDE_MS + 1, distanceM: 2, gap: true },
  ],
])("rejects incomplete or inconsistent samples %#", (...samples: readonly LocalRidePoint[]) => {
  expect(CompletedLocalRideSchema.safeParse({ ...record, samples }).success).toBe(false);
});

it("accepts marked gaps and cadence-only readings, but rejects unsafe boundary values", () => {
  const samples = [
    { elapsedMs: 0, distanceM: 0, cadenceRpm: 0, gap: true },
    { elapsedMs: 5000, distanceM: 2, gap: true },
  ];

  expect(CompletedLocalRideSchema.safeParse({ ...record, samples }).success).toBe(true);

  for (const patch of [
    { rideId: "bad" },
    { schemaVersion: 2 },
    { startedAt: "yesterday" },
    { metadata: { ...record.metadata, routeId: "bad\u0000" } },
    { samples: [{ elapsedMs: 0, distanceM: Number.NaN, gap: false }] },
  ]) {
    expect(CompletedLocalRideSchema.safeParse({ ...record, ...patch }).success).toBe(false);
  }
});
