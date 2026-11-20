# Spec E10-03 – Serverseitige Strava-Verbindung

- **Roadmap-Bezug:** E10, Strava-Upload. Diese Einheit liefert nur dessen getrennte OAuth-Voraussetzung.
- **Status:** Serverseitiger Teilschnitt lokal geprüft. Gesamtgate, Build und erneuter Prozess-/Browsernachweis grün. Integration nach E0-04, kein echter Anbieterpilot.
- **Betroffene Module:** Server `strava`, Root-Konfiguration, Migration `0003`, gemeinsame API-Verträge.

## Ziel

Ein angemeldeter Nutzer kann Strava ausdrücklich verbinden, den eigenen Status lesen und die Verbindung trennen. Zugangsdaten verlassen das Servermodul nicht. Ein Browserwechsel des Voltonaut-Accounts darf keine fremde Verbindung bestätigen.

## Formen und Eigentümer

Form A ergänzt ein enges `strava`-Modul mit Transaktionen und verschlüsselten Verbindungen. Form B ergänzt ein allgemeines Integrationsregister mit Provideradaptern. Gewählt ist A. Es gibt genau einen Anbieter und noch keinen Uploadauftrag. `auth` bleibt Besitzer der Accounts und Sessions. `strava` besitzt ausschließlich OAuth-Transaktionen und Verbindungen. Der Composition Root übergibt die `users.id`-Spalte an die Tabellenfabrik.

Der öffentliche Status ist eine strikte Union aus `disabled`, `disconnected`, `pending`, `confirmation_expired`, `connected`, `credentials_unavailable` und `revocation_pending`. Private Tokens sind kein Teil dieses Vertrags. Eine Verbindung wechselt von `pending` nach `connected` nur mit frischem Bearer desselben Eigentümers und ursprünglichem Browsercookie. `revocation_pending` sperrt lokal vor jedem Netzwerkaufruf.

## Abnahmekriterien

- [x] AK1 – Standardmäßig deaktiviert. Aktivierung verlangt vollständige, geprüfte Konfiguration und einen kanonisch kodierten 32-Byte-Schlüssel. Produktionsregeln für Anmeldung und Mail bleiben unverändert.
- [x] AK2 – Start verlangt Bearer, exakten Origin und `{action:'connect'}`. Der Callback ist öffentlich, aber an gehashten State, Browser, Eigentümer und fünf Minuten Frist gebunden. Einmalige Beanspruchung geschieht vor HTTP.
- [x] AK3 – Der Callback speichert Zugangsdaten nur verschlüsselt als unbestätigt. Eine 60 Sekunden gültige Übergabe führt ausschließlich zur festen Abschlussadresse. Account B verbraucht die Übergabe von A nicht.
- [x] AK4 – Fehlende Rechte, ungültige Antworten, Replay, falsches Cookie, abgelaufene Fristen und Athletenkonflikte erzeugen keine aktive Verbindung. Ein Athlet gehört höchstens einem Voltonaut-Account. Kein automatischer Transfer oder Widerruf fremder Grants.
- [x] AK5 – AES-256-GCM nutzt zufällige 12-Byte-Nonces und bindet Eigentümer, Athlet und Schlüsselversion. Manipulation und falscher Schlüssel scheitern geschlossen. Datenbank, DTOs und Logs enthalten keine Klartexttokens.
- [x] AK6 – Trennen sperrt sofort und dauerhaft. Nur bestätigtes HTTP 200 von `/oauth/revoke` entfernt das Chiffrat. Fehler und Timeout erhalten `revocation_pending` samt erneut ausführbarem Widerruf.
- [x] AK7 – Additive Migration erhält bestehende Auth-, Profil- und Fahrtdaten. Echte Fremdschlüssel und Neustart sind geprüft. Keine Änderung an `0000` bis `0002`.
- [x] AK8 – Reale Nest-HTTP-Tests, lokaler Protokollanbieter und ausführbarer Nachweis des kompilierten Servers prüfen den Ablauf einschließlich Browser-CORS, Cookie und Accountwechsel. Kein echter Anbieteraufruf.

## Testplan

Tests liegen im Servermodul. Sie verwenden echte SQLite, Nest und lokale HTTP-Fakes statt Modul-Mocking. Ein eigenständiges Verifikationsskript startet das kompilierte Artefakt mit temporärer Dateidatenbank und ausschließlich erzeugten Testgeheimnissen. Der Parent führt das vollständige Repository-Gate und das unabhängige Review aus.

## Nicht-Ziele

Keine Webintegration, Fahrtannahme, Veröffentlichung, Uploadroute, Tokenaktualisierung, Webhooks, echten Zugangsdaten oder Infrastrukturänderungen. Alle vorhandenen V1-Fahrten bleiben ungeprüft. Anbieterzustimmung ist keine Zustimmung zum Fahrtupload.

## Risiken vor Aktivierung

App-Callbackdomain, Athletenkapazität, echte Zustimmung und Policyfreigabe sind ungeprüft. Der bekannte öffentliche Client-Identifier beweist nichts davon. Proxylogs müssen Callbackqueries auslassen. Datenschutzhinweise, externer Widerruf, Aufbewahrung und Löschung benötigen einen getrennten Pilot. Schlüsselverlust verhindert Entschlüsselung und verlangt operative Wiederherstellung oder ausdrückliche Neuverbindung nach externem Widerruf, keine Löschung eigener Fahrtdaten.

## Doku-Updates

- [x] Backendreferenz und Betriebsgrenzen.
- [x] ADR-017.
- [x] Lokaler Verifikationsbeleg. Roadmap-Upload bleibt offen.
