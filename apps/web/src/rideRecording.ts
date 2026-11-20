import type { DeviceEvent, LocalRideMetadata } from "@voltonaut/shared";

import { createRideRecorder } from "./game/rideRecorder.js";
import { openRideDatabase } from "./sync/rideDatabase.js";
import { createRideStore } from "./sync/rideStore.js";
import { rideTcxFilename, serializeRideTcx } from "./sync/rideTcx.js";
import { mountRideRecording } from "./ui/rideRecording.js";

interface RecordingSetup {
  readonly nowMs: () => number;
  readonly utcNow: () => string;
  readonly newId: () => string;
  readonly metadata: LocalRideMetadata;
  readonly distanceM: () => number | undefined;
}

export function setupRideRecording(options: RecordingSetup): (event: DeviceEvent) => void {
  const recorder = createRideRecorder(options);
  const store = openRideDatabase(indexedDB).then(createRideStore);

  mountRideRecording({
    recorder,
    loadStore: () => store,
    distanceM: options.distanceM,
    exportRide: (ride) => ({ filename: rideTcxFilename(ride), xml: serializeRideTcx(ride) }),
  });

  return recorder.ingest;
}
