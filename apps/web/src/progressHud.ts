import type { RideProgressCheckpoint } from "@voltonaut/shared";

import { ProgressLive, type ProgressLiveSource } from "./sync/progressLive.js";
import { mountHudVolts } from "./ui/hudVolts.js";

/**
 * Live Volts in the HUD (spec E6-11). Returns the checkpoint sink of the ride: the account's
 * progress sync sees each checkpoint first, so the live display reads its updated journal state.
 */
export function setupProgressHud(
  progress:
    | (ProgressLiveSource & Readonly<{ accept: (checkpoint?: RideProgressCheckpoint) => void }>)
    | undefined,
): (checkpoint?: RideProgressCheckpoint) => void {
  const live = new ProgressLive(progress, () => navigator.onLine);

  mountHudVolts(live);
  window.addEventListener("online", live.refresh);
  window.addEventListener("offline", live.refresh);

  return (checkpoint) => {
    progress?.accept(checkpoint);
    live.accept(checkpoint);
  };
}
