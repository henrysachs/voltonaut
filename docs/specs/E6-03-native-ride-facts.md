# Spec E6-03 – Native Fahrtfakten für laufenden Fortschritt

- **Auftrag:** Henry verlangt Fortschritt während normaler Fahrt. Er bestätigt am 24.11.2026 die Form „einmal je Konto freigeben, danach automatisch“, unabhängig von Aufnahmefenstern. Das ist eine Produktentscheidung, keine bereits aktivierte Datenübertragung.
- **Roadmap-Bezug:** E6, serverseitiger Fortschritt und Volts. Diese Lieferung stellt ausschließlich die numerische Grundlage bereit.
- **Status:** Implementiert und softwaregeprüft; Merge/CI ausstehend.
- **Basis:** `26df05b9ce1153c20d976f1cdcbe004f47649f12`.
- **Betroffene Module:** `packages/engine`, neue Engineprüfungen, Dokumentation. Keine neue Abhängigkeit.

## Ziel und gewählte Form

Ein unveränderter Aufruf von `Engine.advance(elapsedS)` liefert zusätzlich die tatsächlich verarbeiteten nativen Tickfakten. Verbraucher können dadurch aktive Zeit, Strecke, positive Höhe und mechanische Arbeit aus denselben Beiträgen wie die Physik auswerten. Geglättete HUD-Werte und Differenzen großer kumulativer Snapshots reichen dafür nicht.

Zwei Formen wurden betrachtet:

1. **Unveränderliche Rückgabe des vorhandenen Advances:** pro tatsächlich verarbeitetem Tick ein kleiner Wert mit effektiver Rohleistung, Rohkadenz und vier Beiträgen. Keine zusätzliche Lebensdauer oder nachträgliche Drain-Aktion. Diese Form wird gewählt.
2. **Callback oder zweiter auslesbarer Puffer:** würde fremden Code im Physiklauf ausführen oder einen weiteren Lösch- und Abholbesitzer verlangen. Das ist nicht erforderlich.

Geplanter öffentlicher Vertrag: `advance(elapsedS): readonly NativeTickFacts[]`. Jeder Eintrag enthält ausschließlich `powerW`, `cadenceRpm`, `timeS`, `distanceM`, `elevationGainM` und `energyKj`. Das sind numerische Fakten, keine Belohnungsfreigabe. Kein Puls, keine Geräte- oder Kontokennung.

## Abnahmekriterien

- [ ] AK1 – Jeder tatsächlich verarbeitete native Tick liefert genau einen unveränderlichen Faktenwert in derselben Reihenfolge. Das äußere Array ist ebenfalls eingefroren. Ein Advance ohne Tick liefert ein leeres Array.
- [ ] AK2 – Leistung und Kadenz sind die nach Frischeprüfung effektiven Rohwerte, nicht EMA-Werte oder der letzte Wert eines ganzen Batches. Frischewechsel innerhalb desselben Advances bleiben erkennbar.
- [ ] AK3 – Die vier Beiträge stammen aus denselben lokalen Summanden wie die bestehenden Zustandssummen. Pausierte Ticks liefern vier Nullbeiträge. Ausrollen, Steigung und Gefälle bleiben numerisch korrekt.
- [ ] AK4 – Akkumulator, Advancepartition, Catch-up-Grenze von 120 Ticks, Zeitlücken, Pause, Ereignisse und Trainerkommandos bleiben unverändert. Insbesondere wird ein Advance von 0,15 s nicht in drei öffentliche Advances von 0,05 s zerlegt.
- [ ] AK5 – Bestehende Aufnahmen, Replay-Beobachtungen und Golden-Dateien werden nicht geändert. Ein ausführbarer Vergleich mit der Basis bestätigt identische Snapshots, Ereignisse und Kommandos für dieselben Eingabefolgen.
- [ ] AK6 – Gezielte Tests zuerst rot, danach grün; reguläres `mise run check`, `mise run check:mutation`, Build und unabhängiges Review bestanden. Keine Leitplanke oder Abhängigkeit geändert.

## Testplan

| AK  | Ebene                                            | Nachweis                                                                                  |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1–3 | Vitest, echte öffentliche Engine                 | `native-facts.test.ts`: Rohwerte, Beiträge, Frische, Pause, Kopien und Unveränderlichkeit |
| 3–4 | Vitest, Eigenschaften                            | Native Summationsreihenfolge, Restakkumulator und Catch-up ohne Tickzerlegung             |
| 4–5 | Bestehende Tests und ausführbarer Basisvergleich | Snapshots, Ereignisse, Trainerkommandos und bestehende Replayfälle unverändert            |
| 6   | Vollständige Prüfungen                           | Reguläres Gate, Mutation, Build, zweiter Agent                                            |

## Nicht-Ziele und Grenzen

Kein Fortschrittsupload, keine Einwilligungsoberfläche, keine Konto- oder Quellenfreigabe und keine XP-/Volts-Buchung. Die einmalig gespeicherte Freigabe und automatische Aktivierung künftiger Fahrten bleiben ein eigener Liefergegenstand. Keine künstliche manuelle Aktivierung pro Fahrt als Ersatz.

Der spätere Server muss Quellen, Plausibilität, Eigentümer, nicht überlappende Abschnitte, Tagesbudget und wiederholte Übertragung getrennt prüfen. Diese Fakten attestieren weder Hardware noch reale Leistung. Bestehende Simulation und Trainersteuerung ändern sich nicht.

## Bisherige Nachweise

Die 16 neuen Faktenfälle waren vor der Implementierung passend rot, weil `advance()` noch nichts zurückgab. Nach der Umsetzung und dem Review-Zusatzfall bestehen sie gemeinsam mit den bestehenden Tick-, Determinismus- und Pause-Tests: 35 Tests in vier Dateien.

Ein zusätzlicher ausführbarer Vergleich lief mit demselben deterministischen Skript auf Basis `26df05b` und Kandidat. Drei Routen, je 20 Operationen. Snapshots, Events und Trainerkommandos sind bytegleich; der gemeinsame SHA-256 ist `11ab057ed7d51a61306a7bb23e4fcc6b0cc6c391372c638b8c7c09fcf4d67b2e`. Golden-Dateien wurden nicht geändert.

Vollständiges Gate inklusive 62 E2E, Mutation (95,84 % bei Schwelle 80) und Build sind grün. Die unabhängige Quell-/Spec-Prüfung ist APPROVE; der daraus ergänzte Pause-Rohwerttest ist grün. Hardwareabnahme und Deployment sind durch diese Softwareprüfung nicht attestiert.

## Offene Fragen und Dokumentation

Keine offene Produktfrage für diese reine Engineprojektion. Datenschutz, Aktivierungsgrenzen, Kontowechsel und Buchungspolitik des laufenden Fortschritts sind durch diese Lieferung nicht entschieden oder umgesetzt.

- [x] Physikdokumentation ergänzt.
- [x] Gamificationdokument nennt Fakten und einmalige künftige Freigabe ohne Vergabebehauptung.
- [x] Roadmap nennt den begrenzten Teilschritt.
