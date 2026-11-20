import type { DeviceAdapter, DeviceEvent, RiderProfile } from "@voltonaut/shared";
import { DEFAULT_RIDER_PROFILE, createEventBus } from "@voltonaut/shared";

import {
  createFakeHeartRate,
  createFakePlay,
  createFakeTrainer,
  createIntervalTicker,
  createKeyboardAdapter,
  createSimScript,
  type KeyboardEventLike,
  type KeyboardSource,
} from "@voltonaut/ble";

import type { AppDocument } from "./app.js";
import { startApp } from "./app.js";
import type { EngineLink } from "./game/engine-link.js";
import { createEngineLink } from "./game/engine-link.js";
import type { EngineWorkerRequest, EngineWorkerResponse } from "./game/engineWorkerCore.js";
import { createConnectionMonitor, type ConnectionMonitor } from "./game/connectionMonitor.js";
import type { FormInput } from "./ui/profile/profileScreen.js";
import { fillProfileForm, parseProfileForm, readProfileForm } from "./ui/profile/profileScreen.js";
import type { ProfileFormInputs } from "./ui/profile/profileScreen.js";
import { createProfileStore, type ProfileStore } from "./sync/profile-store.js";
import { openProfileDatabase } from "./sync/profile-database.js";

const SIM_SAMPLES = createSimScript([
  { powerW: 142, cadenceRpm: 88, heartRateBpm: 122, gearIndex: 0 },
  { powerW: 176, cadenceRpm: 94, heartRateBpm: 128, gearIndex: 0 },
  { powerW: 205, cadenceRpm: 99, heartRateBpm: 134, gearIndex: 0 },
  { powerW: 168, cadenceRpm: 91, heartRateBpm: 130, gearIndex: 0 },
]);

const SIM_TICK_MS = 250;
const FAST_CLOCK_SCALE = 20;
const APP_ROUTE_ID = "test-loop";

interface WindowKeyboardTarget {
  readonly addEventListener: (
    type: "keydown" | "keyup",
    listener: (event: KeyboardEventLike) => void,
  ) => void;
  readonly removeEventListener: (
    type: "keydown" | "keyup",
    listener: (event: KeyboardEventLike) => void,
  ) => void;
}

interface DocumentQuerySource {
  readonly querySelector: (selector: string) => Element | null;
}

interface TextTargetView {
  readonly write: (text: string) => void;
}

function createWindowKeyboardSource(window: WindowKeyboardTarget): KeyboardSource {
  return {
    subscribe(listener) {
      const keydown = (event: KeyboardEventLike): void => {
        listener("keydown", event);
      };

      const keyup = (event: KeyboardEventLike): void => {
        listener("keyup", event);
      };

      window.addEventListener("keydown", keydown);
      window.addEventListener("keyup", keyup);

      return () => {
        window.removeEventListener("keydown", keydown);
        window.removeEventListener("keyup", keyup);
      };
    },
  };
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

function textTarget(source: DocumentQuerySource, selector: string): TextTargetView | null {
  return createDomDocument(source).querySelector(selector);
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

function profileFormInputs(document: DocumentQuerySource): ProfileFormInputs | undefined {
  const inputFrom = (selector: string): FormInput | undefined => {
    const element = document.querySelector(selector);

    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
      return element;
    }

    return undefined;
  };

  const displayName = inputFrom("#profile-displayName");
  const massKg = inputFrom("#profile-massKg");
  const heightCm = inputFrom("#profile-heightCm");
  const bikeMassKg = inputFrom("#profile-bikeMassKg");
  const chainringTeeth = inputFrom("#profile-chainringTeeth");
  const cogTeeth = inputFrom("#profile-cogTeeth");
  const wheelCircM = inputFrom("#profile-wheelCircM");
  const units = inputFrom("#profile-units");

  if (
    displayName === undefined ||
    massKg === undefined ||
    heightCm === undefined ||
    bikeMassKg === undefined ||
    chainringTeeth === undefined ||
    cogTeeth === undefined ||
    wheelCircM === undefined ||
    units === undefined
  ) {
    return undefined;
  }

  return { displayName, massKg, heightCm, bikeMassKg, chainringTeeth, cogTeeth, wheelCircM, units };
}

function setupProfileForm(
  document: DocumentQuerySource,
  store: ProfileStore,
  profile: RiderProfile,
): void {
  const form = document.querySelector("#profile-form");
  const inputs = profileFormInputs(document);

  if (form === null || inputs === undefined) {
    return;
  }

  fillProfileForm(inputs, profile);

  const error = textTarget(document, "#profile-error");
  const status = textTarget(document, "#profile-status");

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- SubmitEvent is the DOM listener contract type.
  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const result = parseProfileForm(readProfileForm(inputs));

    if (!result.ok) {
      error?.write("Profile rejected: values out of range.");
      status?.write("Not saved");

      return;
    }

    void (async () => {
      try {
        await store.save(result.profile);
        error?.write("");
        status?.write("Saved locally");
      } catch {
        status?.write("Save failed");
      }
    })();
  });
}

function setupSimDevices(bus: ReturnType<typeof createEventBus>): void {
  const params = new URLSearchParams(window.location.search);
  const clockScale = params.get("clock") === "fast" ? FAST_CLOCK_SCALE : 1;
  const ticker = createIntervalTicker(SIM_TICK_MS / clockScale);
  const clock = { nowS: (): number => performance.now() / 1000 };

  const trainer = createFakeTrainer({ bus, clock, ticker, samples: SIM_SAMPLES });
  const heartRate = createFakeHeartRate({ bus, clock, ticker, samples: SIM_SAMPLES });
  const play = createFakePlay({ bus, clock });

  const keyboard = createKeyboardAdapter({
    bus,
    clock,
    source: createWindowKeyboardSource(window),
  });

  void Promise.all(
    [trainer, heartRate, play, keyboard].map((device: DeviceAdapter) => device.connect()),
  );
}

async function loadProfile(store: ProfileStore): Promise<RiderProfile> {
  const profile = await store.load();

  return profile ?? DEFAULT_RIDER_PROFILE;
}

function startHud(
  document: DocumentQuerySource,
  link: EngineLink,
  connection: Readonly<ConnectionMonitor>,
): void {
  const ride = {
    snapshot: () => link.latestSnapshot(),
    connected: () => connection.state().connected,
    dispose: () => {
      link.dispose();
      connection.dispose();
    },
  };

  startApp({ document: createDomDocument(document), ride });
}

async function start(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const simMode = params.get("sim") === "1";
  const clockScale = params.get("clock") === "fast" ? FAST_CLOCK_SCALE : 1;
  const bus = createEventBus();

  const link = createWorkerLink();
  const connection = createConnectionMonitor(bus);

  const store = createProfileStore(await openProfileDatabase(indexedDB));
  const profile = await loadProfile(store);

  // Parameters are frozen at ride start; profile edits apply to the next ride.
  link.init({ routeId: APP_ROUTE_ID, profile, clockScale });

  const forwardEvent = (event: DeviceEvent): void => {
    link.ingest(event);
  };

  bus.subscribe("trainer.data", forwardEvent);
  bus.subscribe("hr.data", forwardEvent);
  bus.subscribe("controller.button", forwardEvent);

  startHud(document, link, connection);
  setupProfileForm(document, store, profile);

  if (simMode) {
    setupSimDevices(bus);
  }
}

await start();
