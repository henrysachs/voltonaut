# Spec E5-11 – Kontodaten exportieren und löschen

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E5, Checkbox „Daten-Export/Löschung“
- **Issue:** <https://github.com/henrysachs/voltonaut/issues/83>
- **Status:** Review
- **Betroffene Module:** `packages/shared`, `apps/server/src/{accounts,auth,economy,rides,strava,database}`, `apps/web/src/{sync,ui}`

## Ziel

Ein angemeldeter Kontoinhaber kann alle serverseitig gespeicherten eigenen Daten als JSON herunterladen und sein Konto mit ausdrücklicher Bestätigung löschen. Die Löschung entfernt serverseitige Fachdaten und Sessions, verhindert eine stille Neuanlage derselben Identität und bereinigt nur die zugeordneten lokalen Outbox-Einträge.

## Abnahmekriterien (aus der Roadmap übernommen und präzisiert)

- [x] AK1 – `GET /v1/me/export` verlangt eine gültige Session und liefert ausschließlich Daten des authentifizierten Kontos: Profil, Mitgliedschaft, verknüpfte Identitäten mit Issuer/Subject, vollständige eigene Aufnahmen mit Beleg/Bewertung, Strava-Status sowie den abgeleiteten Volts-Kontostand und das vollständige Volts-Journal in Progression. Inventar bleibt ehrlich `not_stored`. Antworten sind `no-store`; Sessions, Tokens und verschlüsselte Zugangsdaten erscheinen nicht. Korruptes oder unvollständig gespeichertes TCX führt zu einem kontrollierten Fehler statt zu einem lückenhaften Export.
- [x] AK2 – Ein fremdes Konto kann weder exportiert noch gelöscht werden. Es gibt keine Kontoparameter am Export- oder Löschpfad; die Löschung vergleicht die eingegebene Bestätigung mit der E-Mail der aktuellen Session und verlangt den exakten `CLIENT_ORIGIN`.
- [x] AK3 – `DELETE /v1/me` löscht nach Bestätigung atomar Profil, Mitgliedschaft, eigene Aufnahmen, Volts-Journal, Strava-Transaktionen/Verbindung/Aufträge, Identitätszuordnungen, offene Link-Transaktionen, Handoffs und Sessions. Der Nutzer bleibt nur als pseudonymer Löschtombstein; E-Mail und Identität werden durch serverseitig gekeyete HMACs gesperrt. Bearer- und Login-Tokens behalten normale SHA-256-Hashes.
- [x] AK4 – Nach der Löschung schlagen späte oder erneute Schreibversuche fehl. Datenbank-Trigger verhindern INSERT/UPDATE auf allen Tabellen mit `user_id`-Fremdschlüssel auf `users`; der Migrationstest leitet diese Menge aus SQLite-Metadaten ab. Magic-Link- und OIDC-Login mit derselben E-Mail bzw. Identität legen kein Konto still neu an. Ein später Link-Callback endet kontrolliert als ungültiger Login, nicht als Triggerfehler.
- [x] AK5 – Die Oberfläche erklärt vor dem Export und vor der Löschung, welche Serverdaten, Identitäten und externen Strava-Kopien betroffen sind. Die Löschung erfordert eine zweite ausdrückliche Bestätigung mit der E-Mail; ein fehlgeschlagener Aufruf räumt keine lokalen Daten.
- [x] AK6 – Nach bestätigter Serverlöschung werden nur Outbox-Einträge dieses API-Origin/Kontos entfernt, alle Fähigkeiten widerrufen und die Session lokal gelöscht. Lokale Fahrtarchive und das gemeinsame Gastprofil bleiben erhalten und werden ausdrücklich erklärt. Ein fehlgeschlagener lokaler Aufräumschritt wird dauerhaft für einen späteren Versuch vermerkt.

## Testplan (`docs/10-testing.md`)

| AK  | Ebene                          | Datei / Fixture                                                                                                                                  |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| AK1 | Contract + Integration Server  | `packages/shared/src/api/accounts.test.ts`, `apps/server/src/accounts/account-data.test.ts`                                                      |
| AK2 | Integration Server             | `apps/server/src/accounts/account-data.test.ts`                                                                                                  |
| AK3 | Integration Server + Migration | `apps/server/src/accounts/account-data.test.ts`, `apps/server/src/accounts/account-deletion-guards.test.ts`                                      |
| AK4 | Integration Server + Auth      | `apps/server/src/accounts/account-data.test.ts`, `apps/server/src/auth/oidc-deletion.integration.test.ts`, `apps/server/src/auth/tokens.test.ts` |
| AK5 | Unit UI + E2E                  | `apps/web/src/ui/accountDataPanel.test.ts`, `apps/web/src/ui/accountExportDownload.test.ts`, `apps/web/e2e/account-data.spec.ts`                 |
| AK6 | Unit Sync/Outbox + E2E         | `apps/web/src/sync/accountDeletion.test.ts`, `apps/web/src/sync/accountSyncDeletion.test.ts`, `apps/web/e2e/account-data.spec.ts`                |

## Nicht-Ziele

- Keine Einführung serverseitigen Inventars oder weiterer Progressvergabe. Das auf `main` vorhandene Volts-Ledger wird über schmale Economy-Ports exportiert und gelöscht; Inventar bleibt `not_stored`.
- Kein Export-Streaming oder spekulativer Umbau des Browser-Downloads. Der unbegrenzte synchrone Gesamtexport bleibt ein bewusster Tradeoff für den aktuellen kleinen Nutzerkreis.
- Keine automatische Löschung lokaler Fahrtarchive oder des gemeinsamen Gastprofils. Besitz und Nutzerentscheidung sind dort nicht accountgebunden.
- Keine Löschung bereits an Strava übertragener Aktivitäten. Der Export und die Löschbestätigung erklären diese externen Kopien.
- Keine neue Abhängigkeit, keine Änderung an Leitplanken.

## Offene Fragen / Risiken

- SQLite-Arbeit ist synchron, aber HTTP- und Strava-Scheduler-Arbeit kann asynchron über eine Löschung hinweggehen. Trigger und pseudonyme Tombstones sind deshalb zusätzlich zu Transaktionen nötig.
- Der Gesamtexport materialisiert alle eigenen Datensätze synchron ohne Pagination. Das ist nur für den aktuellen kleinen Nutzerkreis vertretbar; große Konten können Speicher, Event-Loop und Antwortzeit belasten. Der private HTTP-Client bricht nach acht Sekunden ab, dann ist kein vollständiger Download bestätigt. Streaming ist bewusst kein Teil dieses PR.
- Geht die HTTP-Antwort nach erfolgreicher Serverlöschung verloren, kann der Browser den Erfolg nicht nachfragen. Der Client meldet dies ausdrücklich; die ungültige Session verhindert weitere serverseitige Schreibvorgänge.
- Der externe Strava-Widerruf ist ein eigener Anbieteraufruf. Die lokale Löschung darf nicht an dessen Verfügbarkeit hängen; bereits übertragene Aktivitäten bleiben getrennt erklärt.

## Nachweisstand

- **Implementiert:** Export-/Löschvertrag einschließlich Identitäten und Volts-Journal, Servertransaktion über Economy-Ports, HMAC-Tombstones, metadatengeprüfte Trigger einschließlich späten Link-Callbacks, Browser-Overlay mit konkreten Anbietern und Outbox-Bereinigung. Korruptes TCX bricht den Export kontrolliert ab. `AccountDataOwner` ist ein lokaler Sync-Vertrag, kein Shared-API-Vertrag.
- **Am tatsächlichen Artefakt softwaregeprüft:** Fokussierte Contract-, Serverintegrations-, Migrations-, OIDC-, Sync- und UI-Tests belegen Exportinhalt, Fremddaten, Löschung, späte Ledger-/Link-Zugriffe, beide Rollback-Pfade, HMAC und Download-Lebenszyklus. Das vollständige Gate auf dem integrierten Head wird abschließend ausgeführt und erst danach hier mit Ergebnis vermerkt.
- **An echter Hardware geprüft:** nein, nicht hardwarerelevant.
- **Bereitgestellt:** nein, kein Produktionsdeploy in dieser Aufgabe.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Roadmap-Checkbox · [x] betroffene `docs/*.md` · ADR nicht nötig (keine neue Abhängigkeit oder Leitplankenänderung)
