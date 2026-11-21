# Spec E4-06 – Erster echter Renderframe

## Ziel

Issue #26 durch einen passenden roten nativen x86-Lauf erklären und denselben Fall nach einer gezielten Korrektur grün prüfen. Diagnose allein schließt den Fehler nicht.

## Umfang

Isolierter Zweig `fix/render-first-frame` ab `916edbb`. Zunächst ausschließlich zusätzliche Browserdiagnose. Kein Produktionsdeploy, kein Zugriff auf laufenden Fahrstand, Geräte oder Nutzerdaten. Originaler Menüfall und alle 49 Browserfälle bleiben unverändert erhalten.

Die Diagnose zeichnet den ursprünglichen Menüfall während des unveränderten Gesamtgates auf. Sein Testkörper, seine Assertions und seine Position zwischen den übrigen 49 Fällen bleiben erhalten. Nur die importierte Test-Fixture startet die native Chromium-Aufzeichnung. Die Aufzeichnung verändert Timing und gilt nicht als unveränderter Performancebeleg. JSON-Zusammenfassungen im CI-Log erhalten Threadnamen und native Ereignisse. Eine Fehleraufnahme erfolgt erst nach dem ursprünglichen Fehler und nach Ende der nativen Aufzeichnung. PNGs bis 128.000 Bytes bleiben unverändert und vollständig im CI-Log erhalten, weil der bestehende Workflow keine Artefakte hochlädt.

## Abnahmekriterien

- [ ] Passender roter Erstframe-Fall auf nativem x86 mit unterscheidbarem Rohwert und lokalisierter Ursache.
- [ ] Gezielte Produktkorrektur und derselbe Erfolgsfall ohne geänderte Zeitlimits, Assertions, Sim-Uhr oder Grafikqualität.
- [ ] Tatsächliche sichtbare Welt, weiterlaufende Fahrt und ehrlicher Fehlerfallback erhalten.
- [ ] Temporäre Wiederholungen vor dem finalen Artefakt entfernt, vollständiges `mise run check`, Build und unabhängiges Review grün.

## Nachweisstatus

Diagnose vorbereitet. Produktkorrektur nicht implementiert. Hardware nicht geprüft. Nicht bereitgestellt. Keine Geschwindigkeits- oder FPS-Behauptung.

## Native Nachprüfung

Die x86-Läufe `44892791929` und `44892791893` auf `d93993c` bestehen einschließlich aller 61 Browserfälle. Die nativen Traces erfassen die Zusatzfälle jedoch erst nach Ende der parallelen Coverage. Sie belegen daher keinen passenden Fehler unter dieser Anfangslast.

Die zweite Diagnosefassung ordnete dieselben Zusatzfälle vor den übrigen Browserdateien ein. Die nativen Läufe `44893417202` und `44893417110` erfassen dadurch passende rote Erstframe-Prüfungen. Auch die uninstrumentierte Hälfte scheitert. Der Rohwert ist jeweils fehlend, nicht tatsächlich null Draw Calls. Bei instrumentierten Fehlern treffen Ready und Snapshot-ACK vor dem verspäteten Frame ein. Die vollständige Ursache ist noch nicht belegt.

PR #30 liefert getrennt einen weiteren roten ursprünglichen Menüfall auf unverändertem Anwendungscode in Lauf `44894471791`. Die aktuelle Diagnosefassung entfernt deshalb die Zusatzfälle und zeichnet genau diesen ursprünglichen Fall in seiner bisherigen Reihenfolge auf. Coverage, Typecheck und Browser behalten ihre bestehenden Befehle und Ressourcen. Ein Worker-Wrapper protokolliert die erste echte Antwort jedes Render-Nachrichtentyps. Er verändert keine Nachricht und erzeugt keine Engine-Ereignisse. Sein Timing-Einfluss bleibt Teil der Nachweisgrenze. Native Dauern, offene Spannen und Performance-Markierungen unterscheiden Initialisierung, Snapshot, Render und folgende Tasks.
