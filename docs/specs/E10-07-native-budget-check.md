# Spec E10-07 – Nativen Strava-Budgettimeout zuordnen

- **Roadmap-Bezug:** E10, bestehende Strava-Auslieferung aus E10-06 und ADR-022. Keine neue Produktfunktion.
- **Status:** Temporäre Testdiagnose lokal softwaregeprüft. Native Ursache offen.
- **Basis:** `a504e356ea7cad49b99cb0e8dd513f1efc0fc24d`.
- **Fehlernachweis:** [Issue #35](https://github.com/henrysachs/voltonaut/issues/35) mit nativen roten Originalfällen und den vorherigen grünen Gegenläufen.
- **Betroffene Module:** Nur `strava.authorization.test.ts` und der neue testlokale Diagnosehelfer unter `apps/server/src/strava`.

## Ziel

Der unveränderte einzelne 5-Sekunden-Budgettest liefert sichere Phasendaten auch bei einem nativen CI-Timeout. Die Diagnose unterscheidet aktive Thread-CPU, Linux-Runqueue-Wartezeit und übrige verstrichene Zeit. Sie beweist allein weder SQLite-Blockierung noch deren Ursache.

## Abnahmekriterien

- [x] AK1 – Alle 1050 bestehenden Tests und ihre Assertions bleiben erhalten. Der lange Fall behält 1000 Scheduler-Schritte und 1000 Hinweise, UTC-Zeiten, echte Dateidatenbanken, WAL, Wiederöffnung, Receipt und Authority.
- [x] AK2 – Quoten 100/1000, 499 gültige Proofs, ein echter Refresh, ein Athleten-HTTP-Aufruf, ein späterer echter Poll, kein Submit und 501 Tagesreads ohne offene Reservierungen bleiben unverändert geprüft.
- [x] AK3 – Genau eine begrenzte JSON-Zeile mit Präfix `[strava-native-budget-v1]` erscheint bei Erfolg oder Fehler. Checkpoints erfassen Start, Setup, Schritte 1/499/500/1000, Wiederöffnung mit Accepted sowie den späteren Poll und den abschließenden Hookzustand.
- [x] AK4 – Messwerte enthalten monotone Zeit, Thread- und Prozess-CPU sowie unter Linux ausschließlich an Checkpoints gelesene `/proc/thread-self/schedstat`-Werte. Andere Plattformen lesen keine Proc-Datei. Fehlende Messwerte erhalten einen ausdrücklichen Status.
- [x] AK5 – Tatsächliche SQLite-Pragmas, SQLite-Version und begrenzte Compile-Optionen werden einmal nach Setup gelesen und mit Zod validiert. Ungültige optionale Compile-Angaben erhalten einen eigenen Nichtverfügbarkeitsstatus und verwerfen keine gültigen Kernwerte. Hooks lesen keine Datenbank. Keine Tokens, Nutzlasten, Headerwerte, URLs, Nutzerzeilen oder Fehlerobjekte gelangen in die Diagnose.
- [x] AK6 – Fristen, Concurrency, Coverage, Ressourcenlimits, Konfiguration, Produktquellen, Abhängigkeiten und Fixtures bleiben unverändert. Reguläres `CI=1 E2E_PORT=5252 mise run check` besteht lokal. Native Prüfung bleibt eine gesonderte spätere Freigabe.

## Testplan

| AK       | Ebene                 | Prüfung                                                                          |
| -------- | --------------------- | -------------------------------------------------------------------------------- |
| AK1, AK2 | Integration           | Originale Autorisierungstests und reguläres Gate                                 |
| AK3, AK5 | Private Diagnoseprobe | Originalhelfer mit absichtlichem Assertionfehler, genau eine sichere Fehlerzeile |
| AK4, AK5 | Typen und Integration | Typecheck, Lint, tatsächliche Setup-Metadaten und Checkpoints                    |
| AK6      | Repository            | Vorher-/Nachher-Hashes, vollständiges reguläres Gate                             |

## Nicht-Ziele

Kein Produktfix, keine neue Testnaht im Produkt, kein V8-Profil und keine native Statementzeitmessung. Die Instrumentierung bleibt in einem gesonderten diagnostischen Draft und ist keine Mergefreigabe. Kein Deploy oder Hardwaretest. Nach der Attribution wird der temporäre Helfer entfernt.

## Grenzen

Ein Timeout-Hook kann verspätet laufen. Seine Daten beschreiben den beobachteten Checkpoint, nicht den Zustand exakt nach fünf Sekunden. Prozess-CPU umfasst weitere Threads. `schedstat` ist kumulativ pro aufrufendem Linux-Thread; Differenzen zwischen Checkpoints sind maßgeblich. Eine hohe `synchronous`-Einstellung allein belegt keine Ursache. Lokales Grün und lokale Laufzeiten sind kein nativer Nachweis und kein Beschleunigungsnachweis.

## Doku-Updates

Nur diese neue Spec. Roadmap, bestehende Specs und ADRs bleiben unverändert. Private Logs und Erhaltungsnachweise liegen im Handoff unter `$TMPDIR/opencode/strava-native-instrumentation-handoff.md`.
