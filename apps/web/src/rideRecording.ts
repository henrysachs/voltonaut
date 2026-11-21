import { rideTcxFilename, serializeRideTcx } from "@voltonaut/shared";

import type { RecordingControls } from "./game/rideCaptureProtocol.js";
import { openRideDatabase } from "./sync/rideDatabase.js";
import { createRideStore } from "./sync/rideStore.js";
import { mountRideRecording } from "./ui/rideRecording.js";

export function setupRideRecording(recorder: RecordingControls): void {
  const store = Promise.resolve()
    .then(() => openRideDatabase(indexedDB))
    .then(createRideStore);

  mountRideRecording({
    recorder,
    loadStore: () => store,
    exportRide: (ride) => ({ filename: rideTcxFilename(ride), xml: serializeRideTcx(ride) }),
  });
}
