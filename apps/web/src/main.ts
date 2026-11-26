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
import { mountRideViews, wearLoadout } from "./rideViews.js";
import { setupProgressHud } from "./progressHud.js";
import { mountGameMenu } from "./ui/gameMenu.js";
import { mountRouteCatalog, updateRouteIdentity } from "./ui/routeCatalogPanel.js";
import { resolveRouteId, routeEnvironmentSettings, ROUTE_CATALOG } from "./world/routeCatalog.js";

const FAST_CLOCK_SCALE = 20;

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
  const routeId = resolveRouteId(params.get("route"));
  const environment = routeEnvironmentSettings(params, routeId);

  const session = createRideSession({
    bus,
    routeId,
    profile,
    source: simMode ? "sim" : "ble",
    clockScale,
    trainer: devices,
    onProgress: setupProgressHud(account?.progress),
  });

  const scene = mountRideViews(session, {
    connectedLabel: simMode ? "Sim connected" : "Bluetooth connected",
    environment,
    debug: params.get("debug") === "1",
  });

  setupKeyboard(bus);
  updateRouteIdentity(routeId);

  devices?.mount();
  const garage = mountGameMenu(profile.bike.wheelCircM);

  // Garage purchases and equipment use the account's server state; guests keep the preview.
  if (garage !== undefined && account !== undefined)
    garage.attachAccount({ shop: account.shop, loadout: account.loadout });
  wearLoadout(scene, account?.loadout);
  mountRouteCatalog(ROUTE_CATALOG, routeId);
}

await start();
