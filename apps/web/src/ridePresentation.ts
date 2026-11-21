import type { RideSnapshot } from "@voltonaut/engine";
import { TEST_ROUTES } from "@voltonaut/engine";
import type { LocalRideMetadata } from "@voltonaut/shared";
import type { RecordingControls } from "./game/rideCaptureProtocol.js";

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
  readonly recording: RecordingControls;
}

export function setupRidePresentation(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM hosts retain native mutable members; the renderer owns their children.
  options: Readonly<RidePresentationOptions>,
): void {
  setupRideRecording(options.recording);

  const routeData = TEST_ROUTES[options.routeId];

  if (options.sceneHost instanceof HTMLElement && routeData !== undefined) {
    startRideScene({
      host: options.sceneHost,
      routeId: options.routeId,
      snapshot: options.snapshot,
      wheelCircM: options.profile.bike.wheelCircM,
      debug: options.debug,
    });
  }
}
