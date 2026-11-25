# Spec E0-06 – Strava-Auslieferungsschritt hinter einem Modul

- **Roadmap-Bezug:** E0, Architekturpflege; fachlich E10-04 (Strava-Auslieferung), ohne neue Roadmap-Checkbox
- **Status:** Review
- **Betroffene Module:** `apps/server/src/strava`

## Ziel

Ein fälliger Strava-Schritt (Upload, Verarbeitungspoll, Autorisierungshinweis) läuft vollständig in `StravaDeliveryStep`: Credential-Lease, Refresh, Budgetreservierung und -abrechnung, Dispatchcommit, Anbieteraufruf, Ergebnisvermerk und Freigabe. `StravaScheduler` besteht nur noch aus Schleife und Abbau. Ein Upload-POST ist nur mit einem festgeschriebenen Versuch aufrufbar. Eine Reservierung ohne gesendete Anfrage wird zurückgegeben.

## Abnahmekriterien

- [x] AK1 – `StravaDeliveryStep` besitzt `submitNext`, `pollNext` und `checkNextHint`. Claim/try/finally/release und reserve/observe stehen je genau einmal im Modul (`leased`, `reserve`). `StravaScheduler` hat zwei Abhängigkeiten statt acht. `StravaAuthorization` enthält keinen Hinweisschritt mehr.
- [x] AK2 – `StravaProvider.submit` verlangt einen `CommittedAttempt`. Das ist eine nicht exportierte Klasse mit `#`-Feld im Modul `strava.delivery-store.ts`; nur `dispatch` konstruiert sie. Literale und Spread-Kopien (`{ ...attempt, externalId }`) sind kein `CommittedAttempt` (Typtests). Die `external_id` stammt aus dem Versuch. Die Mehrfachverwendung eines einzelnen Versuchs verhindert weiterhin nur der einzige Aufrufer in `StravaDeliveryStep`, nicht der Typ.
- [x] AK3 – Stoppt ein anderer SQLite-Besitzer die vorbereitete Fahrt, lehnt `dispatch` den Commit ab und es erfolgt kein POST. Die Budgetzeile hat danach weder Nutzung noch offene Reservierung. Der Test schlägt ohne die Korrektur fehl (`shortUsage`/`dayUsage`/`*Pending` = 1).
- [x] AK4 – Zwei gleichzeitig taktende Besitzer mit getrennten SQLite-Verbindungen: nur einer erhält das Preparing-Lease, es gibt genau einen POST. Den Wettlauf um den Dispatchcommit selbst belegt `strava.delivery-store.test.ts`. Der Auftrag steht danach auf `processing` mit Upload-ID. Die Reservierung ist über Antwortheader abgerechnet (`dayUsage` 1, `dayPending` 0), die Lease ist frei.
- [x] AK5 – Ein verlorenes, fehlerhaftes oder ungültiges POST-Ergebnis bleibt `submission_unknown` und wird von keinem Besitzer erneut versendet (ADR-018, Glossar „Unklare Strava-Auslieferung“).
- [x] AK6 – Sagt das dauerhafte Budget „warten“, entsteht kein Versuch. Der Auftrag ist bis zum Budgetzeitpunkt zurückgestellt, die Lease frei.
- [x] AK7 – Ein bekannter Upload wird per Poll bestätigt. Upload und Poll sind über Header abgerechnet, ohne offene Reservierung.
- [x] AK9 – Eine nicht entschlüsselbare Hinweisverbindung erhält vor der Entschlüsselung die 60-s-Sperrfrist. Eine zweite gesunde Hinweisverbindung wird in den folgenden Takten geprüft, ohne offene Reservierung. Der Test schlägt ohne die Korrektur fehl.
- [x] AK10 – `StravaRateStore.release` zieht nur im Fenster der Reservierung ab und lässt die beobachtete Nutzung eines anderen Besitzers stehen (Unit-Tests).
- [x] AK8 – Bestehende Scheduler-, Hinweis-, Race- und Loopback-Anbietertests laufen unverändert in ihren Aussagen. Sie verwenden nur die neue Verdrahtung (`step.checkNextHint` statt `authorization.tick`).

## Testplan (`docs/10-testing.md`)

| AK       | Ebene                                                           | Datei / Fixture                                                                                   |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| AK1      | Typecheck, Review                                               | `strava.delivery-step.ts`, `strava.scheduler.ts`                                                  |
| AK2      | Typtest                                                         | `strava.delivery-step.test.ts`                                                                    |
| AK3–AK7  | Integration: SQLite-Datei, zwei Verbindungen, Loopback-Anbieter | `strava.delivery-step.test.ts`, `strava.scheduler-fixture.spec.ts`, `strava.step-fixture.spec.ts` |
| AK9      | Integration                                                     | `strava.delivery-step.test.ts`                                                                    |
| AK10     | Unit                                                            | `strava.rate-store.test.ts`                                                                       |
| AK5, AK8 | Integration                                                     | `strava.upload-provider.test.ts`, `strava.scheduler*.test.ts`, `strava.authorization.test.ts`     |

`strava.upload-provider.test.ts` spielt die Abfolge prepare → claim → dispatch → submit → submitted nicht mehr von Hand nach. Diese Tests laufen jetzt über `StravaDeliveryStep` mit echter gespeicherter Fahrt und echtem TCX. Der Mehrbesitzer-Nachweis „nie erneut senden“ liegt in `strava.delivery-step.test.ts`.

## Nicht-Ziele

- Keine Zusammenlegung von `strava.store`, `strava.credential-store` und `strava.authorization-store`.
- Kein generisches Integrationsframework (ADR-017). Keine Änderung an ADR-018 oder ADR-022.
- Der Widerruf in `StravaService.disconnect` bleibt dort. Er nutzt kein Budget und keinen Auftrag.

## Offene Fragen / Risiken

- Verhaltensänderung neben AK3: Beim Hinweis wird das Access-Token jetzt nach der Sperrfrist, aber vor der Reservierung entschlüsselt. Schlägt die Entschlüsselung fehl, bleibt das Budget unberührt, die Sperrfrist ist gesetzt und andere Hinweise laufen weiter (AK9).
- Bekannt und bewusst belassen: `strava.provider.ts` und `strava.delivery-store.ts` importieren sich gegenseitig nur über Typen (kein Laufzeitzyklus, depcruise und oxlint grün). `prepareDueDeliveries` liegt in `strava.delivery-state.ts`, um die 300-Zeilen-Grenze des Stores einzuhalten.
- Die Typsperre schützt nur innerhalb von TypeScript. Ein `as` mit `// SAFETY:` könnte sie umgehen; Review muss das ablehnen.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Keine Roadmap-Checkbox betroffen · [x] `docs/08-backend.md` · [x] `GLOSSARY.md` („Festgeschriebener Strava-Versuch“) · [x] kein ADR nötig (keine neue Entscheidung, Leitplanke oder Abhängigkeit)
