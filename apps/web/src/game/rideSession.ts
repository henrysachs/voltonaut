import { TEST_ROUTES } from "@voltonaut/engine";

import {
  createEngineLink,
  type EngineLink,
  type EngineLinkCallbacks,
  type EngineWorkerPort,
} from "./engine-link.js";
import type { EngineWorkerResponse } from "./engineWorkerCore.js";
import { createSegmentProjector } from "./segments.js";

function createWorkerPort(): EngineWorkerPort {
  const worker = new Worker(new URL("./engine-worker.ts", import.meta.url), { type: "module" });

  return {
    subscribeFailure: (listener) => {
      const handler = (): void => {
        listener("Engine-Worker ausgefallen. Ungespeicherte Aufnahme möglicherweise verloren.");
      };

      worker.addEventListener("error", handler);
      worker.addEventListener("messageerror", handler);

      return () => {
        worker.removeEventListener("error", handler);
        worker.removeEventListener("messageerror", handler);
      };
    },
    postMessage: (message) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage has no targetOrigin parameter; that rule only applies to window messaging.
      worker.postMessage(message);
    },
    subscribe: (listener) => {
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- MessageEvent is the DOM listener contract type.
      const handler = (event: MessageEvent<EngineWorkerResponse>): void => {
        listener(event.data);
      };

      worker.addEventListener("message", handler);

      return () => {
        worker.removeEventListener("message", handler);
      };
    },
  };
}

export function createRideSession(
  routeId: string,
  callbacks: Pick<EngineLinkCallbacks, "onCommands" | "onSnapshot">,
  newPort: () => EngineWorkerPort = createWorkerPort,
) {
  const route = TEST_ROUTES[routeId];

  if (route === undefined) throw new Error(`Unknown route: ${routeId}`);

  const segments = createSegmentProjector(route);

  const link: EngineLink = createEngineLink(newPort(), {
    ...callbacks,
    onEvents: (events) => {
      const snapshot = link.latestSnapshot();

      if (snapshot === undefined) segments.unavailable();
      else segments.consume({ events, snapshot });
    },
    onInitFailed: () => {
      segments.unavailable();
    },
  });

  return { link, segments };
}
