import type { DeviceEvent } from "@voltonaut/shared";
import { createEventBus } from "@voltonaut/shared";

import { setupBluetoothDevices, setupKeyboard, setupSimDevices } from "./rideDevices.js";

import type { AppDocument } from "./app.js";
import { startApp } from "./app.js";
import type { EngineLink } from "./game/engine-link.js";
import { createEngineLink } from "./game/engine-link.js";
import type { EngineWorkerRequest, EngineWorkerResponse } from "./game/engineWorkerCore.js";
import { createConnectionMonitor, type ConnectionMonitor } from "./game/connectionMonitor.js";
import { setupProfile } from "./profileBootstrap.js";
import { setupBrowserAccount } from "./browserAccount.js";
import { setupRidePresentation } from "./ridePresentation.js";

const FAST_CLOCK_SCALE = 20;
const APP_ROUTE_ID = "test-loop";

interface DocumentQuerySource {
  readonly querySelector: (selector: string) => Element | null;
}

function createDomDocument(source: DocumentQuerySource): AppDocument {
  return {
    querySelector(selector) {
      const element = source.querySelector(selector);

      return element === null
        ? null
        : {
            write: (text: string): void => {
              element.textContent = text;
            },
          };
    },
  };
}

/** Structural channel the main thread uses to talk to the engine worker. */
interface EngineWorkerChannel {
  readonly send: (message: EngineWorkerRequest) => void;
  readonly addMessageListener: (listener: (message: EngineWorkerResponse) => void) => () => void;
}

function createEngineWorkerChannel(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Worker is the external DOM contract type; the adapter only forwards messages.
  worker: Worker,
): EngineWorkerChannel {
  return {
    send: (message) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage has no targetOrigin parameter; that rule only applies to window messaging.
      worker.postMessage(message);
    },
    addMessageListener: (listener) => {
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

function createWorkerLink(): EngineLink {
  const worker = new Worker(new URL("./game/engine-worker.ts", import.meta.url), {
    type: "module",
  });

  const channel = createEngineWorkerChannel(worker);

  return createEngineLink({
    postMessage: (message) => {
      channel.send(message);
    },
    subscribe: (listener) => {
      return channel.addMessageListener(listener);
    },
  });
}

function startHud(
  document: DocumentQuerySource,
  link: EngineLink,
  connection: Readonly<ConnectionMonitor>,
  connectedLabel: string,
): void {
  const ride = {
    snapshot: () => link.latestSnapshot(),
    connected: () => connection.state().connected,
    dispose: () => {
      link.dispose();
      connection.dispose();
    },
  };

  startApp({ document: createDomDocument(document), ride, connectedLabel });
}

async function start(): Promise<void> {
  setupBrowserAccount();
  const params = new URLSearchParams(window.location.search);
  const simMode = params.get("sim") === "1";
  const clockScale = params.get("clock") === "fast" ? FAST_CLOCK_SCALE : 1;
  const bus = createEventBus();

  const link = createWorkerLink();
  const connection = createConnectionMonitor(bus);

  const profile = await setupProfile();

  // Parameters are frozen at ride start; profile edits apply to the next ride.
  link.init({ routeId: APP_ROUTE_ID, profile, clockScale });

  const recordEvent = setupRidePresentation({
    source: simMode ? "sim" : "ble",
    routeId: APP_ROUTE_ID,
    clockScale,
    profile,
    snapshot: () => link.latestSnapshot(),
    sceneHost: document.querySelector("#ride-scene"),
    debug: params.get("debug") === "1",
  });

  const forwardEvent = (event: DeviceEvent): void => {
    recordEvent(event);
    link.ingest(event);
  };

  bus.subscribe("trainer.data", forwardEvent);
  bus.subscribe("hr.data", forwardEvent);
  bus.subscribe("controller.button", forwardEvent);
  bus.subscribe("device.status", recordEvent);

  startHud(document, link, connection, simMode ? "Sim connected" : "Bluetooth connected");
  setupKeyboard(bus);

  if (simMode) {
    setupSimDevices(bus, clockScale);
  } else {
    setupBluetoothDevices(bus);
  }
}

await start();
