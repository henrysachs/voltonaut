import { DEFAULT_RIDER_PROFILE, type CompletedLocalRide } from "@voltonaut/shared";

export const localRide: CompletedLocalRide = {
  schemaVersion: 1,
  rideId: "550e8400-e29b-41d4-a716-446655440000",
  startedAt: "2026-11-20T12:00:00.000Z",
  metadata: {
    source: "sim",
    routeId: "route<&>\"'",
    routeRevision: "1",
    physicsClockScale: 1,
    profile: DEFAULT_RIDER_PROFILE,
  },
  samples: [
    { elapsedMs: 0, distanceM: 0, powerW: 0, cadenceRpm: 0, gap: false },
    {
      elapsedMs: 1500,
      distanceM: 12.345,
      powerW: 199.6,
      cadenceRpm: 88.6,
      hrBpm: 120.5,
      gap: false,
    },
    { elapsedMs: 6000, distanceM: 20, gap: true },
  ],
};
