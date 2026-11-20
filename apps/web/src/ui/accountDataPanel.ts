import type { AccountSync } from "../sync/accountSync.js";
import type { AccountDataView, OutboxItem } from "../sync/accountDataView.js";
import type { SyncFailure } from "../sync/privateAuthTransport.js";

const failures: Readonly<Record<Exclude<SyncFailure, "superseded">, string>> = {
  reauth: "Anmeldung abgelaufen. Abmelden und mit demselben Konto erneut anmelden.",
  forbidden: "Keine Berechtigung. Serverzugang prüfen.",
  missing: "Server lehnt Zugriff ab. Fahrt fehlt oder gehört einem anderen Konto.",
  conflict: "Serverkonflikt. Dieselbe ID besitzt andere Daten. Keine Änderung gesendet.",
  contract: "Ungültige Serverantwort oder Nutzlast abgelehnt. Kein Speicherbeleg bestätigt.",
  retry:
    "Versuchslimit erreicht. Verbindung prüfen; nach der Rückhaltefrist ausdrücklich erneut versuchen.",
};

function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = label;
  element.type = "button";
  element.addEventListener("click", action);

  return element;
}

function paragraph(value: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = value;

  return element;
}

function outboxText(item: OutboxItem): string {
  const state = item.state;
  const name = item.kind === "ride" ? `Fahrt ${item.id}` : "Profil";

  switch (state.kind) {
    case "stored":
      return `${name}: Auf Server gespeichert.${item.kind === "ride" ? " V1 ungeprüft, keine Belohnung." : ""}`;
    case "sending":
      return `${name}: Übertragung begonnen, noch kein dauerhafter Beleg. Nach Unterbrechung idempotent wiederholbar.`;
    case "queued":
      return `${name}: Dauerhaft vorgemerkt. Versuche ${state.attempts}/5. Frühester neuer Versuch ${new Date(state.retryAtMs).toLocaleTimeString("de-DE")}.`;
    case "blocked":
      return `${name}: Blockiert. ${failures[state.cause]}`;
    default: {
      const exhausted: never = state;

      return exhausted;
    }
  }
}

type Commands = Readonly<
  Pick<
    AccountSync,
    "subscribe" | "refresh" | "retry" | "claim" | "queueProfile" | "applyProfile" | "nextHistory"
  >
>;

type AccountView = Extract<AccountDataView, { readonly kind: "account" }>;

function profilePanel(view: AccountView, sync: Commands): HTMLElement {
  const host = document.createElement("div");
  const remote = view.profile;

  const message =
    remote.kind === "loading"
      ? "Serverprofil wird geladen …"
      : remote.kind === "failed"
        ? "Serverprofil nicht erreichbar. Lokales Profil bleibt unverändert."
        : remote.value.status === "missing"
          ? "Noch kein Serverprofil vorhanden."
          : `Serverprofil: ${remote.value.profile.displayName}, ${remote.value.profile.massKg} kg. Stand ${remote.value.updatedAt}.`;

  host.append(paragraph(message));
  host.append(
    button("Zuletzt lokal gespeichertes Profil ins Konto übernehmen", () => {
      if (
        window.confirm(
          `Zuletzt gespeichertes lokales Profil ausdrücklich für ${view.user.email} vormerken? Ungespeicherte Formularwerte werden nicht übernommen.`,
        )
      )
        void sync.queueProfile();
    }),
  );

  const pull = button("Serverprofil für nächste Fahrt lokal verwenden", () => {
    if (
      window.confirm(
        "Serverprofil lokal speichern und Formular ersetzen? Die laufende Fahrt bleibt unverändert.",
      )
    )
      void sync.applyProfile();
  });

  pull.disabled =
    remote.kind !== "ready" ||
    remote.value.status !== "present" ||
    view.outbox.kind !== "ready" ||
    view.outbox.value.some((row) => row.kind === "profile" && row.state.kind !== "stored");
  host.append(pull);

  return host;
}

function historyPanel(view: AccountView, sync: Commands): HTMLElement {
  const host = document.createElement("section");
  host.setAttribute("aria-label", "Serverfahrten dieses Kontos");
  const title = document.createElement("h3");
  title.textContent = "Serverfahrten dieses Kontos";
  host.append(title);

  if (view.history.kind !== "ready") {
    host.append(
      paragraph(
        view.history.kind === "loading"
          ? "Verlauf wird geladen …"
          : "Verlauf nicht erreichbar. Keine lokalen Fahrten automatisch hochgeladen.",
      ),
    );

    return host;
  }

  if (view.history.value.rides.length === 0) host.append(paragraph("Noch keine Serverfahrten."));
  const list = document.createElement("ul");

  for (const ride of view.history.value.rides) {
    const item = document.createElement("li");
    item.textContent = `${ride.startedAt} · ${(ride.distanceM / 1000).toFixed(2)} km · ${(ride.durationMs / 1000).toFixed(0)} s · ${ride.source === "sim" ? "Simulation" : "BLE"} · V1 ungeprüft · ${ride.rideId}`;
    list.append(item);
  }

  host.append(list);

  if (view.history.value.nextCursor !== null)
    host.append(
      button("Nächste Verlaufsseite", () => {
        void sync.nextHistory();
      }),
    );

  return host;
}

function localPanel(view: AccountView, sync: Commands): HTMLElement {
  const host = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "Lokale Fahrtkopien zuordnen";
  host.append(title);
  host.append(
    paragraph(
      "Das lokale V1-Archiv enthält keinen nachgewiesenen Aufnahme-Eigentümer. Erst Ihre Bestätigung ordnet eine unveränderliche Kopie diesem Konto zu. Keine automatische Zuordnung oder Strava-Veröffentlichung.",
    ),
  );

  for (const ride of view.local) {
    const item = document.createElement("div");
    item.dataset["localRideId"] = ride.rideId;
    item.append(
      paragraph(
        `${ride.startedAt} · ${ride.source === "sim" ? "Simulation" : "BLE"} · ${ride.rideId}`,
      ),
    );

    const claim = button("Fahrt diesem Konto zuordnen und synchronisieren", () => {
      if (
        window.confirm(
          `Diese lokale Fahrtkopie unwiderruflich ${view.user.email} zuordnen und synchronisieren? Die Aufnahme selbst enthält keinen nachgewiesenen Kontobesitzer.`,
        )
      )
        void sync.claim(ride.rideId);
    });

    claim.disabled =
      view.outbox.kind !== "ready" ||
      view.outbox.value.some((row) => row.kind === "ride" && row.id === ride.rideId.toLowerCase());
    item.append(claim);
    host.append(item);
  }

  host.append(queuePanel(view, sync));

  return host;
}

function queuePanel(view: AccountView, sync: Commands): HTMLElement {
  const host = document.createElement("section");
  host.setAttribute("aria-label", "Kontowarteschlange");
  const titleQueue = document.createElement("h3");
  titleQueue.textContent = "Kontowarteschlange";
  host.append(titleQueue);

  if (view.outbox.kind !== "ready") {
    host.append(
      paragraph(
        view.outbox.kind === "loading"
          ? "Kontowarteschlange wird geprüft …"
          : "Kontowarteschlange nicht bestätigt. Bitte aktualisieren.",
      ),
    );

    return host;
  }

  if (view.outbox.value.length === 0)
    host.append(paragraph("Keine diesem Konto zugeordneten Aufträge geladen."));

  for (const row of view.outbox.value) {
    const status = paragraph(outboxText(row));
    status.dataset["outboxId"] = row.id;
    host.append(status);
  }

  host.append(
    button("Vorgemerkte Aufträge erneut versuchen", () => {
      void sync.retry();
    }),
  );

  return host;
}

export function mountAccountDataPanel(sync: Commands): void {
  const host = document.querySelector("#account-data");

  if (host === null) return;
  sync.subscribe((view) => {
    const title = document.createElement("h2");
    title.textContent = "Kontodaten";
    host.replaceChildren(title);

    if (view.kind === "guest") {
      host.append(
        paragraph(
          "Zum Lesen oder ausdrücklichen Zuordnen anmelden. Lokale Aufnahme und TCX benötigen kein Konto.",
        ),
      );

      return;
    }

    const status = paragraph(view.message);
    status.setAttribute("role", "status");
    host.append(
      paragraph(
        `Daten für ${view.user.email}. Browserdaten sind kein Backup. Maximal 20 Outbox-Einträge; keine automatische Löschung.`,
      ),
      status,
      button("Kontodaten und lokales Archiv aktualisieren", () => {
        void sync.refresh();
      }),
      profilePanel(view, sync),
      historyPanel(view, sync),
      localPanel(view, sync),
    );
  });
}
