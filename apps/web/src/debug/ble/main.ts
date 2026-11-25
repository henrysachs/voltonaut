import {
  createReplayTransport,
  createIntervalTicker,
  parseBleFixtureJson,
  bleFixtureSchema,
  SNIFFER_PRESETS,
  SNIFFER_OPTIONAL_SERVICES,
  type BleTransport,
} from "@voltonaut/ble";
import { element, input, downloadJson } from "./dom.js";
import { renderExplorer } from "./explorer.js";
import { LabDevices } from "./devices.js";
import type { LabDevice, LabChange } from "./device.js";
import { renderDevices, restoreMetadata } from "./deviceList.js";
import { addNativeDevice } from "./connections.js";
import { preset } from "./presets.js";

const scan = { acceptAllDevices: true, filters: [], optionalServices: SNIFFER_OPTIONAL_SERVICES };
const clock = { nowS: () => performance.now() / 1000 };
const ticker = createIntervalTicker(50);
const devices = new LabDevices({ clock, ticker }, changed);
let paused = false;
let refreshExplorer = (): void => {};

function renderLog(): void {
  const target = devices.selected;

  if (paused || target === undefined) {
    return;
  }

  const filter = input("filter").value.toLowerCase();
  element("log").textContent = target.session
    .fixture(target.firmware, target.notes)
    .log.map((entry) => JSON.stringify(entry))
    .filter((line) => line.toLowerCase().includes(filter))
    .join("\n");
}

function changed(change: LabChange, source: Readonly<LabDevice>): void {
  if (change !== "capture") {
    renderDevices(devices);
  }

  const target = devices.selected;

  if (
    target !== undefined &&
    (change === "selection" || (change === "profile" && target === source))
  ) {
    restoreMetadata(target);
    refreshExplorer = renderExplorer("gatt", target);
  }

  if (change === "selection") {
    element("log").textContent = "";
  }

  renderLog();
  refreshExplorer();
}

function runSelected(operation: (target: Readonly<LabDevice>) => Promise<void>): void {
  const target = devices.selected;

  if (target === undefined) {
    element("status").textContent = "Zuerst Gerät wählen";

    return;
  }

  target.run(() => operation(target));
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

async function addReplayDevice(replay: string): Promise<void> {
  const transport = await replayTransport(replay);
  const device = devices.add(transport, transport.deviceId(), transport.deviceName());
  device.run(() => device.connect(scan));
}

function bindControls(): void {
  element("scan").addEventListener("click", () => {
    const replay = new URLSearchParams(location.search).get("replay");
    element("picker-status").textContent = "";

    const adding = replay === null ? addNativeDevice(devices, scan) : addReplayDevice(replay);
    void adding.catch((error) => {
      element("picker-status").textContent =
        error instanceof Error ? error.message : "Geräteauswahl fehlgeschlagen";
    });
  });
  element("reconnect").addEventListener("click", () => {
    runSelected((device) => device.connect(scan));
  });
  element("disconnect").addEventListener("click", () => {
    runSelected((device) => device.disconnect());
  });

  for (const id of ["firmware", "notes"]) {
    element(id).addEventListener("input", () => {
      const target = devices.selected;

      if (target !== undefined) {
        target.setMetadata(input("firmware").value, input("notes").value);
      }
    });
  }
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
    runSelected(async (device) => {
      device.session.marker(text);
      await Promise.resolve();
    });
  });
  element("export").addEventListener("click", () => {
    const firmware = input("firmware").value;
    const notes = input("notes").value;
    runSelected(async (device) => {
      const fixture = device.session.fixture(firmware, notes);
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
    runSelected((device) => preset(device, definition));
  });
  element("presets").append(button);
}

window.addEventListener(
  "pagehide",
  () => {
    for (const device of devices.entries) {
      void device.dispose();
    }
  },
  { once: true },
);

bindControls();

bindLogger();
