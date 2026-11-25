# Spec E6-07 – Progress-Transport-, Quellen- und Tagespolitik

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E6, automatischer Fahrtfortschritt und Volts-Ledger.
- **Status:** Softwaregeprüft. Produktive Quellenpolitik und Hardwareabnahme offen.
- **Betroffene Module:** `packages/shared`, `apps/web/src/sync`, `apps/server/src/progress`, Dokumentation.

## Ziel

Die offenen Produktregeln für automatische, HR-freie Fahrtfortschritts-Checkpoints sind vor der ersten Serverbuchung entschieden. Die Regeln gelten für neue Progress-Journale; bestehende Aufnahmen, Identitäten und Zuordnungen bleiben unverändert.

## Entscheidungen

### Transport und Batching

- Ein lokaler Batch umfasst höchstens **120 native Facts** beziehungsweise **6 Sekunden** simulierter Tickzeit. Die Anzahl der Checkpoints ist kein eigenes Limit; bei einem Fact pro Checkpoint sind maximal 120 Checkpoints erlaubt. Er wird nach jedem Checkpoint fortlaufend gesichert; ein offener Batch wird ebenfalls fortlaufend gesichert.
- Ein Serverbereich fasst höchstens **zehn lokale Batches**, **1200 Checkpoints** beziehungsweise **1200 Facts** zusammen. Das Ziel sind **60 Sekunden** beziehungsweise 1200 Ticks.
- Pausierte Checkpoints werden in einem Batch zusammengeführt. Ein Versand wird nur beim Pause-Übergang ausgelöst, nicht bei jedem pausierten Wake.
- Zusätzliche Flush-Gründe sind Pause-Übergang, Fahrtende, UTC-Mitternacht, manuelles Synchronisieren und `pagehide`, soweit der Browser die Ausführung zulässt.
- Reihenfolge, Journal-UUID, Sequenz und Tickgrenzen bleiben über Reload und Wiederholung erhalten.

### Offline-Kapazität und Wiederholung

- Pro Konto und API-Origin sind maximal **1200 lokale Batches** gespeichert, ungefähr zwei Stunden bei 6-Sekunden-Batches.
- Es gibt keine stille Eviction. Bei voller Kapazität werden neue Checkpoints nicht persistiert; die Oberfläche zeigt einen blockierten Kapazitätszustand.
- Bestätigte Batches werden erst nach serverseitiger Quittung entfernt. Fehlgeschlagene Batches bleiben erhalten.
- Netzwerkfehler erhalten exponentielles Backoff und höchstens fünf automatische Versuche. Danach bleibt der Batch sichtbar blockiert; ein manueller Retry startet ein neues, ausdrücklich gewähltes Budget.

### UTC-Tagesgrenze

- Der Server bestimmt den Belohnungstag ausschließlich aus `endedAtMs` des letzten Checkpoints im Bereich.
- Der Client versucht, an UTC-Mitternacht zu flushen. Ein Bereich, der die Grenze überschreitet, wird vollständig dem Endtag zugerechnet.
- Der Belohnungstag wird nie vom Client akzeptiert. `endedAtMs` darf höchstens fünf Minuten in der Serverzukunft liegen; Offline-Lieferungen sind bis zu sieben Tage alt zulässig. Innerhalb eines Journals darf der Belohnungstag nicht zurückfallen.

### Quellen und Plausibilität

- Sim-Checkpoints werden weder persistiert noch hochgeladen; der Server lehnt `source: "sim"` zusätzlich ab.
- Automatische Kontobelohnung bleibt standardmäßig deaktiviert. Nur `RIDE_SOURCE_POLICY=declared_ble_v1` erlaubt `source: "ble"`.
- Erforderlich sind `clockScale === 1`, kein `clockSkipped`, terminales `dataAgeS <= 2,5` und eine ununterbrochene Tick-/Sequenzkette. Verletzt ein Bereich diese Regeln, wird er ohne Buchung abgewiesen; der Client stoppt die automatische Erfassung für dieses Journal und startet erst in der nächsten Fahrt ein neues.
- Native Werte werden nicht geklemmt. Für die Belohnungsannahme gelten die bestehenden effektiven Grenzen 0–2000 W und 0–200 rpm; negative Energie, inkonsistente Energiebeiträge oder Werte außerhalb dieser Grenzen lehnen den Bereich ab.
- `source: "ble"` und die Physikprüfung bleiben `client_declared`; sie sind kein Hardwareattest.

### Zustimmung, Konto und Session

- Die Zustimmung ist versioniert, widerrufbar und wird nur durch ausdrücklichen Nutzerklick gesetzt. Der Consent-Status meldet, ob die serverseitige Quellenpolitik Belohnungen überhaupt zulässt; bei deaktivierter Politik wird eine Aktivierung ohne Schreibzugriff abgewiesen.
- Ohne aktive Zustimmung werden keine Checkpoints persistiert oder hochgeladen.
- Aktivierung gilt ab der nächsten Engine-Sitzung, weil ein neues Journal bei Tick 0 beginnen muss. Ein Widerruf blockiert sofort neue Persistenz und Uploads; bereits bestätigte Bereiche bleiben erhalten. Ein laufendes Journal wird nicht neu numeriert oder einem anderen Konto zugeordnet.
- Das Journal bindet sich global an Konto und die serverseitige Session-Token-Generation (`sessionTokenHash`). Die lokale Browser-Generation fence nur asynchrone Arbeiten; derselbe Konto-Token kann nach Reload fortfahren.
- Kontowechsel, Logout oder neue Session lassen alte bestätigte Bereiche bestehen, verhindern aber neue Buchungen unter der alten Bindung.

### HR, manuelle Aufnahmen und Historie

- Der Progress-Vertrag bleibt HR-frei. Bestehende manuelle Aufnahmen und TCX-Exporte werden nicht verändert.
- Manuelle Uploads und Strava lösen keine zweite Progress-Belohnung aus.
- Automatisch bestätigte Bereiche werden nicht als synthetische Fahrten in `rides` eingefügt. Sie gehören zur Progress-Historie; ihre Darstellung folgt in #61.
- Volts werden bei Annahme eines Bereichs atomar über `EconomyService.creditRideRange` gebucht. XP/Level bleiben #60. Bei einem verlorenen HTTP-Ergebnis darf ein identischer Präfix eines größeren oder kleineren neuen Batchings denselben bereits gebuchten Beleg zurückliefern; nicht abgedeckte Batches bleiben anschließend versandbereit.

## Abnahmekriterien

- [x] AK1 – Bereichsgröße, Offline-Kapazität, Retry, UTC-Tag, Quellen-, Zustimmungs- und Historienregeln sind in Spec und ADR dokumentiert.
- [x] AK2 – Shared-Verträge erzwingen die strukturierten Grenzen; Tests belegen Tickfolge, Batchgröße und UUID-Normalisierung.
- [x] AK3 – Web-Outbox persistiert nur nach Zustimmung, nur für BLE, kontogebunden, idempotent und ohne stille Löschung.
- [x] AK4 – Server leitet Eigentümer und Belohnungstag aus Session beziehungsweise Checkpoint-Zeit ab und prüft Quellenpolitik, Consent und Session erneut in der Schreibtransaktion.
- [x] AK5 – Sim, Lücken, Überlappungen, fremde Journale, veraltete Consent und manipulierte Fakten werden ohne Buchung abgewiesen.
- [x] AK6 – Bestätigte Volts bleiben bei Reload, Wiederholung und Kontowechsel erhalten; manuelle Aufnahmen und Strava bleiben separat.

## Testplan

| AK  | Ebene                  | Datei / Fixture                                                                                         |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Review                 | Diese Spec, ADR-029                                                                                     |
| 2   | Vitest, Shared         | `packages/shared/src/api/progress.test.ts`, `rideProgress.test.ts`                                      |
| 3   | Vitest + Browser/IDB   | `apps/web/src/sync/progress*.test.ts`, `apps/web/e2e/progress-panel.spec.ts`, `progress-outbox.spec.ts` |
| 4–6 | Nest + SQLite + Replay | `apps/server/src/progress/*.test.ts`, bestehende Economy-/Migrationstests                               |

## Nicht-Ziele

- Keine HR-Progress-Verträge, neue TCX-Inhalte oder Änderung bestehender Archive.
- Keine vollständige Route-Geometrie-Reconstruction aus Checkpoints; die erste Serverprüfung ist deterministisch auf Tickfolge, Metadaten und Physikbeiträge.
- Keine XP-/Level-Buchung, Progress-UI mit Live-Vergütung oder Shop-Kauf.
- Keine Produktionsfreigabe der Quellenpolitik und keine Hardwareabnahme.

## Offene Fragen / Risiken

- Die vollständige Route-/Physik-Reconstruction benötigt zusätzliche Initialisierungs- und Wake-Belege; E6-04 liefert diese noch nicht.
- Die serverseitige Quellenpolitik bleibt produktiv deaktiviert, bis eine echte Hardwarefahrt freigegeben ist.
