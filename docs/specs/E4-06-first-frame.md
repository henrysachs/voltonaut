# Spec E4-06 – Erster echter Renderframe

## Ziel

Issue #26 durch einen passenden roten nativen x86-Lauf erklären und denselben Fall nach einer gezielten Korrektur grün prüfen. Diagnose allein schließt den Fehler nicht.

## Umfang

Isolierter Zweig `fix/render-first-frame` ab `916edbb`. Zunächst ausschließlich zusätzliche Browserdiagnose. Kein Produktionsdeploy, kein Zugriff auf laufenden Fahrstand, Geräte oder Nutzerdaten. Originaler Menüfall und alle 49 Browserfälle bleiben unverändert erhalten.

Die temporären Zusatzfälle wiederholen den vollständigen ursprünglichen Menüfall abwechselnd ohne Instrumentierung und mit nativer Chromium-Aufzeichnung. Die Aufzeichnung verändert Timing und gilt nicht als unveränderter Performancebeleg. JSON-Zusammenfassungen im CI-Log erhalten Threadnamen und lange native Ereignisse; vollständige Traces bleiben lokale Testartefakte des Runners.

## Abnahmekriterien

- [ ] Passender roter Erstframe-Fall auf nativem x86 mit unterscheidbarem Rohwert und lokalisierter Ursache.
- [ ] Gezielte Produktkorrektur und derselbe Erfolgsfall ohne geänderte Zeitlimits, Assertions, Sim-Uhr oder Grafikqualität.
- [ ] Tatsächliche sichtbare Welt, weiterlaufende Fahrt und ehrlicher Fehlerfallback erhalten.
- [ ] Temporäre Wiederholungen vor dem finalen Artefakt entfernt, vollständiges `mise run check`, Build und unabhängiges Review grün.

## Nachweisstatus

Diagnose vorbereitet. Produktkorrektur nicht implementiert. Hardware nicht geprüft. Nicht bereitgestellt. Keine Geschwindigkeits- oder FPS-Behauptung.

## Native Nachprüfung

Die x86-Läufe `44892791929` und `44892791893` auf `d93993c` bestehen einschließlich aller 61 Browserfälle. Die nativen Traces erfassen die Zusatzfälle jedoch erst nach Ende der parallelen Coverage. Sie belegen daher keinen passenden Fehler unter dieser Anfangslast.

Die zweite Diagnosefassung ordnet dieselben Zusatzfälle vor den übrigen Browserdateien ein. Coverage, Typecheck und Browser behalten ihre bestehenden Befehle und Ressourcen. Nur die instrumentierte Hälfte erhält zusätzlich einen Worker-Wrapper, der die erste echte Antwort jedes Render-Nachrichtentyps protokolliert. Der Wrapper verändert keine Nachricht und erzeugt keine Engine-Ereignisse. Sein Timing-Einfluss bleibt Teil der Nachweisgrenze. Der ursprüngliche Menüfall bleibt unverändert erhalten.
