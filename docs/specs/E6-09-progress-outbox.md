# Spec E6-09: Lokale Progress-Outbox

- **Roadmap-Bezug:** `docs/07-roadmap.md`, Abschnitt E5, Client-Outbox mit Offline-Status, sowie Abschnitt E6, automatischer Fahrtfortschritt.
- **Issue:** [Issue #58](https://github.com/henrysachs/voltonaut/issues/58).
- **Status:** Softwaregeprüft. Echte Browser-IDB-Offlineprüfung und Hardwareabnahme offen.
- **Betroffene Module:** `apps/web/src/sync`, `apps/web/src/game`, `apps/web/src/ui`, `packages/shared`.
- **Basis:** [E6-04](E6-04-ride-progress-journal.md), [E6-07](E6-07-progress-policy.md), [E6-08](E6-08-progress-consent.md), [ADR-029](../decisions/ADR-029-progress-transport-policy.md).

## Ziel

Berechtigte BLE-Checkpoints bleiben über Netzwerkverlust, Reload und Kontowechsel erhalten. Der Nutzer sieht, welche Progress-Batches noch unbestätigt oder blockiert sind, ohne stille Löschung oder eine Doppelbuchung.

## Gewählte Form

- `apps/web/src/sync` besitzt die Progress-Outbox. Sie nutzt die eigene IndexedDB `voltonaut-progress-outbox`, Version 1, mit dem Object Store `batches` sowie Owner-, Journal-, Open-, Sequenz- und Statusindexen. Alle Zeilenmetadaten sind Pflicht. Da diese Datenbank noch nicht ausgeliefert wurde, gibt es keinen V1/V2-Upgrade-Pfad. Fahrtendatenbank und Konto-Outbox bleiben unangetastet.
- Eine Zeile enthält `apiOrigin`, `userId`, `journalId`, `consentVersion`, `sessionGeneration`, `revision`, `payload`, `hash`, `phase`, `state` sowie die abgeleiteten Metadaten `startTick`, `endTick`, `startSequence`, `endSequence`, `sequences`, `sequenceKeys`, `factCount` und `timeS`. Der Schlüssel ist `[apiOrigin, userId, journalId, startTick]`. Es gibt keine separate Batch-ID und keinen lokal berechneten Session-Token-Hash.
- `payload` ist ein lokaler `ProgressCheckpointBatch` mit `consentVersion`, `sessionGeneration` und 1 bis 120 Checkpoints. Der lokale Batch hat höchstens 120 Facts und 6 Sekunden simulierte Tickzeit. Pausierte Checkpoints werden zusammengeführt und versiegeln den Batch nicht.
- Der offene Batch wird nach jedem Checkpoint in derselben IDB-Transaktion fortgeschrieben. Ein versiegelter Batch ist unveränderlich. Pause-Übergang, Fahrtende, UTC-Mitternacht, manuelles Synchronisieren und `pagehide` sind zusätzliche Flush-Gründe, soweit der Browser sie ausführt.
- `groupProgressBatches` fasst zusammenhängende lokale Batches zu Serverbereichen mit höchstens 10 Batches, 1200 Checkpoints, 1200 Facts und 60 Sekunden zusammen. Consent-Version und Journal bleiben innerhalb eines Bereichs konstant; die Browser-Generation ist kein Gruppierungsmerkmal.
- Pro Konto und API-Origin sind maximal 1200 Zeilen erlaubt. Offene, versandbereite, blockierte und noch nicht aufgeräumte `stored`-Zeilen zählen mit. Es gibt keine Eviction. Bei voller Kapazität werden neue Checkpoints nicht persistiert und der Kapazitätszustand wird sichtbar blockiert.
- Die Zustände sind `queued`, `sending`, `blocked` und `stored`. `stored` ist die kurze Phase zwischen serverseitiger Quittung und Löschung. Außer der bestätigten Kontolöschung (E5-11) entfernt keine Operation eine unquittierte Zeile. Nach bestätigter Serverlöschung entfernt `purgeOwner` alle Zeilen genau dieses API-Origins und Kontos über den Kontoindex; scheitert das, bleibt der Aufräumauftrag für einen späteren Versuch vermerkt.
- Die Lieferung liest höchstens zehn ausstehende Zeilen pro Seite über den Primärschlüssel-Cursor. `prepareDelivery` versiegelt den offenen Batch und entfernt quittierte Zeilen über den Statusindex, ohne den ganzen Store zu lesen. `nextRetryAt` liest den frühesten automatischen Retry über den `account-retry`-Index. Nur ein ausdrücklicher Consent-Widerruf liest einmal alle ausstehenden Zeilen, um sie vollständig zu blockieren.
- Netzwerkfehler, 429 und 5xx erhalten exponentielles Backoff mit höchstens fünf automatischen Versuchen. Die Wartezeiten nach den Fehlversuchen 1 bis 4 sind 1, 2, 4 und 8 Sekunden. Nach dem fünften Fehler bleibt der Batch blockiert. Ein manueller Retry startet ein neues Budget.
- 401, 403, 404, 409 und Vertragsfehler blockieren ohne automatischen Retry. Ein Reload stellt einen früheren `sending`-Zustand als erneut versandbereit wieder her. Die serverseitige Idempotenz aus E6-10 macht einen verlorenen Quittungsfall unschädlich.
- Eine Quittung wird nur akzeptiert, wenn `receipt.journalId` zum Journal passt. Vollständig bedeckte Batches werden quittiert und gelöscht; ein nicht abgedeckter Rest eines größeren Retry-Batchings wird ohne Rücksetzen der Versuche erneut in `queued` überführt.
- Sim-Checkpoints werden weder persistiert noch versandt. Widerruf blockiert sofort neue Persistenz und Uploads. Bestehende unbestätigte Zeilen bleiben erhalten.
- `ProgressOutboxView` zeigt `ready` oder `blocked` mit `cause: "capacity"` und die Zähler `rows`, `queued`, `sending`, `blocked`, `stored`, `open` und `remaining`. Die Darstellung gehört ins Ingame-Menü. Die Fahrt läuft beim Öffnen weiter.

## Abnahmekriterien

- [x] AK1 – 119 Facts erzeugen einen offenen Batch. Der 120. Fact schließt ihn. Ein separater Lauf mit 6 Sekunden schließt vor Erreichen von 120 Facts. Kein lokaler Batch überschreitet 120 Facts oder 6 Sekunden. Bei einem Fact pro Checkpoint sind höchstens 120 Checkpoints erlaubt.
- [x] AK2 – Nach jedem Checkpoint ist der offene Batch in `voltonaut-progress-outbox` nachlesbar. Nach Reload sind Tickgrenzen, Sequenz, Journal-UUID und Fakten bytegleich. Versiegelte Batches lassen sich nicht überschreiben.
- [x] AK3 – 1200 Zeilen für ein Konto und einen API-Origin werden akzeptiert. Die 1201. Zeile wird ohne Schreibzugriff abgewiesen. Alle vorherigen Zeilen und Hashes bleiben erhalten. Ein anderer Origin und ein anderes Konto haben getrennte Kapazität.
- [x] AK4 – Ein Kontowechsel ordnet keine Zeile um. Konto A sieht seine Zeilen nach Rückkehr wieder, Konto B sieht sie nicht. Derselbe Session-Token kann nach Reload erneut liefern. Ein neuer Session-Token blockiert alte Zeilen serverseitig, statt sie zu löschen oder unter der neuen Bindung zu senden.
- [x] AK5 – Fünf automatische Fehlversuche verwenden die Wartezeiten 1, 2, 4 und 8 Sekunden bis zum jeweils nächsten Versuch. Der sechste automatische Versuch findet nicht statt. Nach dem fünften Fehler ist `blocked` sichtbar. Manueller Retry startet wieder bei Versuch 1.
- [x] AK6 – Ein verlorener HTTP-Erfolg wird idempotent wiederholt. Erst eine Quittung mit passendem Journal und deckendem Tickbereich führt zur Löschung. Ein fehlendes oder falsches Quittungsfeld lässt die Zeile erhalten.
- [x] AK7 – `queued`, `sending`, `blocked`, `stored`, offene Zeilen und verbleibende Kapazität sind im Menü sichtbar. Sim erzeugt auch bei aktivem Consent keine IDB-Zeile und keinen Progress-Request. Das Öffnen des Menüs stoppt die Engine nicht.
- [x] AK8 – Pause, Fahrtende, UTC-Mitternacht und manuelles Synchronisieren flushen den offenen Batch. `pagehide` ist best effort. Ein Fehlschlag der IDB-Schreiboperation erzeugt keinen Scheinerfolg und verdrängt keine vorhandene Zeile.
- [x] AK9 – Nach Widerruf werden keine neuen Checkpoints persistiert und keine Batches versandt. Bestätigte Bereiche bleiben erhalten. Unbestätigte Batches bleiben sichtbar und werden nicht automatisch gelöscht.
- [x] AK10 – Append liest nur die eigene Journalzeile, Sequenz und Owner-Kapazität über IndexedDB-Schlüssel; ein deterministischer 1200-Checkpoint-Probelauf bleibt innerhalb des 50-ms-Wake-Budgets. Der offene Batch wird pro Append nur einmal an der IndexedDB-Grenze vollständig geprüft. Lokal sinkt der Probelauf damit von etwa 3,3/7/10 ms auf 1,0/2,0/4,8 ms (Median/p95/max); in CI lag das Maximum vorher bei 52–78 ms. Browser-Leistung wird daraus nicht behauptet.

## Testplan (`docs/10-testing.md`)

| AK        | Ebene                                     | Datei / Grundlage                                                                          |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1         | Vitest, lokale Batchgrenzen               | `apps/web/src/sync/progressBatch.test.ts`                                                  |
| 2–4, 8    | Vitest, Outbox und IDB                    | `progressOutbox.test.ts`, `progressOutboxDatabase*.test.ts`                                |
| 5–7, 9    | Vitest, Versand und Widerruf              | `progressOutboxDatabase.delivery.test.ts`, `progressSync.test.ts`                          |
| 1, 6      | Vitest, Shared-Vertrag                    | `packages/shared/src/api/progressBatch.test.ts`                                            |
| 4, 6      | Nest-Integration, Quittung und Idempotenz | `apps/server/src/progress/progress.range.test.ts`, `progress.api.test.ts`                  |
| 2–4, 6, 8 | Playwright, UI, Sim und echte IDB         | `progress-panel.spec.ts`, `progress-outbox.spec.ts`; echte IDB-Offlineprüfung bleibt offen |

## Nicht-Ziele

- Keine serverseitige Validierung, Quellenfreigabe oder Volts-Buchung. Diese gehören zu E6-10.
- Keine Änderung an `voltonaut-local-rides`, der Konto-Outbox, manuellen Aufnahmen, TCX oder Strava.
- Keine stille Löschung, automatische Kontozuordnung oder nachträgliche Umnummerierung eines Journals.
- Keine vollständige Route-Reconstruction, Hardwareattestierung oder Produktionsfreigabe. Die 1200 Zeilen sind bei vollen 6-Sekunden-Batches ungefähr zwei Stunden, keine garantierte Zeitdauer bei Teilbatches oder Blockaden.

## Risiken

- IDB-Quota, beschädigte Zeilen oder ein gesperrtes Upgrade können neue Checkpoints blockieren. Die Outbox darf dann keine Speicherzusage machen und muss den Fehler sichtbar machen.
- `pagehide` garantiert keine asynchrone Ausführung. Die Persistenz nach jedem Checkpoint trägt den letzten verlässlichen Stand.
- Alte Batches eines ausgeloggten Tokens belegen weiterhin Kapazität. Eine Lösch- oder Migrationsregel würde bisherige Nutzerdaten betreffen und braucht eine eigene Freigabe.
- Mehrere Tabs können gleichzeitig liefern. IDB-Transaktionen, stabile Journal-/Tick-Schlüssel und serverseitige Idempotenz müssen Doppelzahlungen verhindern.
- Die sichtbare Zustandsanzeige ist kein Hardware- oder Netzwerkattest. Sie benennt nur den lokalen Lieferstand.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Spec angelegt.
- [x] Roadmap-Abschnitte E5 und E6 nennen die Progress-Outbox und ihren tatsächlichen Abschluss.
- [x] `docs/01-architecture.md` trennt Progress-Outbox, Fahrtendatenbank und Konto-Outbox.
- [x] `docs/06-gamification.md` beschreibt unbestätigte Offline-Batches, Kapazität, Widerruf und sichtbare Blockaden.
- [x] `docs/08-backend.md` nennt Quittungs- und Idempotenzanforderungen an E6-10.
- [x] `docs/10-testing.md` dokumentiert die echte IndexedDB-Prüfung und die noch offene Offline-Reload-Prüfung.
- [x] ADR-029 ist mit Batchgrößen, Kapazität und Retry-Verhalten abgeglichen.
