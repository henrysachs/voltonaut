import { detectPlatform, INSTALL_HINTS } from "./installHints.js";
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

function mountUpdate(host: HTMLElement): (apply: ApplyUpdate) => void {
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

  return (apply) => {
    notice.hidden = false;
    button.addEventListener("click", apply, { once: true });
  };
}

function populate(host: HTMLElement): void {
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
  const onUpdateReady = mountUpdate(host);
  host.append(offline);
  renderHints(host);

  if (import.meta.env.PROD === true && "serviceWorker" in navigator) {
    registerShell(navigator.serviceWorker, onUpdateReady).catch(() => {
      console.warn("Service worker registration failed");
    });
  }
}

export function mountPwaPanel(): void {
  const host = document.querySelector("#pwa-panel");

  if (host instanceof HTMLElement) populate(host);
}
