import type { RideSnapshot } from "@voltonaut/engine";
import { createRoute, TEST_ROUTES } from "@voltonaut/engine";
import type { DeviceEvent, LocalRideMetadata } from "@voltonaut/shared";

import { setupRideRecording } from "./rideRecording.js";
import { startRideScene } from "./world/scene.js";

interface RidePresentationOptions {
  readonly snapshot: () => Readonly<RideSnapshot> | undefined;
  readonly profile: LocalRideMetadata["profile"];
  readonly source: LocalRideMetadata["source"];
  readonly routeId: string;
  readonly clockScale: number;
  readonly sceneHost: Readonly<Element> | null;
  readonly debug: boolean;
}

export function setupRidePresentation(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM hosts retain native mutable members; the renderer owns their children.
  options: Readonly<RidePresentationOptions>,
): (event: DeviceEvent) => void {
  const recordEvent = setupRideRecording({
    nowMs: () => performance.now(),
    utcNow: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    metadata: {
      source: options.source,
      routeId: options.routeId,
      routeRevision: "1",
      physicsClockScale: options.clockScale,
      profile: options.profile,
    },
    distanceM: () => options.snapshot()?.distanceM,
  });

  const routeData = TEST_ROUTES[options.routeId];

  if (options.sceneHost instanceof HTMLElement && routeData !== undefined) {
    startRideScene({
      host: options.sceneHost,
      route: createRoute(routeData),
      snapshot: options.snapshot,
      wheelCircM: options.profile.bike.wheelCircM,
      debug: options.debug,
    });
  }

  return recordEvent;
}
