import {
  createReplayTransport,
  createIntervalTicker,
  labDeviceGuide,
  parseBleFixtureJson,
  bleFixtureSchema,
  SNIFFER_PRESETS,
  SNIFFER_OPTIONAL_SERVICES,
  type BleTransport,
} from "@voltonaut/ble";
import { element, input, downloadJson, fileSlug } from "./dom.js";
import { renderExplorer } from "./explorer.js";
import { LabDevices } from "./devices.js";
import type { LabDevice, LabChange } from "./device.js";
import { createDeviceList, deviceLabel, restoreMetadata } from "./deviceList.js";
import { createLogTabs } from "./logTabs.js";
import { addNativeDevice } from "./connections.js";
import { countLog, formatLogEntry } from "./logView.js";
import { preset, presetMismatch } from "./presets.js";

const scan = { acceptAllDevices: true, filters: [], optionalServices: SNIFFER_OPTIONAL_SERVICES };
const clock = { nowS: () => performance.now() / 1000 };
const ticker = createIntervalTicker(50);
const devices = new LabDevices({ clock, ticker }, changed);

const presetButtons: {
  readonly button: HTMLButtonElement;
  readonly definition: (typeof SNIFFER_PRESETS)[number];
}[] = [];

let paused = false;
let refreshExplorer = (): void => {};

function exportDevice(device: Readonly<LabDevice>): void {
  const firmware = device.firmware;
  const notes = device.notes;
  device.run(async () => {
    const fixture = bleFixtureSchema.parse(device.session.fixture(firmware, notes));
    downloadJson(JSON.stringify(fixture, null, 2), `ble-${device.number}-${fileSlug(device.name)}`);
    await Promise.resolve();
  });
}

const renderDevices = createDeviceList(devices, { exportDevice });

const renderLogTabs = createLogTabs(devices);

function renderLog(): void {
  const target = devices.selected;

  if (paused || target === undefined) {
    return;
  }

  const log = target.session.fixture(target.firmware, target.notes).log;
  const counts = countLog(log);
  const filter = input("filter").value.toLowerCase();

  element("log-summary").textContent =
    `${deviceLabel(target)}: ${counts.received} empfangen, ${counts.sent} gesendet, ${counts.markers} Marker.`;
  const lines: string[] = [];

  for (const entry of log) {
    const line = formatLogEntry(entry);

    if (`${line} ${JSON.stringify(entry)}`.toLowerCase().includes(filter)) lines.push(line);
  }

  element("log").textContent = lines.join("\n");
}

function renderGuide(): void {
  const target = devices.selected;
  const root = element("guide");
  root.replaceChildren();

  if (target === undefined || target.state.kind === "connecting") {
    element("guide-title").textContent = "Anleitung";

    const step = document.createElement("li");
    step.textContent =
      target === undefined
        ? "Gerät hinzufügen, dann erscheint hier die passende Anleitung."
        : "Gerät wird verbunden und erkannt …";
    root.append(step);

    return;
  }

  const guide = labDeviceGuide(target.profile);
  element("guide-title").textContent = `Anleitung · ${guide.title}`;

  for (const text of guide.steps) {
    const step = document.createElement("li");
    step.textContent = text;
    root.append(step);
  }
}

function renderPresets(): void {
  const target = devices.selected;

  for (const { button, definition } of presetButtons) {
    const mismatch =
      target === undefined ? "Zuerst Gerät wählen." : presetMismatch(target, definition);

    button.disabled = mismatch !== undefined;
    button.title = mismatch ?? "";
  }
}

function changed(change: LabChange, source: Readonly<LabDevice>): void {
  if (change !== "capture") {
    renderDevices();
    renderLogTabs();
    renderGuide();
    renderPresets();
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
  element("read-all").addEventListener("click", () => {
    runSelected((device) => device.readAll());
  });
  element("export-all").addEventListener("click", () => {
    for (const device of devices.entries) {
      exportDevice(device);
    }
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
    const target = devices.selected;

    if (target === undefined) {
      element("status").textContent = "Zuerst Gerät wählen";

      return;
    }

    exportDevice(target);
  });
}

for (const definition of SNIFFER_PRESETS) {
  const button = document.createElement("button");
  button.textContent = definition.label;
  button.addEventListener("click", () => {
    runSelected((device) => preset(device, definition));
  });
  element("presets").append(button);
  presetButtons.push({ button, definition });
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

renderGuide();

renderPresets();
