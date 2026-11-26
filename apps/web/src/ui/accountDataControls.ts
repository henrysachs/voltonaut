import type { AccountExport, LinkedIdentity, User } from "@voltonaut/shared";
import { downloadAccountExport } from "./accountExportDownload.js";

type IdentityView =
  | { readonly kind: "loading" | "failed" }
  | { readonly kind: "ready"; readonly value: readonly LinkedIdentity[] };

interface DataControls {
  readonly exportAccount: () => Promise<AccountExport | undefined>;
  readonly deleteAccount: (confirmation: string) => Promise<boolean>;
}

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

function exportPanel(sync: Readonly<DataControls>): HTMLElement {
  const host = document.createElement("div");
  const status = paragraph("");

  const exportButton = button("Datenexport herunterladen", () => {
    exportButton.disabled = true;
    exportButton.setAttribute("aria-busy", "true");
    status.textContent = "Datenexport wird vorbereitet …";
    void (async () => {
      try {
        const value = await sync.exportAccount();

        if (value === undefined) {
          status.textContent = "Datenexport nicht bestätigt.";

          return;
        }

        downloadAccountExport(value);
        status.textContent = "Datenexport als JSON erstellt.";
      } catch {
        status.textContent = "Download fehlgeschlagen. Keine Datei bestätigt.";
      } finally {
        exportButton.disabled = false;
        exportButton.setAttribute("aria-busy", "false");
      }
    })();
  });

  status.setAttribute("role", "status");
  exportButton.setAttribute("aria-busy", "false");
  host.append(exportButton, status);

  return host;
}

function identityText(identities: IdentityView): string {
  if (identities.kind !== "ready")
    return "Verknüpfte Anbieter konnten noch nicht vollständig geladen werden.";

  return identities.value.length === 0
    ? "Keine externen Anbieter verknüpft."
    : `Konkret verknüpfte Anbieter: ${identities.value.map((identity) => identity.displayName).join(", ")}.`;
}

function deletionPanel(
  user: Readonly<User>,
  identities: IdentityView,
  sync: Readonly<DataControls>,
): HTMLElement {
  const host = document.createElement("div");
  const confirmation = document.createElement("input");
  confirmation.type = "email";
  confirmation.autocomplete = "email";
  confirmation.required = true;
  confirmation.setAttribute("aria-label", "E-Mail zur Löschbestätigung");
  const understood = document.createElement("input");
  understood.type = "checkbox";
  const understoodLabel = document.createElement("label");
  understoodLabel.textContent =
    " Ich habe verstanden, dass die Serverdaten und die Anmeldung dauerhaft gelöscht werden.";
  understoodLabel.append(understood);

  const deleteButton = button("Konto endgültig löschen", () => {
    if (confirmation.value.trim().toLowerCase() !== user.email.toLowerCase()) return;
    deleteButton.disabled = true;
    deleteButton.setAttribute("aria-busy", "true");
    confirmation.disabled = true;
    understood.disabled = true;
    void sync.deleteAccount(confirmation.value).finally(() => {
      deleteButton.setAttribute("aria-busy", "false");
    });
  });

  deleteButton.setAttribute("class", "btn btn--danger");
  deleteButton.setAttribute("aria-busy", "false");

  const updateDeleteState = (): void => {
    deleteButton.disabled =
      !understood.checked || confirmation.value.trim().toLowerCase() !== user.email.toLowerCase();
  };

  confirmation.addEventListener("input", updateDeleteState);
  understood.addEventListener("change", updateDeleteState);
  deleteButton.disabled = true;
  host.append(
    paragraph(identityText(identities)),
    paragraph(`Zur Bestätigung die E-Mail ${user.email} eingeben.`),
    confirmation,
    understoodLabel,
    deleteButton,
  );

  return host;
}

export function accountDataControls(
  user: Readonly<User>,
  identities: IdentityView,
  sync: Readonly<DataControls>,
): HTMLElement {
  const host = document.createElement("section");
  host.setAttribute("aria-label", "Kontodaten exportieren und löschen");
  const title = document.createElement("h3");
  title.textContent = "Kontodaten exportieren und löschen";
  host.append(
    title,
    paragraph(
      "Der Export enthält Profil, Mitgliedschaft, verknüpfte Identitäten mit Issuer und Subject, alle Serveraufnahmen mit Rohjournal, Beleg, Bewertung und vorhandenem TCX, Volts-Kontostand und vollständiges Volts-Journal, Fortschrittszustimmung mit bestätigten Fortschrittsbereichen sowie Strava-Status und Aufträge. Sessions und Zugangsdaten sind ausgeschlossen. Inventar ist serverseitig noch nicht gespeichert; der Export kennzeichnet dies ausdrücklich.",
    ),
    exportPanel(sync),
    paragraph(
      "Die Löschung entfernt Profil, Mitgliedschaft, alle Serveraufnahmen, das Volts-Journal, Fortschrittszustimmung und Fortschrittsbereiche, Strava-Verbindung und Aufträge sowie Identitätszuordnungen und Sessions. E-Mail und externe Identitäten bleiben nur als serverseitig gekeyete pseudonyme Löschmarken gesperrt; eine stille Neuanlage ist nicht möglich.",
    ),
    paragraph(
      "Lokale Fahrtarchive und das gemeinsame Gastprofil bleiben erhalten. Nur die diesem Konto zugeordneten Outbox-Einträge werden nach bestätigter Serverlöschung entfernt. Bereits an Strava übertragene Aktivitäten werden nicht gelöscht; der Anbieterzugriff ist getrennt in den Strava-Einstellungen zu prüfen.",
    ),
    deletionPanel(user, identities, sync),
  );

  return host;
}
