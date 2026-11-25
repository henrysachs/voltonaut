# Spec E6-10: Serverseitige Progress-Annahme

- **Roadmap-Bezug:** `docs/07-roadmap.md`, Abschnitt E6, automatische Fahrtabschnitte und Checkbox „`economy/`: Volts-Ledger, Verdienformel, Tageslimit".
- **Issue:** [Issue #59](https://github.com/henrysachs/voltonaut/issues/59).
- **Status:** Softwaregeprüft. Produktive Quellenpolitik und Hardwareabnahme offen.
- **Betroffene Module:** `packages/shared`, `apps/server/src/progress`, `apps/server/src/economy`, `apps/server/src/auth`, Dokumentation.
- **Basis:** [E6-04](E6-04-ride-progress-journal.md), [E6-05](E6-05-volts-ledger.md), [E6-07](E6-07-progress-policy.md), [E6-08](E6-08-progress-consent.md), [ADR-027](../decisions/ADR-027-server-volts-ledger.md), [ADR-029](../decisions/ADR-029-progress-transport-policy.md).

## Ziel

Der Server nimmt begrenzte, zusammenhängende Progress-Bereiche nur bei gültiger Bindung, Consent und Quellenpolitik an. Ein akzeptierter Bereich bucht Volts atomar über `economy/`, ohne XP, synthetische Fahrten oder eine zweite Belohnung für manuelle Aufnahmen.

## Gewählte Form

- `POST /v1/progress/checkpoints` ist ein authentifizierter, `no-store`-Endpunkt. Die Anfrage ist genau `{consentVersion, sessionGeneration, checkpoints}` mit 1 bis 1200 Checkpoints und höchstens 1200 Facts.
- Die Antwort ist genau `{range: VoltsRideRangeReceipt}`. Sie enthält keine Batch-IDs und kein `assurance`-Feld. Die Quelle bleibt intern `client_declared`.
- `ProgressCheckpointBatchSchema` normalisiert Journal-UUIDs und prüft innerhalb des Bereichs Sequenz, Tickfolge, Zeitfolge und unveränderliche Metadaten. Die lokale Begrenzung auf 6 Sekunden je Batch ergibt mit höchstens zehn Batches höchstens 60 Sekunden je Serverbereich.
- `validateProgressBatch` prüft `source: "ble"`, `clockScale === 1`, kein `clockSkipped`, `dataAgeS <= 2,5`, Tickzeit 0 oder 0,05 Sekunden, Leistung 0 bis 2000 W, Kadenz 0 bis 200 rpm und nichtnegative Energie. Pausierte Facts haben keine Strecken-, Höhen- oder Energiebeiträge. Die Energie darf höchstens `1e-6` kJ von `(powerW * timeS) / 1000` abweichen.
- Der Server aggregiert die bestehenden `RewardFacts` aus dem akzeptierten Präfix. Die Aktivitätsfelder verwenden die bestehende Aggregatdefinition, ohne XP oder Level zu buchen. Kumulation, Rundung und Tageslimit bleiben Sache von E6-05.
- Der erste Bereich beginnt bei Tick 0. Weitere Bereiche beginnen an `last_end_tick`. `last_ended_at_ms` und `last_reward_day` dürfen nicht zurückfallen. Der Belohnungstag ist das UTC-Datum des letzten `endedAtMs`. Ein Mitternachtsbereich zählt vollständig zum Endtag.
- Späte Offline-Lieferungen sind bis zu sieben Tage alt zulässig. `endedAtMs` darf höchstens fünf Minuten in der Serverzukunft liegen. Innerhalb eines Journals wird zusätzlich ein Tagesrückschritt gegenüber dem letzten bestätigten Bereich abgewiesen.
- `RIDE_SOURCE_POLICY` bleibt standardmäßig `disabled`. Nur `declared_ble_v1` erlaubt `source: "ble"`. Sim wird auch bei aktivierter Policy abgewiesen.
- Die Schreibtransaktion prüft die aktive Session sowie die aktuelle Consent-Zeile. `enabled` muss true sein, `consentVersion` und `sessionHash` müssen zum authentifizierten Principal passen. `sessionGeneration` ist lokale Metadaten und keine Serverautorität. Weitere Bereiche desselben Journals können nach Reload eine neue Browser-Generation enthalten; die gespeicherte Journalbindung bleibt unverändert. Ein Widerruf blockiert sofort neue Annahmen.
- `ride_progress_journals` speichert Bindung und Highwater mit `last_sequence`, `last_end_tick`, `last_ended_at_ms`, `last_reward_day` und `cumulative_facts_json`. `ride_progress_ranges` speichert je angenommenem Bereich den kanonischen Batch-Hash, die kanonischen Checkpoints, die kumulierten Fakten und den unveränderlichen Volts-Beleg; eindeutig sind Journal/Start und Journal/Ende.
- `ProgressService` nutzt `EconomyService.transaction`. `EconomyService.creditRideRange` schreibt den akzeptierten Bereich ins Volts-Ledger. Der Journalschreibzugriff erfolgt in derselben unmittelbaren Transaktion. `progress/` schreibt keine Ledger-Tabelle.
- Identische Wiederholung liefert denselben Volts-Beleg. Ist ein bereits gebuchter Checkpoint-Präfix Teil eines größeren neuen Batchings oder ist die neue Nutzlast ein Präfix des bereits gebuchten Bereichs, liefert der Server ebenfalls denselben Beleg. Der Client quittiert nur die abgedeckten Zeilen. Eine davon abweichende Nutzlast, eine Lücke oder eine Überlappung liefert 409 ohne Buchung. Bestätigte Bereiche erzeugen keine `rides` und keine XP-/Level-Buchung.

## Abnahmekriterien

- [x] AK1 – Die Shared-Schemas akzeptieren 1 bis 1200 Checkpoints und höchstens 1200 Facts. 1201 Checkpoints, 1201 Facts, fehlende Felder, unbekannte Felder und ungültige UUIDs werden ohne Schreibzugriff abgewiesen. Die Antwort enthält ausschließlich `range`.
- [x] AK2 – Ein gültiger Bereich hat eine durchgehende Sequenz und Tickkette. Der erste Bereich beginnt bei Tick 0 und Sequenz 0. Weitere Bereiche setzen am Highwater fort. Lücke, Überlappung, Duplikat, Zeitrückschritt oder gemischte Metadaten liefern keine Annahme.
- [x] AK3 – Mit Standardkonfiguration `disabled` wird kein Progress-Bereich gebucht. Mit `declared_ble_v1` wird nur `source: "ble"` angenommen. Sim bleibt in beiden Konfigurationen blockiert.
- [x] AK4 – Konto und `sessionTokenHash` kommen aus der authentifizierten Session. Ein fremdes Journal, ein neuer Token, eine andere Consent-Version, fehlende Consent oder deaktivierte Consent wird in der Schreibtransaktion abgewiesen. Die Browser-Generation ist kein Autorisierungsmerkmal.
- [x] AK5 – Der Server bestimmt den Belohnungstag aus dem letzten `endedAtMs`. Ein Mitternachtsbereich zählt vollständig zum Endtag. Ein Tagesrückschritt, mehr als fünf Minuten Serverzukunft oder mehr als sieben Tage Offline-Alter werden abgewiesen. Jüngere späte Offline-Lieferungen werden angenommen, solange das Journal nicht zurückfällt.
- [x] AK6 – Leistung, Kadenz, Tickzeit und Energie werden ohne Klemmen geprüft. Werte außerhalb der Grenzen, andere Tickzeiten als 0 oder 0,05 Sekunden, negative Energie, Energiebeiträge mit mehr als `1e-6` kJ Abweichung, Regress der kumulativen Fakten oder Überschreitung der Shared-Aggregatgrenzen werden ohne Buchung abgewiesen.
- [x] AK7 – Journal-Highwater und Volts-Beleg committen oder rollen gemeinsam zurück. Eine identische Wiederholung erzeugt genau einen Ledger-Eintrag und denselben Beleg. Ein größeres oder kleineres Retry-Batching mit identischem bereits gebuchtem Präfix liefert denselben Beleg; ein nicht präfixförmiger Hash, eine Lücke oder eine Überlappung erzeugt 409.
- [x] AK8 – Nach einem akzeptierten Bereich bleiben die Volts über Reload und SQLite-Neustart erhalten. `progression`, XP, Level, Badges, PBs und `rides` bleiben unverändert. Manuelle Uploads und Strava lösen keinen zweiten Progress-Ledger-Eintrag aus.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene                                 | Datei / Grundlage                                                                                          |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1        | Vitest, Shared-Vertrag                | `packages/shared/src/api/progressBatch.test.ts`, `progressConsent.test.ts`                                 |
| 1–2, 5–7 | Nest-Integration, echte SQLite        | `progress.api.test.ts`, `progress.range.test.ts`, `progress.atomic.test.ts`, `progress.reward-day.test.ts` |
| 2, 6     | Vitest, deterministische Validierung  | `apps/server/src/progress/progress.validation.test.ts`                                                     |
| 3–5, 7   | Review                                | `progress.service.ts`, `progress.controller.ts`, `progress.schema.ts`, `progress.range-store.ts`           |
| 4        | Nest-Integration, Consent und Session | `apps/server/src/progress/progress.consent.test.ts`, `progress.binding.test.ts`                            |
| 7        | Nest-Integration, Economy-Transaktion | `apps/server/src/economy/economy.transaction.test.ts`, `economy.range-validation.test.ts`                  |
| 7–8      | Persistenz und Konkurrenz             | `apps/server/src/economy/economy.persistence.test.ts`, `economy.concurrency.test.ts`                       |
| 8        | Regression, bestehende Fahrten        | `apps/server/src/rides/rides.test.ts`, `apps/server/src/progress/progress.api.test.ts`                     |

## Nicht-Ziele

- Keine vollständige Route-, Initialisierungs- oder Wake-Reconstruction. Die erste Prüfung ist deterministisch für Tickfolge, Metadaten und Physikbeiträge.
- Keine Hardwareattestierung. Eine konsistent erfundene BLE-Selbstauskunft kann mit diesen Prüfungen weiterhin nicht erkannt werden.
- Keine XP-/Level-Buchung, synthetischen `rides`, Progress-UI nach #61 oder Shop-Kauf.
- Keine doppelte Belohnung über manuelle Aufnahmen, TCX oder Strava. Keine Nachbewertung bestehender Fahrten.
- Keine produktive Aktivierung von `RIDE_SOURCE_POLICY`, kein Deployment und keine Hardwareabnahme.

## Risiken

- Die Quellenangabe bleibt `client_declared`. Numerische Konsistenz ist kein Nachweis echter Leistung oder echter Hardware.
- Fehlende Initialisierungs- und Wake-Belege verhindern einen vollständigen Replay. Spätere Route-Prüfungen benötigen einen neuen Vertrag.
- Eine späte Offline-Lieferung bucht auf ihren ursprünglichen Belohnungstag. Das Tageslimit gilt weiterhin für diesen Tag.
- Consent und Session werden unmittelbar vor dem Schreibzugriff geprüft. Auth darf dabei nicht über eine zweite Verbindung oder eine spätere Prüfung außerhalb der Transaktion erfolgen.
- SQLite-Write-Konkurrenz kann `SQLITE_BUSY` erzeugen. Ein Fehler darf weder Highwater noch Volts verändern.
- Die Consent-Tabelle enthält nur den aktuellen Stand. Ein Widerruf ist deshalb keine historische Consent-Auditreihe.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Spec angelegt.
- [x] Roadmap-Abschnitt E6 verlinkt diese Spec und unterscheidet implementierte, softwaregeprüfte, hardwaregeprüfte und bereitgestellte Schritte.
- [x] `docs/01-architecture.md` nennt `progress/` als Besitzer von Consent, Journalbindung, Highwater und kumulativen Fakten.
- [x] `docs/06-gamification.md` beschreibt atomare Volts-Buchung ohne XP und ohne synthetische Fahrten.
- [x] `docs/08-backend.md` dokumentiert API, Journalspalten, Quellenpolitik, Consent-/Session-Recheck, Offline-Tagesregel und Fehlerfälle.
- [x] `docs/10-testing.md` ergänzt Bereichsgrenzen, echte SQLite-Konkurrenz und Wiederholungsprüfungen.
- [x] ADR-027 und ADR-029 sind mit der tatsächlichen Transaktions- und Validierungsform abgeglichen.
