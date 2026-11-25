import { createEventBus } from "@voltonaut/shared";

import { setupBluetoothDevices, setupKeyboard, setupSimDevices } from "./rideDevices.js";

import { createRideSession } from "./game/rideSession.js";
import { setupProfile } from "./profileBootstrap.js";
import { setupBrowserAccount, type BrowserAccount } from "./browserAccount.js";
import { mountRideViews } from "./rideViews.js";
import { wornLoadout } from "./sync/garageLoadout.js";
import { mountGameMenu } from "./ui/gameMenu.js";
import { parseEnvironmentSettings } from "./world/environment.js";

const FAST_CLOCK_SCALE = 20;
const APP_ROUTE_ID = "test-loop";

/**
 * Garage purchases and equipment use the account's server state once account data is ready; the
 * ride wears the confirmed equipment and guests keep the default (spec E7-05 AK8).
 */
async function attachGarage(
  garage: ReturnType<typeof mountGameMenu>,
  scene: ReturnType<typeof mountRideViews>,
  account: Readonly<Pick<BrowserAccount, "accounts">> | undefined,
): Promise<void> {
  const sync = await account?.accounts.catch(() => null);

  if (sync === undefined || sync === null) return;

  garage?.attachAccount(sync.garage);
  sync.garage.loadout.subscribe((view) => {
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

  const devices = simMode
    ? setupSimDevices(bus, clockScale)
    : setupBluetoothDevices(bus, clockScale);

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

  const scene = mountRideViews(session, {
    connectedLabel: simMode ? "Sim connected" : "Bluetooth connected",
    environment: parseEnvironmentSettings(params),
    debug: params.get("debug") === "1",
  });

  setupKeyboard(bus);

  devices?.mount();
  void attachGarage(mountGameMenu(profile.bike.wheelCircM), scene, account);
}

await start();
