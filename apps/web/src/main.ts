import { createEventBus } from "@voltonaut/shared";

import {
  bluetoothDeviceSource,
  setupKeyboard,
  setupRideDevices,
  simDeviceSource,
} from "./rideDevices.js";

import { createRideSession } from "./game/rideSession.js";
import { setupProfile } from "./profileBootstrap.js";
import { setupBrowserAccount, type BrowserAccount } from "./browserAccount.js";
import { mountRideViews } from "./rideViews.js";
import { wornLoadout } from "./sync/garageLoadout.js";
import { selectRouteFromUrl } from "./routeSelection.js";
import { mountGameMenu } from "./ui/gameMenu.js";

const FAST_CLOCK_SCALE = 20;

/** The ride wears the confirmed equipment; guests and offline riders the default (spec E7-05 AK8). */
function wearLoadout(
  scene: ReturnType<typeof mountRideViews>,
  loadout: Readonly<Pick<BrowserAccount["loadout"], "subscribe">> | undefined,
): void {
  loadout?.subscribe((view) => {
    scene?.setLook?.(wornLoadout(view));
  });
}

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
  const route = selectRouteFromUrl(params);

  const session = createRideSession({
    bus,
    routeId: route.routeId,
    profile,
    source: simMode ? "sim" : "ble",
    clockScale,
    trainer: devices,
    onProgress: account?.progress.accept,
  });

  const scene = mountRideViews(session, {
    connectedLabel: simMode ? "Sim connected" : "Bluetooth connected",
    environment: route.environment,
    debug: params.get("debug") === "1",
  });

  setupKeyboard(bus);

  devices?.mount();
  const garage = mountGameMenu(profile.bike.wheelCircM);

  // Garage purchases and equipment use the account's server state; guests keep the preview.
  if (garage !== undefined && account !== undefined)
    garage.attachAccount({ shop: account.shop, loadout: account.loadout });
  wearLoadout(scene, account?.loadout);
  route.mount();
}

await start();
