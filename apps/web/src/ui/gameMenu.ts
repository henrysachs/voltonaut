import { mountPwaPanel } from "../pwa/pwaPanel.js";
import { mountGarage } from "./garage/garage.js";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Browser-owned DOM nodes and event handles retain native mutable members; this module updates navigation attributes and focus.
interface MenuTab {
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
}

function menuTabs(): readonly MenuTab[] {
  return [...document.querySelectorAll(".game-menu [role=tab]")].flatMap((button) => {
    const panel = document.querySelector(`#${button.getAttribute("aria-controls") ?? "missing"}`);

    return button instanceof HTMLButtonElement && panel instanceof HTMLElement
      ? [{ button, panel }]
      : [];
  });
}

function mountTabs(): void {
  const tabs = menuTabs();

  const select = (selected: Readonly<MenuTab>): void => {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.button.setAttribute("aria-selected", String(active));
      tab.button.tabIndex = active ? 0 : -1;
      tab.panel.hidden = !active;
    }
  };

  for (const [index, tab] of tabs.entries()) {
    const offsets = new Map([
      ["ArrowRight", 1],
      ["ArrowLeft", -1],
      ["Home", -index],
      ["End", tabs.length - index - 1],
    ]);

    tab.button.addEventListener("click", () => {
      select(tab);
    });
    tab.button.addEventListener("keydown", (event) => {
      const offset = offsets.get(event.key);

      if (offset === undefined) return;

      const next = tabs[(index + offset + tabs.length) % tabs.length];

      if (next === undefined) return;

      event.preventDefault();
      select(next);
      next.button.focus();
    });
  }
}

function mountFocusLoop(dialog: HTMLDialogElement): void {
  for (const boundary of dialog.querySelectorAll("[data-menu-boundary]")) {
    boundary.addEventListener("focus", () => {
      const controls = [
        ...dialog.querySelectorAll(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [role=tabpanel]:not([hidden])",
        ),
      ].filter((element) => element.getClientRects().length > 0);

      const target = boundary.matches('[data-menu-boundary="start"]')
        ? controls.at(-1)
        : controls.at(0);

      if (target instanceof HTMLElement) target.focus();
    });
  }
}

function mountDeviceAccess(dialog: HTMLDialogElement, devices: HTMLButtonElement): void {
  const shortcut = document.querySelector('[data-game-action="devices"]');

  if (shortcut instanceof HTMLButtonElement) {
    document.querySelector("#game-header-actions")?.prepend(shortcut);
    devices.addEventListener("click", () => {
      dialog.close();
      shortcut.click();
    });
  } else {
    devices.disabled = true;
    devices.textContent = "Bluetooth nicht verfügbar";
  }

  for (const notice of document.querySelectorAll("body > p")) {
    document.querySelector("#game-notices")?.append(notice);
  }
}

function mountEscapeShortcut(show: () => void): void {
  let openOnRelease = false;

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      openOnRelease = !event.defaultPrevented && document.querySelector("dialog[open]") === null;
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.key !== "Escape") return;

    const shouldOpen = openOnRelease;
    openOnRelease = false;

    if (shouldOpen) show();
  });
}

export function mountGameMenu(wheelCircM?: number): void {
  mountPwaPanel();

  if (wheelCircM !== undefined) {
    const garage = document.querySelector("#garage-shop");

    if (garage instanceof HTMLElement) mountGarage(garage, wheelCircM);
  }

  const dialog = document.querySelector("#game-menu");
  const open = document.querySelector("#game-menu-open");
  const close = document.querySelector("#game-menu-close");
  const devices = document.querySelector("#game-menu-devices");

  if (
    dialog instanceof HTMLDialogElement &&
    open instanceof HTMLButtonElement &&
    close instanceof HTMLButtonElement &&
    devices instanceof HTMLButtonElement
  ) {
    mountTabs();
    mountFocusLoop(dialog);
    mountDeviceAccess(dialog, devices);

    const show = (): void => {
      if (document.querySelector("dialog[open]") !== null) return;

      dialog.showModal();
      open.setAttribute("aria-expanded", "true");
    };

    open.addEventListener("click", show);
    close.addEventListener("click", () => {
      dialog.close();
    });
    dialog.addEventListener("close", () => {
      open.setAttribute("aria-expanded", "false");
    });
    dialog.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    mountEscapeShortcut(show);
  }
}
