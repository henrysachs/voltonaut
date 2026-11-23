# Spec E6-01 – Vorläufige Sprint- und KOM-Anzeige

- **Auftrag:** Henry möchte am 23.11.2026 die übrige Software unabhängig vom später wieder verfügbaren Trainer umsetzen.
- **Basis:** Main `a001d168ab9be7d190e6c08a506f3379ba82445f` mit genehmigter Prüfungsreihenfolge aus ADR-023.
- **Status:** Implementiert, am gebauten Artefakt softwaregeprüft und unabhängig reviewt. Reguläres integriertes Gate und Build grün. CI-Freigabe noch offen. Nicht bereitgestellt; keine Hardwareabnahme.
- **Module:** Web `game`, Engine-Link-Verdrahtung, vorhandener HUD-Takt und Darstellung. Keine Änderung an Engine, Rules oder Aufnahmeformat.

## Ziel und Grenzen

Sprint und KOM zeigen im bestehenden Spiel eine laufende Zeit, Restdistanz und den letzten Abschluss mit Runde. Die Anzeige ist eine vorläufige Spielsession-Vorschau mit vorhandener Tickauflösung. Sie ist weder interpolierte Grenzzeit noch bestätigte PB oder Ergebnis eines Aufnahmefensters.

Ein Projektor in `game/segments.ts` besitzt Eintrittszeit, Versuchsrunde und den gelesenen Snapshot. Er verarbeitet die bereits vorhandenen Engineereignisse mit deren `tS` in ihrer Reihenfolge. Die letzte Snapshotzeit ersetzt keinen früheren Ereigniszeitpunkt im Batch. Die UI liest ausschließlich die abgeleitete Ansicht. Es entsteht kein weiterer Timer, Workerlistener, Eventbus oder Besitzer von `RideState`.

## Abnahmekriterien

- [x] AK1 – Zustände `idle`, `active`, `finished` und `invalid` sind getrennt modelliert. Sprint und KOM verwenden bekannte Routendefinitionen. Keine zweite räumliche Segmenterkennung.
- [x] AK2 – Start und Abschluss verwenden die tatsächlichen Ereigniszeiten. Mehrere Ereignisse und Runden im selben Batch erhalten ihre Reihenfolge und richtige Runde. Ein doppelter Eintritt setzt keine aktive Uhr zurück.
- [x] AK3 – Fehlender Eintritt, unplausible Zeitfolge, Clockskip und Engineausfall ergeben einen ehrlichen ungültigen Versuch. Keine erfundene Mindestzeit oder nachträgliche Heilung eines betroffenen Versuchs.
- [x] AK4 – Main erstellt den Projektor vor der Engineinitialisierung. Vorhandene Snapshot- und Trainerkommandocallbacks bleiben unverändert. `onEvents` liest den Snapshot derselben Workerantwort. Fehler und Stop entwerten laufende Versuche.
- [x] AK5 – Anzeige bleibt kompakt im vorhandenen HUD. Menüöffnung pausiert weder Fahrt noch Segment. Keine neue Körperseiten-Scrollleiste, Controllerbelegung oder störende laufende Screenreaderansage.
- [x] AK6 – Alle Ergebnistexte nennen die Vorschau als vorläufig. Keine PB-, Konto-, Aufnahme-, Strava- oder Belohnungsbuchung. Bestehende Journale, Revisionen und Segmentzeiten der Engine bleiben unverändert.
- [x] AK7 – Projektor-, tatsächliche Engine-, Callback- und HUD-Tests belegen Grenzfälle und mehrere Runden. Gewöhnlicher Sim-Browserlauf belegt UI, Schalten und laufende Fahrt. Ein zusätzlicher Verlauf darf die vorhandene schnelle Sim-Uhr verwenden, ersetzt den gewöhnlichen Lauf aber nicht.
- [x] AK8 – Vollständiges Gate, Build, tatsächlicher gebauter Browsernachweis und unabhängiges Review bestehen. Alte 49 Browserfälle und deren Fristen bleiben unverändert. Keine Leitplanke, Fixture oder Screenshotbaseline geändert.

## Test- und Laufbudget

Unitfälle dürfen eigene kurze synthetische Routen definieren. Produktionsrouten und vorhandene Fixtures bleiben unverändert. Der gewöhnliche Browser-Smoke nutzt die unveränderte Sim-Uhr. Für den vollständigen ersten Sprint ist zusätzlich ein privater gebauter Langlauf auf der tatsächlichen Route mit bis zu 30 Minuten äußerem Werkzeugbudget erlaubt. Das ist keine Verlängerung vorhandener Testfristen und keine Performancebehauptung. Der Langlauf bleibt aus dem normalen Gate, wenn dessen reale Streckenlänge Minuten erfordert.

Keine neue Abhängigkeit oder Coreänderung beauftragt. Wenn die tatsächlichen Verträge eine solche Änderung erfordern, zuerst den konkreten Befund und die kleinere Alternative vorlegen.

## Softwarebelege

- `segments.test.ts` und `segments-engine.test.ts` prüfen Ereigniszeiten, Zeitlücken, Pausen und mehrere Runden mit der tatsächlichen Engine.
- `rideSession.test.ts`, `app.test.ts` und `hud-segments.test.ts` prüfen Callbackidentität, Ausfall, Stop und Darstellung. `e2e/segments.spec.ts` ergänzt einen gewöhnlichen Sim-Browserfall. Alle bisherigen 49 Browserfälle bleiben unverändert.
- Der gebaute gewöhnliche Sim-Lauf erreicht den ersten Sprint auf der unveränderten Route. Das HUD zeigt `Sprint · R1 · 56.1 s · vorläufig`. Ein zusätzlicher schneller Verlauf belegt KOM und die zweite Runde.
- Das unabhängige Review besteht mit 45 fokussierten Tests, 15 eigenen Gegenproben und eigener Engineintegration mit Batches von 1, 5, 23 und 100 Ticks. Eigene gebaute Browserläufe bestätigen Welt, Menü, Schalten und Segmentverläufe ohne schreibende HTTP-Anfragen.
- Nach Integration von Main `a001d16` besteht das reguläre `CI=1 E2E_PORT=5248 mise run check` mit 881 Unit-/Integrationstests und 50 Browserfällen. Der normale Build besteht. Alle 16 reviewten Anwendungs- und Testquellen sowie die bisherigen 22 Browserdateien bleiben bytegleich. Das gebaute Ride-Bundle entspricht weiterhin dem unabhängig geprüften Browserartefakt.

## Offene reale Abnahmen

Der Trainer ist für diese Softwareeinheit nicht erforderlich. Physisches Schaltgefühl, Funkzuverlässigkeit und tatsächliche Trainingsleistung bleiben getrennte spätere Abnahmen.
