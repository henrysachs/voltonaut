import { detectPlatform, INSTALL_HINTS } from "./installHints.js";
import { browserPorts, hardReload } from "./hardReload.js";
import { registerShell } from "./register.js";
import type { ApplyUpdate } from "./register.js";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Browser-owned DOM nodes and events keep native mutable members.
interface InstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
}

function isInstallPrompt(event: Event): event is InstallPromptEvent {
  return "prompt" in event;
}

function paragraph(text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = text;

  return element;
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

function renderHints(host: HTMLElement): void {
  const current = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);

  for (const hint of INSTALL_HINTS) {
    const section = document.createElement("section");
    const title = document.createElement("h3");
    title.textContent = hint.platform === current ? `${hint.title} (dieses Gerät)` : hint.title;
    section.append(title, paragraph(hint.steps), paragraph(hint.bluetooth));
    host.append(section);
  }
}

function mountInstallButton(host: HTMLElement, status: HTMLElement): void {
  const button = document.createElement("button");
  button.type = "button";
  button.hidden = true;
  button.textContent = "App installieren";
  host.append(button);

  window.addEventListener("beforeinstallprompt", (event) => {
    if (!isInstallPrompt(event)) return;

    event.preventDefault();
    button.hidden = false;
    button.addEventListener("click", () => {
      button.hidden = true;
      void event.prompt();
    });
  });
  window.addEventListener("appinstalled", () => {
    button.hidden = true;
    status.textContent = "Voltonaut ist installiert.";
  });
}

/** Opens the menu on the App tab, where the update and its recording warning live. */
export type RevealUpdate = (focus: HTMLElement) => void;

/** Cockpit shortcut next to „Menü“; hidden until a new version is waiting. */
function updateShortcut(reveal: RevealUpdate, target: HTMLElement): HTMLButtonElement | undefined {
  const actions = document.querySelector("#game-header-actions");

  return actions instanceof HTMLElement ? appendShortcut(actions, reveal, target) : undefined;
}

function appendShortcut(
  actions: HTMLElement,
  reveal: RevealUpdate,
  target: HTMLElement,
): HTMLButtonElement {
  const shortcut = document.createElement("button");
  shortcut.type = "button";
  shortcut.id = "pwa-update-shortcut";
  shortcut.hidden = true;
  shortcut.textContent = "Neue Version";
  shortcut.addEventListener("click", () => {
    reveal(target);
  });
  actions.append(shortcut);

  return shortcut;
}

function mountUpdate(host: HTMLElement, reveal: RevealUpdate): (apply: ApplyUpdate) => void {
  const notice = document.createElement("div");
  notice.hidden = true;

  const text = paragraph(
    "Eine neue Version ist bereit. Aktualisieren lädt die Seite neu und verwirft eine laufende Aufnahme.",
  );

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Jetzt aktualisieren";
  notice.append(text, button);
  host.append(notice);

  const shortcut = updateShortcut(reveal, button);

  return (apply) => {
    notice.hidden = false;

    if (shortcut !== undefined) shortcut.hidden = false;

    button.addEventListener("click", apply, { once: true });
  };
}

function mountHardReload(host: HTMLElement): void {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.textContent = "Hard Reload";

  const confirmation = document.createElement("div");
  confirmation.hidden = true;
  confirmation.setAttribute("role", "alert");

  const warning = paragraph(
    "Hard Reload lädt App und Dateien frisch vom Netz und unterbricht die laufende Fahrt und Aufnahme. Gespeicherte Aufnahmen, Kontodaten und andere Browserdaten bleiben erhalten. Nur der Voltonaut-App-Cache wird zurückgesetzt.",
  );

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = "Ja, jetzt neu laden";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Abbrechen";
  confirmation.append(warning, confirm, cancel);

  trigger.addEventListener("click", () => {
    confirmation.hidden = false;
    trigger.hidden = true;
    cancel.focus();
  });
  cancel.addEventListener("click", () => {
    confirmation.hidden = true;
    trigger.hidden = false;
    trigger.focus();
  });
  confirm.addEventListener("click", () => {
    confirm.disabled = true;
    hardReload(browserPorts()).catch(() => {
      confirm.disabled = false;
      warning.textContent =
        "Hard Reload ist fehlgeschlagen. Gespeicherte Daten wurden nicht verändert.";
    });
  });
  host.append(trigger, confirmation);
}

function populate(host: HTMLElement, reveal: RevealUpdate): void {
  const status = paragraph(
    isStandalone()
      ? "Voltonaut läuft als installierte App."
      : "Voltonaut läuft im Browser und lässt sich auf unterstützten Geräten installieren.",
  );

  const offline = paragraph(
    "Offline lädt nur die App-Oberfläche aus dem Cache. Konto-, Fahrt-, Puls- und Checkpoint-Daten kommen immer vom Gerät oder Server und werden nie im Cache abgelegt. Ohne Netz sind Kontoabruf, Synchronisierung und Strava nicht verfügbar.",
  );

  host.append(status);
  mountInstallButton(host, status);
  const onUpdateReady = mountUpdate(host, reveal);
  host.append(offline);
  mountHardReload(host);
  renderHints(host);

  if (import.meta.env.PROD === true && "serviceWorker" in navigator) {
    registerShell(navigator.serviceWorker, onUpdateReady).catch(() => {
      console.warn("Service worker registration failed");
    });
  }
}

export function mountPwaPanel(reveal: RevealUpdate): void {
  const host = document.querySelector("#pwa-panel");

  if (host instanceof HTMLElement) populate(host, reveal);
}
