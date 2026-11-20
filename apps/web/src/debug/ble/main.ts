import {
  createNavigatorBluetoothCentral,
  createWebBluetoothTransport,
  createReplayTransport,
  createIntervalTicker,
  parseBleFixtureJson,
  bleFixtureSchema,
  SNIFFER_PRESETS,
  runBlePreset,
  SNIFFER_OPTIONAL_SERVICES,
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_V2_SERVICE,
  type BleTransport,
  type BlePreset,
  type GattProfile,
} from "@voltonaut/ble";

import { element, input, select, downloadJson, showAdvertisement } from "./dom.js";
import { renderExplorer, type RunOperation } from "./explorer.js";
import { createSnifferSession, type SnifferSession } from "./session.js";

const scan = { acceptAllDevices: true, filters: [], optionalServices: SNIFFER_OPTIONAL_SERVICES };
const clock = { nowS: () => performance.now() / 1000 };
const ticker = createIntervalTicker(50);
const sessions: SnifferSession[] = [];
const profiles = new Map<SnifferSession, GattProfile>();
let current: SnifferSession | undefined;
let paused = false;
let queue = Promise.resolve();
let refreshExplorer = (): void => {};
const controlled = new Set<SnifferSession>();

function renderLog(): void {
  if (paused || current === undefined) {
    return;
  }

  const filter = input("filter").value.toLowerCase();
  element("log").textContent = current
    .fixture("", "")
    .log.map((entry) => JSON.stringify(entry))
    .filter((line) => line.toLowerCase().includes(filter))
    .join("\n");
}

async function executeOperation(
  operation: () => Promise<void>,
  target?: SnifferSession,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bluetooth operation failed";

    if (target === undefined || current === target) {
      element("status").textContent = message;
    }

    target?.marker(`error: ${message}`);
  }
}

function runFor(target: SnifferSession): RunOperation {
  return (operation) => {
    queue = queue.then(() => executeOperation(operation, target));
  };
}

function runSelected(operation: (target: SnifferSession) => Promise<void>): void {
  const target = current;

  if (target === undefined) {
    element("status").textContent = "Zuerst Gerät wählen";

    return;
  }

  runFor(target)(() => operation(target));
}

function renderSession(): void {
  const target = current;

  if (target === undefined) {
    return;
  }

  const profile = profiles.get(target);

  if (profile !== undefined) {
    refreshExplorer = renderExplorer("gatt", profile, target, runFor(target));
  }

  renderLog();
}

async function replayTransport(replay: string): Promise<BleTransport> {
  const response = await fetch(replay);

  if (!response.ok) {
    throw new Error(`Replay HTTP ${response.status}`);
  }

  const parsed = parseBleFixtureJson(await response.text());

  if (!parsed.ok) {
    throw new Error(parsed.failure.reason);
  }

  const startedS = clock.nowS();

  return createReplayTransport({
    fixture: parsed.value,
    clock: { nowS: () => clock.nowS() - startedS },
    ticker,
  });
}

function nativeTransport(): BleTransport {
  const central = createNavigatorBluetoothCentral();

  if (central === undefined) {
    throw new Error("Web Bluetooth benötigt Chrome/Edge und HTTPS oder localhost");
  }

  return createWebBluetoothTransport({ central });
}

async function connectNew(transport: BleTransport): Promise<void> {
  const session = createSnifferSession(transport, () => {
    renderLog();
    refreshExplorer();
  });

  const profile = await session.transport.connect(scan, "select");
  current = session;
  controlled.delete(session);
  sessions.push(session);
  profiles.set(session, profile);
  const option = document.createElement("option");
  option.value = String(sessions.length - 1);
  option.textContent = `${transport.deviceName()} · ${transport.deviceId()}`;
  select("devices").append(option);
  select("devices").value = option.value;
  element("status").textContent = `ready · ${option.textContent}`;

  const stopAdvertisements = transport.watchAdvertisements((frame) => {
    if (current === session) {
      showAdvertisement(frame);
    }
  });

  const stopDisconnected = transport.onDisconnected(() => {
    controlled.delete(session);

    if (current === session) {
      element("status").textContent = `disconnected · ${transport.deviceName()}`;
    }
  });

  window.addEventListener(
    "pagehide",
    () => {
      stopAdvertisements();
      stopDisconnected();
      void session.dispose();
    },
    { once: true },
  );
  renderSession();
}

async function preset(session: SnifferSession, presetDefinition: BlePreset): Promise<void> {
  if (presetDefinition.id === "ftms-sim-five" && !controlled.has(session)) {
    throw new Error("Zuerst FTMS Request Control + Sim 0 % erfolgreich ausführen");
  }

  const playService = profiles
    .get(session)
    ?.services.find(
      (service) =>
        service.uuid === ZWIFT_PLAY_LEGACY_SERVICE || service.uuid === ZWIFT_PLAY_V2_SERVICE,
    );

  const selectedPreset =
    presetDefinition.id === "zwift-play-handshake" && playService !== undefined
      ? {
          ...presetDefinition,
          steps: presetDefinition.steps.map((step) => ({
            ...step,
            ref: { ...step.ref, serviceUuid: playService.uuid },
          })),
        }
      : presetDefinition;

  if (presetDefinition.id === "zwift-play-handshake") {
    await Promise.all(
      selectedPreset.steps.map((step) =>
        step.kind === "subscribe" ? session.observe(step.ref) : Promise.resolve(),
      ),
    );
  }

  const ok = await runBlePreset({
    transport: session.transport,
    preset: selectedPreset,
    clock,
    ticker,
  });

  if (!ok) {
    throw new Error("Preset timeout: keine erfolgreiche Control-Point-Antwort");
  }

  if (presetDefinition.id === "ftms-request-control-sim-zero") {
    controlled.add(session);
  }

  session.marker(`Preset abgeschlossen: ${presetDefinition.label}`);
}

function bindControls(): void {
  element("scan").addEventListener("click", () => {
    void executeOperation(() => {
      const replay = new URLSearchParams(location.search).get("replay");

      return replay === null
        ? connectNew(nativeTransport())
        : replayTransport(replay).then(connectNew);
    });
  });
  element("reconnect").addEventListener("click", () => {
    runSelected(async (session) => {
      const profile = await session.transport.connect(scan, "remembered");
      controlled.delete(session);
      profiles.set(session, profile);

      if (current === session) {
        renderSession();
        element("status").textContent = "ready";
      }
    });
  });
  element("disconnect").addEventListener("click", () => {
    runSelected(async (session) => {
      await session.transport.disconnect();
      controlled.delete(session);

      if (current === session) {
        element("status").textContent = "disconnected";
      }
    });
  });
  select("devices").addEventListener("change", () => {
    current = sessions[Number(select("devices").value)];
    renderSession();
  });
}

function bindLogger(): void {
  element("filter").addEventListener("input", renderLog);
  element("pause").addEventListener("click", () => {
    paused = !paused;
    element("pause").textContent = paused ? "Anzeige fortsetzen" : "Anzeige pausieren";
    renderLog();
  });
  element("add-marker").addEventListener("click", () => {
    const text = input("marker").value;
    runSelected(async (session) => {
      session.marker(text);
      await Promise.resolve();
    });
  });
  element("export").addEventListener("click", () => {
    const firmware = input("firmware").value;
    const notes = input("notes").value;
    runSelected(async (session) => {
      const fixture = session.fixture(firmware, notes);
      const parsed = bleFixtureSchema.parse(fixture);
      downloadJson(JSON.stringify(parsed, null, 2));
      await Promise.resolve();
    });
  });
}

for (const definition of SNIFFER_PRESETS) {
  const button = document.createElement("button");
  button.textContent = definition.label;
  button.addEventListener("click", () => {
    runSelected((session) => preset(session, definition));
  });
  element("presets").append(button);
}

bindControls();

bindLogger();
