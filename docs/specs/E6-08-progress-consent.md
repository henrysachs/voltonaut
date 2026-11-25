# Spec E6-08: Versionierte Progress-Zustimmung und Journalbindung

- **Roadmap-Bezug:** `docs/07-roadmap.md`, Abschnitt E6, Präzisierung vom 24.11.2026 zum automatischen Fahrtfortschritt.
- **Issue:** [Issue #57](https://github.com/henrysachs/voltonaut/issues/57).
- **Status:** Softwaregeprüft. Produktive Quellenpolitik und Hardwareabnahme offen.
- **Betroffene Module:** `packages/shared`, `apps/server/src/progress`, `apps/web/src/sync`, `apps/web/src/ui`.
- **Basis:** [E6-04](E6-04-ride-progress-journal.md), [E6-07](E6-07-progress-policy.md), [ADR-029](../decisions/ADR-029-progress-transport-policy.md). E6-05 bleibt Besitzer des Volts-Ledgers.

## Ziel

Der Nutzer kann die automatische Progress-Erfassung durch einen expliziten Klick aktivieren und widerrufen. Jedes Journal ist global genau einem Konto, einer serverseitigen Session-Token-Generation, einer Progress-Session-Generation und einer Consent-Version zugeordnet.

## Gewählte Form

- `packages/shared` definiert `ProgressConsentStateSchema`, `ProgressConsentUpdateSchema` und `ProgressSessionGenerationSchema`. Der State enthält `version`, `enabled`, `rewardsAvailable` und `sessionGeneration`. Das Update enthält ausschließlich `enabled` und `sessionGeneration`.
- `GET /v1/me/progress-consent` und `PUT /v1/me/progress-consent` sind authentifizierte `no-store`-Endpunkte. Die Mutation verlangt den exakten Origin. Ein fehlender Eintrag liefert Version 0 mit `enabled: false`. `rewardsAvailable` meldet die serverseitige Quellenpolitik; bei deaktivierter Politik wird Aktivierung ohne Schreibzugriff abgewiesen. Ein anderer Session-Hash erscheint als inaktiv und benötigt eine erneute ausdrückliche Bindung.
- `progress_consents` speichert pro Konto genau eine aktuelle, versionierte Zeile mit `user_id`, `version`, `enabled`, `session_hash`, `session_generation` und `updated_at`. Es gibt keine Append-only-Historie.
- `ProgressConsentService` erhöht die Version bei einer Änderung von `enabled` oder bei einem neuen serverseitigen Session-Token. Ein identisches Update mit demselben Token bleibt unverändert. Eine neue `sessionGeneration` aktualisiert die Zeile ohne Versionserhöhung, solange `enabled` und Token gleich bleiben.
- Der Server leitet `sessionTokenHash` aus `SessionPrincipal` ab. Client, API und UI berechnen oder übertragen keinen Token-Hash. Die Session wird innerhalb der unmittelbaren Schreibtransaktion erneut geprüft.
- `ride_progress_journals` verwendet `journal_id` als globalen Primärschlüssel. Die Spalten sind `user_id`, `session_hash`, `session_generation`, `consent_version`, `source`, `clock_scale`, `physics_revision`, `route_id`, `route_revision`, `physics_json`, `started_at_ms`, `last_end_tick`, `last_ended_at_ms`, `last_reward_day`, `cumulative_facts_json` und `created_at`.
- Die Bindung wird beim ersten akzeptierten Serverbereich angelegt. Identische Wiederholung erhält denselben Journal. Ein anderes Konto, ein anderer Token, eine andere Consent-Version, eine andere Session-Generation oder abweichende Metadaten überschreiben die Bindung nicht.
- Aktivierung gilt ab der nächsten Engine-Sitzung. Das laufende Journal beginnt bei Tick 0 und wird nicht nachträglich freigeben oder neu numeriert.
- Widerruf blockiert sofort neue Persistenz und Uploads. Bereits bestätigte Bereiche bleiben erhalten. Unbestätigte Batches bleiben gespeichert und sichtbar blockiert.
- Reload mit demselben Konto und Session-Token kann ausstehende Batches weiter liefern. Ein neuer Token oder Kontowechsel kann unter der alten Bindung keine neue Bereichsannahme auslösen.
- Consent-Steuerung und Bindungsstatus gehören ins Ingame-Menü. Die Oberfläche erhält keine Tokens, Hashes oder Rohfakten.

## Abnahmekriterien

- [x] AK1 – Ohne Klick liefert die Consent-Ansicht Version 0, `enabled: false` und eine positive `sessionGeneration`. `ProgressConsentUpdateSchema` akzeptiert nur `enabled` und `sessionGeneration`. Unbekannte Felder, fehlende Felder und ungültige Generationen werden abgewiesen.
- [x] AK2 – Die erste Aktivierung erzeugt Version 1. Ein identisches Update mit demselben Token lässt Version und Inhalt unverändert. Eine neue Generation bei gleichem `enabled` und Token aktualisiert nur Generation und Zeit. Ein Widerruf erhöht die Version.
- [x] AK3 – Ein neuer serverseitiger Session-Token erhöht die Consent-Version bei der nächsten Mutation. Ein abgelaufener oder widerrufener Token wird vor dem Schreibzugriff erneut abgewiesen. Ein abweichender Session-Hash meldet inaktive Bindung; deaktivierte Quellenpolitik meldet `rewardsAvailable: false` und blockiert Aktivierung.
- [x] AK4 – Aktivierung während einer laufenden Engine-Sitzung erzeugt keine nachträgliche Bindung für das aktive Journal. Die nächste Sitzung verwendet die neue Generation und ein neues Journal.
- [x] AK5 – Widerruf setzt `enabled: false`. Danach werden keine neuen Checkpoints persistiert und keine Batches hochgeladen. Bestätigte Volts und Journal-Highwater bleiben unverändert. Unbestätigte Batches werden nicht gelöscht.
- [x] AK6 – Eine Journal-UUID ist global eindeutig. Groß- und Kleinschreibung derselben UUID adressieren denselben Datensatz. Konto, Token, Consent-Version und Metadaten einer bestehenden Bindung lassen sich nicht überschreiben. Die gespeicherte Browser-Generation ist unveränderliche Metadaten, aber keine Autorisierungsgrundlage.
- [x] AK7 – Kontowechsel oder Logout ordnet keine Batches um. Nach Rückkehr zum selben Konto und Token sind die Batches weiter sichtbar. Ein neuer Token blockiert die alte Bindung, ohne bestätigte Bereiche zu entfernen.

## Testplan (`docs/10-testing.md`)

| AK     | Ebene                            | Datei / Grundlage                                                                                              |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1–3    | Vitest, Shared-Vertrag           | `packages/shared/src/api/progress.test.ts`                                                                     |
| 1–3, 5 | Nest-Integration, echte SQLite   | `apps/server/src/progress/progress.consent.test.ts`                                                            |
| 1–3    | Review                           | `apps/server/src/progress/progress.consent.service.ts`, `progress.consent.controller.ts`, `progress.schema.ts` |
| 4–7    | Nest-Integration, Journalbindung | `apps/server/src/progress/progress.binding.test.ts`, `progress.atomic.test.ts`                                 |
| 4–7    | Review                           | `apps/server/src/progress/progress.service.ts`, `progress.schema.ts`                                           |
| 4–5, 7 | Vitest, Begleittest zu           | `apps/web/src/sync/progressOutbox.ts`, `apps/web/src/sync/progressOutboxDatabase.ts`                           |

## Nicht-Ziele

- Keine lokale Batchbildung oder Serverbereichsannahme. Diese folgen in E6-09 und E6-10.
- Keine XP-/Level-Buchung, synthetische Fahrten, Progress-Historie nach #61 oder Shop-Freigabe.
- Keine Änderung an manuellen Aufnahmen, TCX, Strava oder bestehenden Identitäten.
- Keine vollständige Route-Reconstruction, Hardwareattestierung oder Produktionsfreigabe. Softwareprüfung, Hardwareabnahme und Bereitstellung bleiben getrennt.

## Risiken

- Die Consent-Tabelle speichert nur den aktuellen Stand. Sie ist kein vollständiges Auditprotokoll früherer Versionen.
- Ein Offline-Widerruf erreicht andere Geräte nicht. Ein fehlgeschlagener Mutationsaufruf darf keine neue Consent-Version vortäuschen und muss den unbestätigten Widerruf sichtbar benennen.
- Ein ausgeloggter Session-Token macht alte Batches dauerhaft unlieferbar. Sie bleiben erhalten und sichtbar blockiert. Eine spätere Migrationsregel braucht eine eigene Entscheidung.
- Consent ist eine Berechtigung, kein Quellen- oder Hardwarenachweis. Auch eine aktive Consent beweist keine echte BLE-Fahrt.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Spec angelegt.
- [x] Roadmap-Abschnitt E6 verlinkt diese Spec und den tatsächlichen Abschluss.
- [x] `docs/01-architecture.md` nennt Consent, globale Journalbindung und Session-Token-Generation als eigene State-Owner.
- [x] `docs/06-gamification.md` beschreibt Standarddeaktivierung, nächste Sitzung bei Aktivierung und sofortigen Widerruf.
- [x] `docs/08-backend.md` dokumentiert Endpunkte, aktuelle Consent-Zeile, Journalspalten, `no-store` und die Ableitung des Principals.
- [x] ADR-029 ist mit der Implementierung abgeglichen. Eine Abweichung benötigt einen neuen ADR.
