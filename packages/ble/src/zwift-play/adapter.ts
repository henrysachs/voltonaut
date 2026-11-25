import { createReconnectingAdapter, type BleDeviceAdapter } from "../adapterShell.js";
import type { PlaySide } from "./parse.js";
import { PlaySession, type PlaySessionOptions } from "./session.js";

export type PlayAdapterOptions = PlaySessionOptions;

export interface PlayAdapter extends BleDeviceAdapter {
  readonly side: PlaySide;
  readonly description: () => string;
}

export function createPlayAdapter(options: PlayAdapterOptions): PlayAdapter {
  let session: PlaySession | undefined;

  const adapter = createReconnectingAdapter({
    ...options,
    kind: "controller",
    id: `play-${options.side}`,
    startSession: async (publish, selection, signal) => {
      session?.stop();
      const current = new PlaySession(options, publish);
      session = current;

      await current.start(selection);
      signal.throwIfAborted();
    },
    stopSession: () => session?.stop(),
  });

  return {
    ...adapter,
    side: options.side,
    description: () =>
      session?.description() ??
      "Seite noch unbekannt. Passenden Griff auswählen; eine Taste bestätigt die Seite.",
  };
}
