import { rideTcxFilename, serializeRideTcx } from "@voltonaut/shared";

import { startApp, type AppDocument } from "./app.js";
import type { RideSession } from "./game/rideSession.js";
import { openRideDatabase } from "./sync/rideDatabase.js";
import { createRideStore } from "./sync/rideStore.js";
import { mountRideMode } from "./ui/rideMode.js";
import { mountRideRecording } from "./ui/rideRecording.js";
import type { EnvironmentSettings } from "./world/environment.js";
import { startRideScene, type RideScene } from "./world/scene.js";

export interface RideViewOptions {
  readonly connectedLabel: string;
  readonly environment: EnvironmentSettings;
  readonly debug: boolean;
}

const domDocument: AppDocument = {
  querySelector(selector) {
    const element = document.querySelector(selector);

    return element === null
      ? null
      : {
          write: (text: string): void => {
            element.textContent = text;
          },
        };
  },
};

/** Mounts every view of the running ride: HUD, recording panel, mode picker and 3D scene. */
export function mountRideViews(
  session: RideSession,
  options: RideViewOptions,
): RideScene | undefined {
  startApp({ document: domDocument, ride: session, connectedLabel: options.connectedLabel });

  const store = Promise.resolve()
    .then(() => openRideDatabase(indexedDB))
    .then(createRideStore);

  mountRideRecording({
    recorder: session.recording,
    loadStore: () => store,
    exportRide: (ride) => ({ filename: rideTcxFilename(ride), xml: serializeRideTcx(ride) }),
  });
  mountRideMode(session);

  const sceneHost = document.querySelector("#ride-scene");

  if (sceneHost instanceof HTMLElement)
    return startRideScene({
      host: sceneHost,
      routeId: session.routeId,
      snapshot: session.snapshot,
      wheelCircM: session.profile.bike.wheelCircM,
      environment: options.environment,
      debug: options.debug,
    });

  return undefined;
}
