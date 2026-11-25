export interface ProgressPanelCounts {
  readonly rows: number;
  readonly queued: number;
  readonly sending: number;
  readonly blocked: number;
  readonly stored: number;
  readonly open: number;
  readonly remaining: number;
}

export type ProgressPanelView =
  | { readonly kind: "guest"; readonly message: string }
  | {
      readonly kind: "account";
      readonly consent:
        | { readonly kind: "loading" }
        | { readonly kind: "failed"; readonly message: string }
        | {
            readonly kind: "ready";
            readonly enabled: boolean;
            readonly version: number;
            readonly rewardsAvailable: boolean;
          };
      readonly outbox:
        | { readonly kind: "loading" }
        | { readonly kind: "failed" }
        | { readonly kind: "ready"; readonly counts: ProgressPanelCounts }
        | { readonly kind: "capacity"; readonly counts: ProgressPanelCounts };
      readonly busy: boolean;
      readonly message: string;
    };

export interface ProgressPanelPort {
  readonly subscribe: (listener: (view: ProgressPanelView) => void) => () => void;
  readonly setConsent: (enabled: boolean) => Promise<void>;
  readonly retry: () => Promise<void>;
}

export function progressCountsText(counts: ProgressPanelCounts): string {
  const pending = counts.queued + counts.sending + counts.blocked;

  return `Lokal: ${pending} ausstehend · ${counts.queued} wartend · ${counts.sending} im Versand · ${counts.blocked} blockiert · ${counts.open} offen · ${counts.stored} bestätigt · ${counts.remaining} Kapazität frei.`;
}

export function progressStatusText(view: ProgressPanelView): string {
  switch (view.kind) {
    case "guest":
      return view.message;
    case "account": {
      const consent =
        view.consent.kind === "loading"
          ? "Zustimmung wird geprüft …"
          : view.consent.kind === "failed"
            ? view.consent.message
            : `Zustimmung ${view.consent.enabled ? "aktiv" : "inaktiv"} · Version ${view.consent.version}. ${view.consent.rewardsAvailable ? "" : "Serverbelohnungen sind deaktiviert."}`;

      const outbox =
        view.outbox.kind === "loading"
          ? "Lokaler Lieferstand wird geprüft …"
          : view.outbox.kind === "failed"
            ? "Lokale Progress-Warteschlange nicht verfügbar. Kein Speicherbeleg."
            : view.outbox.kind === "capacity"
              ? `Kapazität voll. ${progressCountsText(view.outbox.counts)}`
              : progressCountsText(view.outbox.counts);

      return view.message === "" ? `${consent} ${outbox}` : `${consent} ${outbox} ${view.message}`;
    }

    default: {
      const exhausted: never = view;

      return exhausted;
    }
  }
}

function paragraph(text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = text;

  return element;
}

function button(text: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;

  return element;
}

interface ProgressControls {
  readonly status: HTMLParagraphElement;
  readonly toggle: HTMLButtonElement;
  readonly retry: HTMLButtonElement;
}

function renderProgressControls(
  view: Readonly<ProgressPanelView>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The helper updates owned DOM nodes.
  controls: Readonly<ProgressControls>,
): void {
  const { status, toggle, retry } = controls;

  status.textContent = progressStatusText(view);
  toggle.hidden = view.kind !== "account" || view.consent.kind !== "ready";
  toggle.disabled =
    view.kind !== "account" ||
    view.busy ||
    view.consent.kind !== "ready" ||
    (view.consent.kind === "ready" && !view.consent.rewardsAvailable);
  toggle.textContent =
    view.kind === "account" && view.consent.kind === "ready" && view.consent.enabled
      ? "Automatischen Fahrtfortschritt widerrufen"
      : "Automatischen Fahrtfortschritt aktivieren";
  retry.hidden = view.kind !== "account";
  retry.disabled =
    view.kind !== "account" ||
    view.busy ||
    (view.consent.kind === "ready" && (!view.consent.enabled || !view.consent.rewardsAvailable));
  retry.textContent =
    view.kind === "account" && view.consent.kind === "failed"
      ? "Progress-Status erneut laden"
      : "Ausstehende Progress-Daten jetzt synchronisieren";
}

export function mountProgressPanel(port: Readonly<ProgressPanelPort>): void {
  const host = document.querySelector("#progress-panel");

  if (host === null) return;
  const section = document.createElement("section");
  const title = document.createElement("h2");
  title.textContent = "Automatischer Fahrtfortschritt";

  const explanation = paragraph(
    "Nur nach ausdrücklicher Aktivierung werden BLE-Fahrtdaten ohne Herzfrequenz lokal gespeichert und an dein Konto gesendet, um Volts zu berechnen. Die Aktivierung gilt erst ab der nächsten Fahrt beziehungsweise einem neuen Journal bei Tick 0. Ein Widerruf stoppt neue Speicherung und Uploads sofort; bestätigte Bereiche bleiben erhalten. Sim wird nie erfasst. Es entstehen keine synthetischen Fahrten und kein XP. Die Fahrt läuft beim Ändern dieser Einstellung weiter.",
  );

  const status = paragraph("");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const toggle = button("Aktivieren");
  const retry = button("Erneut versuchen");
  toggle.addEventListener("click", () => {
    if (view.kind !== "account" || view.consent.kind !== "ready") return;
    void port.setConsent(!view.consent.enabled);
  });
  retry.addEventListener("click", () => {
    void port.retry();
  });
  section.append(title, explanation, status, toggle, retry);
  host.append(section);
  let view: ProgressPanelView = { kind: "guest", message: "Zum Verwalten bitte anmelden." };

  port.subscribe((next) => {
    view = next;
    renderProgressControls(next, { status, toggle, retry });
  });
}
