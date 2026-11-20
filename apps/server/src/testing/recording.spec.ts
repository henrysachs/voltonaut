import { randomUUID } from "node:crypto";

import { CompletedLocalRideSchema, DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

export function recording(rideId: string = randomUUID()) {
  return CompletedLocalRideSchema.parse({
    schemaVersion: 1,
    rideId,
    startedAt: "2026-11-20T10:00:00.000Z",
    metadata: {
      source: "sim",
      routeId: "test-loop",
      routeRevision: "1",
      physicsClockScale: 1,
      profile: DEFAULT_RIDER_PROFILE,
    },
    samples: [
      { elapsedMs: 0, distanceM: 0, powerW: 150, cadenceRpm: 80, gap: false },
      { elapsedMs: 1000, distanceM: 5, powerW: 150, cadenceRpm: 80, gap: false },
    ],
  });
}
