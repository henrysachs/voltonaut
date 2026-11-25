import { createEventBus } from "@voltonaut/shared";

import {
  bluetoothDeviceSource,
  setupKeyboard,
  setupRideDevices,
  simDeviceSource,
} from "./rideDevices.js";

import { createRideSession } from "./game/rideSession.js";
import { setupProfile } from "./profileBootstrap.js";
import { setupBrowserAccount } from "./browserAccount.js";
import { mountRideViews } from "./rideViews.js";
import { mountGameMenu } from "./ui/gameMenu.js";
import { parseEnvironmentSettings } from "./world/environment.js";

const FAST_CLOCK_SCALE = 20;
const APP_ROUTE_ID = "test-loop";

async function start(): Promise<void> {
  const profileReady = setupProfile();
  const account = setupBrowserAccount(() => profileReady);
  const params = new URLSearchParams(window.location.search);
  const simMode = params.get("sim") === "1";
  const clockScale = params.get("clock") === "fast" ? FAST_CLOCK_SCALE : 1;
  const bus = createEventBus();

  // The only sim/real decision: which transports the production adapters run on.
  const source = simMode ? simDeviceSource(clockScale) : bluetoothDeviceSource();
  const devices = source === undefined ? undefined : setupRideDevices(bus, clockScale, source);

  const { initialProfile: profile } = await profileReady;

  const session = createRideSession({
    bus,
    routeId: APP_ROUTE_ID,
    profile,
    source: simMode ? "sim" : "ble",
    clockScale,
    trainer: devices,
    onProgress: account?.progress.accept,
  });

  mountRideViews(session, {
    connectedLabel: simMode ? "Sim connected" : "Bluetooth connected",
    environment: parseEnvironmentSettings(params),
    debug: params.get("debug") === "1",
  });
  setupKeyboard(bus);

  devices?.mount();
  const garage = mountGameMenu(profile.bike.wheelCircM);

  // Garage purchases use the account's server shop; guests keep the preview.
  if (garage !== undefined && account !== undefined) garage.attachShop(account.shop);
}

await start();
