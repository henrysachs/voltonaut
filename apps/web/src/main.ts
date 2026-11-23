import type { DeviceEvent } from "@voltonaut/shared";
import { createEventBus } from "@voltonaut/shared";

import { setupBluetoothDevices, setupKeyboard, setupSimDevices } from "./rideDevices.js";

import type { AppDocument } from "./app.js";
import { startApp } from "./app.js";
import { createRideSession } from "./game/rideSession.js";
import { createConnectionMonitor, type ConnectionMonitor } from "./game/connectionMonitor.js";
import { setupProfile } from "./profileBootstrap.js";
import { setupBrowserAccount } from "./browserAccount.js";
import { setupRidePresentation } from "./ridePresentation.js";
import { mountGameMenu } from "./ui/gameMenu.js";

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

function startHud(
  document: DocumentQuerySource,
  session: Readonly<ReturnType<typeof createRideSession>>,
  connection: Readonly<ConnectionMonitor>,
  connectedLabel: string,
): void {
  const { link, segments } = session;

  const ride = {
    snapshot: () => link.latestSnapshot(),
    connected: () => connection.state().connected,
    segments: () => segments.view(),
    dispose: () => {
      segments.unavailable();
      link.dispose();
      connection.dispose();
    },
  };

  startApp({ document: createDomDocument(document), ride, connectedLabel });
}

async function start(): Promise<void> {
  const profileReady = setupProfile();
  setupBrowserAccount(() => profileReady);
  const params = new URLSearchParams(window.location.search);
  const simMode = params.get("sim") === "1";
  const clockScale = params.get("clock") === "fast" ? FAST_CLOCK_SCALE : 1;
  const bus = createEventBus();

  const devices = simMode
    ? setupSimDevices(bus, clockScale)
    : setupBluetoothDevices(bus, clockScale);

  const session = createRideSession(APP_ROUTE_ID, devices ?? {});
  const { link } = session;
  const connection = createConnectionMonitor(bus);

  const { initialProfile: profile } = await profileReady;

  // Parameters are frozen at ride start; profile edits apply to the next ride.
  link.init({ routeId: APP_ROUTE_ID, profile, clockScale, source: simMode ? "sim" : "ble" });

  setupRidePresentation({
    routeId: APP_ROUTE_ID,
    profile,
    snapshot: () => link.latestSnapshot(),
    sceneHost: document.querySelector("#ride-scene"),
    debug: params.get("debug") === "1",
    recording: link.recording,
  });

  const forwardEvent = (event: DeviceEvent): void => {
    link.ingest(event);
  };

  bus.subscribe("trainer.data", forwardEvent);
  bus.subscribe("hr.data", forwardEvent);
  bus.subscribe("controller.button", forwardEvent);
  bus.subscribe("device.status", forwardEvent);

  startHud(document, session, connection, simMode ? "Sim connected" : "Bluetooth connected");
  setupKeyboard(bus);

  devices?.mount();
  mountGameMenu();
}

await start();
