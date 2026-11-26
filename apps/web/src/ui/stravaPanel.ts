import type { StravaDelivery, StravaStatus, StravaRideView } from "@voltonaut/shared";
import type { AccountSync } from "../sync/accountSync.js";
import type { AccountDataView } from "../sync/accountDataView.js";
import type { StravaSync, StravaView } from "../sync/stravaSync.js";
import { stravaDeliveryText, text, button } from "./stravaPanelText.js";

type AccountView = Extract<StravaView, { readonly kind: "account" }>;

type Accounts = Readonly<Pick<AccountSync, "view" | "subscribe" | "refresh" | "nextHistory">>;

type Host = Readonly<Pick<HTMLElement, "append" | "replaceChildren">>;

const connectionLabels: Readonly<Record<StravaStatus["status"], string>> = {
  disabled: "Strava ist auf diesem Server deaktiviert.",
  registration_required:
    "Strava-Verbindung noch gesperrt. Die Webhook-Registrierung des Servers fehlt.",
  disconnected: "Nicht mit Strava verbunden.",
  pending: "Bestätigung im ursprünglichen Tab fehlt.",
  confirmation_expired:
    "Bestätigung abgelaufen. Vor erneutem Verbinden die unbestätigte Verbindung trennen.",
  credentials_unavailable: "Zugangsdaten nicht entschlüsselbar. Zugriff nicht verwendbar.",
  refreshing: "Zugangsdaten werden aktualisiert. Zielkonto bleibt unverändert.",
  credentials_uncertain:
    "Tokenrotation unklar. Weitere Anbieterarbeit gesperrt. Zugriff in Strava-App-Einstellungen prüfen und entfernen.",
  reauthorization_required: "Strava-Zugang nicht mehr bestätigt. Versand gesperrt.",
  revocation_pending:
    "Lokal gesperrt. Vollständiger Anbieterwiderruf nicht bestätigt. Gegebenenfalls Zugriff in Strava-App-Einstellungen entfernen.",
  connected: "Mit Strava verbunden. Noch keine Fahrt freigegeben.",
};

const blockedLabels: Readonly<
  Record<Extract<StravaRideView, { readonly kind: "blocked" }>["reason"], string>
> = {
  source_policy_disabled: "Realer Versand ist standardmäßig deaktiviert.",
  not_replayed: "Diese Fahrt hat keinen zulässigen nachgerechneten Beleg.",
  window_source: "Das Aufnahmefenster erfüllt die deklarative BLE-Richtlinie nicht.",
  connection_disabled: connectionLabels.disabled,
  registration_required: connectionLabels.registration_required,
  connection_missing: connectionLabels.disconnected,
  confirmation_required: connectionLabels.pending,
  credentials_unavailable: connectionLabels.credentials_unavailable,
  credentials_uncertain: connectionLabels.credentials_uncertain,
  reauthorization_required: connectionLabels.reauthorization_required,
  revocation_pending: connectionLabels.revocation_pending,
  consent_stale: "Freigabe veraltet. Vorschau erneut laden.",
  refreshing: connectionLabels.refreshing,
};

function appendConsent(
  host: Host,
  sync: Readonly<StravaSync>,
  offer: Extract<StravaRideView, { readonly kind: "offer" }>,
  state: AccountView,
): void {
  host.append(
    text(
      `Zielathlet ${offer.consent.athleteId}. Fahrt ${offer.consent.rideId}. Exportversion ${offer.consent.exportVersion}.`,
    ),
  );
  host.append(
    text(
      "Übertragen werden Zeit, Leistung, Kadenz, optional Puls und virtuelle Distanz als stationäre VirtualRide-Fahrt. BLE ist eine Client-Selbstauskunft, kein Hardwareattest. Strava erhält die Anforderung nur für mich; tatsächliche Sichtbarkeit und Klassifikation sind noch nicht am echten Anbieter geprüft.",
    ),
  );
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  label.append(
    checkbox,
    " Ich willige ausdrücklich in genau diesen Export an diesen Strava-Athleten ein.",
  );

  const upload = button(
    "Diese Fahrt einmalig an Strava senden",
    sync.guard(() => {
      if (checkbox.checked) void sync.upload(offer.consent);
    }),
    true,
  );

  checkbox.addEventListener("change", () => {
    upload.disabled = !checkbox.checked || state.busy;
  });
  host.append(label, upload);
}

function appendDelivery(host: Host, delivery: StravaDelivery): void {
  host.append(text(stravaDeliveryText(delivery)));
  const link = document.createElement("a");
  link.href =
    delivery.progress.kind === "delivered"
      ? `https://www.strava.com/activities/${delivery.progress.activityId}`
      : "https://www.strava.com/athlete/training";
  link.textContent = "Bei Strava manuell prüfen";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  host.append(link);
}

function appendRide(host: Host, sync: Readonly<StravaSync>, state: AccountView): void {
  if (state.ride.kind === "none") {
    host.append(
      text("Zuerst eine eigene, bereits zum Voltonaut-Konto synchronisierte Fahrt auswählen."),
    );

    return;
  }

  const ride = state.ride.view;

  if (ride.kind !== "ready") {
    host.append(
      text(
        ride.kind === "loading"
          ? "Uploadvorschau wird geladen …"
          : "Uploadstatus nicht erreichbar. Kein neuer Versand.",
      ),
    );

    return;
  }

  const view = ride.value;

  if (view.kind === "blocked") host.append(text(blockedLabels[view.reason]));
  else if (view.kind === "delivery") appendDelivery(host, view.delivery);
  else appendConsent(host, sync, view, state);
}

function appendStatusLine(host: Host, value: string): void {
  const line = text(value);
  line.setAttribute("role", "status");
  host.append(line);
}

function appendConnection(host: Host, sync: Readonly<StravaSync>, state: AccountView): void {
  const status = state.connection.kind === "ready" ? state.connection.value : undefined;

  appendStatusLine(
    host,
    status === undefined
      ? state.connection.kind === "failed"
        ? "Strava-Status nicht bestätigt."
        : "Strava-Status wird geladen …"
      : connectionLabels[status.status],
  );

  if (status?.status === "connected") host.append(text(`Strava-Athlet ${status.athleteId}.`));
  host.append(
    button(
      "Strava-Status laden",
      sync.guard(() => {
        void sync.refresh();
      }),
      state.busy,
    ),
  );

  if (status?.status === "disconnected")
    host.append(
      button(
        "Mit Strava verbinden",
        sync.guard(() => {
          sync.connect();
        }),
        state.busy,
      ),
    );

  const disconnected = ["disabled", "disconnected", "registration_required"].includes(
    status?.status ?? "disconnected",
  );

  if (!disconnected)
    host.append(
      button(
        "Strava trennen / Widerruf prüfen",
        sync.guard(() => {
          void sync.disconnect();
        }),
        state.busy,
      ),
    );
  appendStatusLine(host, state.message);
}

function appendHistory(
  host: Host,
  sync: Readonly<StravaSync>,
  accounts: Accounts,
  state: AccountView,
  account: AccountDataView,
): void {
  host.append(
    button(
      "Eigene Kontofahrten laden",
      sync.guard(() => {
        void accounts.refresh();
      }),
      state.busy,
    ),
  );

  // Both stores follow one account scope, so their views always belong to the same account.
  if (account.kind !== "account" || account.history.kind !== "ready") return;

  for (const ride of account.history.value.rides)
    host.append(
      button(
        `Strava-Vorschau ${ride.startedAt} · ${(ride.distanceM / 1000).toFixed(2)} km`,
        sync.guard(() => {
          void sync.select(ride.rideId);
        }),
        state.busy,
      ),
    );

  if (account.history.value.nextCursor !== null)
    host.append(
      button(
        "Weitere Kontofahrten",
        sync.guard(() => {
          void accounts.nextHistory();
        }),
        state.busy,
      ),
    );
}

function renderPanel(
  host: Host,
  sync: Readonly<StravaSync>,
  accounts: Accounts,
  state: StravaView,
  account: AccountDataView,
): void {
  host.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Strava";
  host.append(heading);

  if (state.kind !== "account") {
    host.append(
      text(
        "Als Gast fahren und TCX exportieren bleibt unabhängig möglich. Für Strava ausdrücklich bei Voltonaut anmelden.",
      ),
    );

    return;
  }

  appendConnection(host, sync, state);
  host.append(
    text(
      "Kontosynchronisation, Strava-Verbindung und Fahrtfreigabe sind getrennte Schritte. Ein TCX-Download oder Kontoupload sendet nichts an Strava.",
    ),
  );
  appendHistory(host, sync, accounts, state, account);
  appendRide(host, sync, state);
}

export function mountStravaPanel(sync: Readonly<StravaSync>, accounts: Accounts): () => void {
  const host = document.querySelector<HTMLElement>("#strava-panel");

  if (host === null) return () => {};

  // Both views are read at render time: a binding change updates every store before any
  // listener runs, so the pair always belongs to the same account.
  const render = () => {
    renderPanel(host, sync, accounts, sync.view(), accounts.view());
  };

  const unsubscribeSync = sync.subscribe(render);
  const unsubscribeAccounts = accounts.subscribe(render);

  return () => {
    unsubscribeSync();
    unsubscribeAccounts();
    host.replaceChildren();
  };
}
