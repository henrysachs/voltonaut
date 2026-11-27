import { element } from "./dom.js";
import type { LabDevices } from "./devices.js";
import type { LabDevice } from "./device.js";

const NEXT_KEYS = new Map([
  ["ArrowRight", 1],
  ["ArrowDown", 1],
  ["ArrowLeft", -1],
  ["ArrowUp", -1],
]);

function tabId(device: Readonly<LabDevice>): string {
  return `log-tab-${device.number}`;
}

function moveTarget(
  entries: readonly Readonly<LabDevice>[],
  from: Readonly<LabDevice>,
  key: string,
): Readonly<LabDevice> | undefined {
  if (key === "Home") return entries[0];

  if (key === "End") return entries.at(-1);

  const step = NEXT_KEYS.get(key);

  return step === undefined
    ? undefined
    : entries[(entries.indexOf(from) + step + entries.length) % entries.length];
}

function createTab(
  device: Readonly<LabDevice>,
  devices: Readonly<LabDevices>,
  move: (from: Readonly<LabDevice>, key: string) => void,
): HTMLElement {
  const tab = document.createElement("button");
  tab.id = tabId(device);
  tab.textContent = `${device.number} · ${device.name}`;
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", "log");
  tab.addEventListener("click", () => {
    devices.select(device);
  });
  tab.addEventListener(
    "keydown",
    (event: Readonly<Pick<KeyboardEvent, "key" | "preventDefault">>) => {
      if (NEXT_KEYS.has(event.key) || event.key === "Home" || event.key === "End") {
        event.preventDefault();
        move(device, event.key);
      }
    },
  );

  return tab;
}

/**
 * One tab per device above the shared `#log` panel (WAI-ARIA tabs pattern): roving
 * tabindex, arrow keys plus Home/End move and select, and the panel is labelled by the
 * active tab. Tabs are created once per device and updated in place so focus survives.
 */
export function createLogTabs(devices: Readonly<LabDevices>): () => void {
  const tabs = new Map<Readonly<LabDevice>, HTMLElement>();

  const move = (from: Readonly<LabDevice>, key: string): void => {
    const target = moveTarget(devices.entries, from, key);

    if (target === undefined) return;

    devices.select(target);
    tabs.get(target)?.focus();
  };

  return () => {
    const root = element("log-tabs");

    for (const device of devices.entries) {
      if (!tabs.has(device)) {
        const tab = createTab(device, devices, move);
        tabs.set(device, tab);
        root.append(tab);
      }
    }

    for (const [device, tab] of tabs) {
      const selected = devices.selected === device;
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("tabindex", selected ? "0" : "-1");
    }

    const target = devices.selected;

    if (target !== undefined) element("log").setAttribute("aria-labelledby", tabId(target));
  };
}
