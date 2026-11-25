import type { RideSnapshot } from "@voltonaut/engine";
import { TEST_ROUTES } from "@voltonaut/engine";
import type { LocalRideMetadata, RideMode } from "@voltonaut/shared";
import type { RecordingControls } from "./game/rideCaptureProtocol.js";

import { setupRideRecording } from "./rideRecording.js";
import { mountRideMode } from "./ui/rideMode.js";
import type { EnvironmentSettings } from "./world/environment.js";
import { startRideScene } from "./world/scene.js";

interface RidePresentationOptions {
  readonly snapshot: () => Readonly<RideSnapshot> | undefined;
  readonly profile: LocalRideMetadata["profile"];
  readonly routeId: string;
  readonly sceneHost: Readonly<Element> | null;
  readonly environment: EnvironmentSettings;
  readonly debug: boolean;
  readonly recording: RecordingControls;
  readonly setMode: (mode: RideMode) => void;
}

export function setupRidePresentation(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- DOM hosts retain native mutable members; the renderer owns their children.
  options: Readonly<RidePresentationOptions>,
): void {
  setupRideRecording(options.recording);
  mountRideMode({ setMode: options.setMode, recording: options.recording });

  const routeData = TEST_ROUTES[options.routeId];

  if (options.sceneHost instanceof HTMLElement && routeData !== undefined) {
    startRideScene({
      host: options.sceneHost,
      routeId: options.routeId,
      snapshot: options.snapshot,
      wheelCircM: options.profile.bike.wheelCircM,
      environment: options.environment,
      debug: options.debug,
    });
  }
}
