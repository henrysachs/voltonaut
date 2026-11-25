import type { SyncFailure } from "../sync/privateAuthTransport.js";

export const accountDeliveryFailures: Readonly<Record<Exclude<SyncFailure, "superseded">, string>> =
  {
    reauth: "Anmeldung abgelaufen. Abmelden und mit demselben Konto erneut anmelden.",
    forbidden: "Keine Berechtigung. Serverzugang prüfen.",
    missing: "Server lehnt Zugriff ab. Fahrt fehlt oder gehört einem anderen Konto.",
    conflict: "Serverkonflikt. Dieselbe ID besitzt andere Daten. Keine Änderung gesendet.",
    contract: "Ungültige Serverantwort oder Nutzlast abgelehnt. Kein Speicherbeleg bestätigt.",
    retry:
      "Versuchslimit erreicht. Verbindung prüfen; nach der Rückhaltefrist ausdrücklich erneut versuchen.",
  };
