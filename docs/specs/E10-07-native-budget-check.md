# Spec E10-07 – Nativen Strava-Budgettimeout zuordnen

- **Roadmap-Bezug:** E10, bestehende Strava-Auslieferung aus E10-06 und ADR-022. Keine neue Produktfunktion.
- **Status:** Phasendiagnose nativ ausgeführt. Zusätzliche CPU-Stichproben lokal geprüft. Native Funktionsattribution offen.
- **Basis:** `a504e356ea7cad49b99cb0e8dd513f1efc0fc24d`.
- **Fehlernachweis:** [Issue #35](https://github.com/henrysachs/voltonaut/issues/35) mit nativen roten Originalfällen und den vorherigen grünen Gegenläufen.
- **Betroffene Module:** Nur `strava.authorization.test.ts` und die temporären testlokalen Diagnosehelfer unter `apps/server/src/strava`.

## Ziel

Der unveränderte einzelne 5-Sekunden-Budgettest liefert sichere Phasendaten auch bei einem nativen CI-Timeout. Die Diagnose unterscheidet aktive Thread-CPU, Linux-Runqueue-Wartezeit und übrige verstrichene Zeit. Ein zusätzlicher CPU-Profiler ordnet Stichproben Funktionen und Modulen zu. Phasendaten allein beweisen weder SQLite-Blockierung noch deren Ursache.

## Abnahmekriterien

- [x] AK1 – Alle 1050 bestehenden Tests und ihre Assertions bleiben erhalten. Der lange Fall behält 1000 Scheduler-Schritte und 1000 Hinweise, UTC-Zeiten, echte Dateidatenbanken, WAL, Wiederöffnung, Receipt und Authority.
- [x] AK2 – Quoten 100/1000, 499 gültige Proofs, ein echter Refresh, ein Athleten-HTTP-Aufruf, ein späterer echter Poll, kein Submit und 501 Tagesreads ohne offene Reservierungen bleiben unverändert geprüft.
- [x] AK3 – Genau eine begrenzte JSON-Zeile mit Präfix `[strava-native-budget-v1]` erscheint bei Erfolg oder Fehler. Checkpoints erfassen Start, Setup, Schritte 1/499/500/1000, Wiederöffnung mit Accepted sowie den späteren Poll und den abschließenden Hookzustand. Die Beobachtung samt kopierter Checkpointliste wird vor dem asynchronen Profilerabschluss festgehalten; eine spät weiterlaufende Testfunktion verändert sie nicht nachträglich.
- [x] AK4 – Messwerte enthalten monotone Zeit, Thread- und Prozess-CPU sowie unter Linux ausschließlich an Checkpoints gelesene `/proc/thread-self/schedstat`-Werte. Andere Plattformen lesen keine Proc-Datei. Fehlende Messwerte erhalten einen ausdrücklichen Status.
- [x] AK5 – Tatsächliche SQLite-Pragmas, SQLite-Version und begrenzte Compile-Optionen werden einmal nach Setup gelesen und mit Zod validiert. Ungültige optionale Compile-Angaben erhalten einen eigenen Nichtverfügbarkeitsstatus und verwerfen keine gültigen Kernwerte. Hooks lesen keine Datenbank. Keine Tokens, Nutzlasten, Headerwerte, URLs, Nutzerzeilen oder Fehlerobjekte gelangen in die Diagnose.
- [x] AK6 – Fristen, Concurrency, Coverage, Ressourcenlimits, Konfiguration, Produktquellen, Abhängigkeiten und Fixtures bleiben unverändert. Reguläres `CI=1 E2E_PORT=5252 mise run check` besteht lokal. Native Prüfung bleibt eine gesonderte spätere Freigabe.
- [x] AK7 – Eine eigene `node:inspector/promises.Session` profiliert ausschließlich den aktuellen Testworker. Start wird vor dem Setup abgewartet. Die ursprüngliche Schleife erhält keine zusätzlichen Wartepunkte. Erfolg, Fehler, Standardtimeout und fehlgeschlagener Start führen höchstens einmal durch Stop und Disconnect. Ein fehlender optionaler Profiler ersetzt weder Testergebnis noch SQLite-Metadaten oder Checkpoints. Kein Inspector-Port, keine CLI-Flags und keine Rohprofile.
- [x] AK8 – Dieselbe JSON-Zeile enthält höchstens 20 Funktionszeilen und 12 Modulzeilen mit Self-Stichprobenzahlen, Gesamtzahl, Profildauer und angefordertem Intervall. Nicht gezeigte Stichproben werden gezählt. Keine Stichproben werden als Diagnosegeräusch ausgeblendet. Hostdaten werden einmal gelesen und enthalten verfügbare Parallelität, CPU-Anzahl, begrenzte ASCII-Modellnamen und Load Average.

## Testplan

| AK       | Ebene                 | Prüfung                                                                                                                                 |
| -------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| AK1, AK2 | Integration           | Originale Autorisierungstests und reguläres Gate                                                                                        |
| AK3, AK5 | Private Diagnoseprobe | Originalhelfer mit absichtlichem Assertionfehler, genau eine sichere Fehlerzeile                                                        |
| AK4, AK5 | Typen und Integration | Typecheck, Lint, tatsächliche Setup-Metadaten und Checkpoints                                                                           |
| AK6      | Repository            | Vorher-/Nachher-Hashes, vollständiges reguläres Gate                                                                                    |
| AK7, AK8 | Private Diagnoseprobe | Echte Workersession, Wiederholung, paralleler Abschluss, Start- und Stopfehler, Datenschutz und Zeilenbegrenzung                        |
| AK7      | Private Hookprobe     | Erfolg, absichtlicher Assertionfehler und tatsächlicher unveränderter 5000-ms-Standardtimeout; Stop und Disconnect jeweils genau einmal |

## Nicht-Ziele

Kein Produktfix, keine neue Testnaht im Produkt und keine native Statementzeitmessung. Die Instrumentierung bleibt in einem gesonderten diagnostischen Draft und ist keine Mergefreigabe. Kein Deploy oder Hardwaretest. Nach der Attribution werden die temporären Helfer entfernt.

## Grenzen

Ein Timeout-Hook kann verspätet laufen. Seine Daten beschreiben den beobachteten Checkpoint, nicht den Zustand exakt nach fünf Sekunden. Prozess-CPU umfasst weitere Threads. `schedstat` ist kumulativ pro aufrufendem Linux-Thread; Differenzen zwischen Checkpoints sind maßgeblich. Eine hohe `synchronous`-Einstellung allein belegt keine Ursache. Lokales Grün und lokale Laufzeiten sind kein nativer Nachweis und kein Beschleunigungsnachweis.

Die beiden bisherigen nativen VM-Läufe sind kein A/B-Vergleich. Einer scheitert vor dem bekannten HTTP-Poll, einer besteht. Beide melden WAL, `synchronous=1` und `wal_autocheckpoint=1000`. Aktive Thread-CPU erklärt im roten Lauf den größeren Zeitanteil. Welche Funktionen diese CPU verbrauchen, bleibt ohne native Stichproben offen. CPU-Modell und Hostlast wurden in diesen beiden Läufen noch nicht erfasst. Daraus folgt weder allgemeine I/O-Freiheit noch eine Hardwareleistungszusage.

Die Profilierung erzeugt Beobachterkosten. Profilierte Laufzeiten sind keine unprofilierten Latenzen. Stichprobenzahlen sind keine CPU-Millisekunden; `timeDeltas` werden nicht dafür umgerechnet. Profildauer und angefordertes 1000-µs-Intervall beschreiben den Profiler. Zeilen und Spalten sind 1-basiert im Runtime-Code. Ihre Zuordnung zu TypeScript-Quellen bleibt ungeprüft. Native SQLite-Arbeit kann beim JavaScript-Aufrufer erscheinen, ohne SQLite-internen Stack.

Die Diagnose verwendet ausschließlich synthetische Testkonten. Trotzdem gilt eine Ausgabegrenze: feste Funktionsnamenliste, sonst Redaktion; begrenzte relative Pfade unter erlaubten Repository-Verzeichnissen und Paketwurzeln sowie begrenzte Node-interne Modulnamen. Query, Fragment, kodierte Pfade und Traversal werden verworfen. Unbekannte Module erhalten einen festen Redaktionswert. Keine absoluten Nutzerpfade, Frame-URLs, Scriptquellen, Argumente, Header, Tokens, Antwortkörper oder Fehlertexte verlassen den Helfer.

## Doku-Updates

Nur diese Spec. Roadmap, bestehende andere Specs und ADRs bleiben unverändert. Private Logs und Erhaltungsnachweise liegen unter `$TMPDIR/opencode/strava-native-cpu-profile-handoff.md`; frühere Phasennachweise unter `$TMPDIR/opencode/strava-native-instrumentation-handoff.md`.
