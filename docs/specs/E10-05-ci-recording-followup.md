# Spec E10-05 – CI-Nachprüfung der Fahrtlieferung

- **Roadmap-Bezug:** E10, Softwareprüfung der Strava-Integration aus E10-04.
- **Basis:** `bd58752b8a7ddef8b18b4e40c9e9e66d75609d0f`.
- **Status:** Implementiert, lokal geprüft und unabhängig freigegeben. Exakte Head-CI bleibt vor Merge bindend. Renderursache aus #26 weiterhin offen. Laufender Fahrstand bleibt getrennt unverändert.
- **Betroffene Module:** Server-Replay-Test und Diagnose des Renderstarts im Menü-E2E. Keine beauftragte Änderung an Physik, Grafikqualität oder Leitplanken.

## Ziel

Das unveränderte Gesamtgate soll dieselben Fahrtaussagen ohne überflüssige Testarbeit prüfen. Ein erneuter grüner Lauf allein belegt keine behobene Renderursache.

## Befunde

Nach dem Merge besteht der Main-Check. Die wiederholten Checks der Deploy-Workflows melden zwei Fehler: Der Rundenfall überschreitet mit 5622 ms seine unveränderten 5000 ms. Der Menüfall erhält innerhalb von 5000 ms keinen ersten Draw Call. Kein Produktionsdeploy erfolgte. Der lokal bereitgestellte Build besteht Welt-, Menü-, Aufnahme- und TCX-Prüfung.

Der Server-Test berechnet dieselbe reine Erwartung viermal. Ein lokaler Erwartungswert erhält alle vier Assertions. Getrennte V8-Abdeckung bestätigt weiterhin Fixture-Erzeugung, echte HTTP-Nachrechnung und eine unabhängige Erwartungsnachrechnung. Der CI-Timeout wurde im lokalen Linux-Vergleich nicht reproduziert. Daraus folgt weder eine garantierte CI-Zeitreserve noch eine Verbesserung der Produktleistung.

Auch der Renderfehler wurde auf Linux ARM64 nicht reproduziert. Unveränderte Wiederholungen und die gesamte Browsersuite bestanden. Ein nativer Wait liegt auf dem Render-Worker, während Main weiterarbeitet. Das ist kein Nachweis der fehlgeschlagenen x86-Pipeline. Außerdem kann `Number(null)` fehlende Frame-Diagnosen als null Draw Calls darstellen. [Issue #26](https://github.com/henrysachs/voltonaut/issues/26) hält diese offene Diagnose fest. Fehlerkontext im CI-Log soll den nächsten Befund unterscheidbar machen, ohne Wartebedingungen oder Assertions zu ändern.

## Abnahmekriterien

- [x] AK1 – Fixture, 480 Sekunden, 2000 W, echte 20-Hz-Engine und HTTP-Annahme bleiben unverändert. Vollständige Assessment-Gleichheit, Streckenüberschreitung, eine Runde und kontinuierliches Fenster bleiben geprüft.
- [x] AK2 – Die identische Erwartung wird nur einmal nachgerechnet. Tatsächliche Serverannahme und ihre Nachrechnung werden nicht ersetzt oder übersprungen.
- [x] AK3 – Der Renderbefund bleibt als eigener offener Befund benannt, bis derselbe rote Fall mit belegter Ursache korrigiert ist. Zusätzliche Wartezeit allein gilt nicht als Korrektur.
- [x] AK4 – Keine Änderung an Zeitlimits, Assertions, Sim-Uhr, Datenfrische, Grafikqualität, Testauswahl, Ressourcenlimits der CI oder geschützten Konfigurationen. Keine neue Abhängigkeit.
- [x] AK5 – Vollständiges `mise run check` und unabhängiges Review bestehen. CI des exakten Heads bleibt zusätzliche Mergevoraussetzung. Der laufende Fahrstand erhält keine unfertigen Änderungen.

## Testplan

| AK       | Ebene                    | Nachweis                                                                                               |
| -------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| AK1, AK2 | Integration              | `apps/server/src/rides/rides.replayed.test.ts` mit tatsächlicher Nest-App, SQLite und Engine           |
| AK2      | Getrennte Arbeitszählung | V8-Abdeckung ohne Mock oder Produktionsinstrumentierung. HTTP-Annahme bleibt einmal vorhanden.         |
| AK3      | Browserdiagnose          | Ursprünglicher Menüfall, unveränderte Assertions und Zeitlimits, native Render- und Requestbeobachtung |
| AK4, AK5 | Gesamtgate und Review    | Vollständiges mise-Gate, Diffprüfung, unabhängiger Reviewer und exakte Head-CI                         |

## Nicht-Ziele

Keine neue FPS-, Hardware-, Latenz- oder Anbieterfreigabe. Kein neues Rendering, keine Quellenpolitik und keine erneute Datenmigration. Keine rückwirkende Umdeutung fehlgeschlagener Läufe als Weltbeleg.

## Offene Fragen und Risiken

- Ursache des intermittierenden Renderstarts noch offen.
- Unterschiedliche CI-Last ist beobachtet, aber noch keine bewiesene App-Ursache.
- Keine offenen Anforderungsfragen an Henry.

## Belege

`$TMPDIR/opencode/server-replay-work-rXK61v/evidence.md` enthält echte HTTP-Prüfungen und getrennte Arbeitszählungen. Ein unabhängiger Reviewer bestätigte die unveränderten Assertions und die getrennte Erwartungsnachrechnung. `$TMPDIR/opencode/firstdraw-diagnosis-91Xb9d/evidence.md` enthält die erfolglosen Reproduktionsversuche, nativen Renderbefunde und Grenzen. Deren temporärer Diagnose-Workload bestand nicht vollständig den Lint und ersetzt kein reguläres Gesamtgate.

Die Fehlerdiagnostik erhält den rohen Wert derselben Poll-Abfrage. Nur nach einem Fehler erfasst sie zusätzliche öffentliche Daten und schreibt eine queryfreie JSON-Zeile ins CI-Log. Die zusätzliche Sammlung ist auf eine Sekunde begrenzt und ändert keine Bestehensbedingung. Ein blockierter oder geschlossener Browser darf den ursprünglichen Fehler nicht ersetzen. Private Gegenproben und ein unabhängiger Reviewer bestätigen den unveränderten 5000-ms-Fehler, fehlende Attribute, `"0"` gegenüber späterem `"9"`, geschlossene Seiten, blockierte Sammlung und gefilterte Querywerte. Belege liegen unter `$TMPDIR/opencode/{menu-failure-proof-8UH4vC,ci-observability-review-bEVpiN}/`.

Das reguläre `E2E_PORT=5235 CI=1 mise run check` besteht mit 822 Unit-Tests einschließlich Coverage und 49 Browserfällen. Build ebenfalls grün. Logs liegen unter `$TMPDIR/opencode/ci-followup-{full-gate,build}.log`. API-Binary, Engine-Worker und Render-Worker sind byteidentisch zum gelieferten Stand. Auch eine erfolgreiche CI dieses Testpatches schließt die ungeklärte Renderursache aus #26 nicht.
