# Spec E10-08 – Strava-Abfragen einmalig vorbereiten

## Ziel und Umfang

Wiederholten SQL-Aufbau und Statement-Vorbereitung in den vier Strava-Stores vermeiden. Bezug: E10-06 AK4, AK6 und AK7 sowie ADR-022. Native CPU-Profile fehlgeschlagener Budgetläufe belegen wiederholte Drizzle-Aufbau- und SQLite-Vorbereitungsarbeit. Samplezahlen sind keine CPU-Millisekunden und kein Beschleunigungsnachweis.

## Architektur vor Umsetzung

**A, gewählt:** feste, private Query-Slots pro Store und Datenbankverbindung. Jeder Slot entsteht erst beim ersten tatsächlichen Aufruf und enthält ausschließlich SQL, Statement und statische Selektionsmetadaten. Konkrete Store-Methoden binden aktuelle Argumente mit Drizzle-Platzhaltern. Ein neuer Store nach Wiederöffnung erhält eigene Slots. Konstruktoren bleiben ohne Datenbankzugriff; bestehende Fehlerzeitpunkte und unmittelbare Transaktionen bleiben erhalten.

**B, verworfen:** globaler unbegrenzter SQL-LRU oder Daten-/Headercache. Lebensdauer und Besitz wären nicht an die Verbindung gebunden. Zeilen, Tokens, Header, Schemaergebnisse, Generationen, Leases, Bereitschaft, Quoten und Entscheidungen werden nicht gespeichert.

Gültige und zurückgestellte Autorisierungsantworten behalten getrennte SET-Varianten. Erfasste Hinweisrevision, Generation, Tokenrevision, Besitzer, Kind und Status bleiben unveränderte Schreibzäune. Zeit, Benutzerargumente und zufällige Besitzer entstehen weiterhin pro Aufruf. Öffentliche Signaturen und Zeilendecoder bleiben unverändert. Seltene OAuth-/Abschlusspfade sind nicht Teil einer pauschalen Umstellung.

## Abnahmekriterien

- [x] Feste Abfragen werden pro Store und Query erst bei Bedarf vorbereitet, danach mit frischen Bindungen ausgeführt.
- [x] Fremde Commits, fehlende und später eingefügte Zeilen, Wiederöffnung, neue Generationen/Tokenrevisionen, Lease-Besitz und Rückrollen bleiben sichtbar.
- [x] Erfasste Hinweisrevision und getrennte gültige/zurückgestellte Bestätigung bleiben korrekt.
- [x] Budgetfenster, verspätete Header, Pending-Zähler und Halb-/Vollkontingente bleiben unverändert.
- [x] Bestehende Tests einschließlich langem Budgetfall bleiben bytegleich. Keine Fristen, Uhren, Schleifen, Parallelität oder Ressourcenlimits verändert.
- [x] Reguläres Gate, normaler Build und ursprüngliche zwölf gebaute Auslieferungsfälle bestehen. Private Gegenprobe mit altem Limiter scheitert weiterhin am fehlenden späteren Poll.

## Testplan und Status

Neue gezielte SQLite-Regressionen mit zwei Verbindungen und Wiederöffnung. Private beobachtende Zählung tatsächlicher Prepare-Aufrufe, keine produktive Test-DI und keine Latenzschwelle. Bestehende Store-/Autorisierungstests zuerst, danach Typecheck, Format/Lint, `CI=1 E2E_PORT=5256 mise run check`, normaler Build und unveränderte gebaute Gesamtprüfung seriell.

## Lokaler Softwarestand

Implementiert sind 15 feste Query-Pläne in den vier bestehenden Stores. Elf neue SQLite-Regressionen prüfen die genannten Frische- und Besitzbedingungen. Typecheck und Lint bestehen. Das reguläre Gate mit `CI=1 E2E_PORT=5256` besteht mit 1061 Unit-/Integrationstests und 50 Browserfällen. Normaler Build und alle zwölf ursprünglichen gebauten Auslieferungsfälle bestehen anschließend seriell und ohne Beobachter.

Eine private Zählprobe beobachtet ausschließlich die tatsächliche SQLite-Instanz. Bei identischen 100 Arbeitszyklen führen Basis und Korrektur jeweils 1800 SQL-Operationen mit denselben SQL-Texten aus. Die Basis bereitet 1800 Statements vor. Die Korrektur bereitet 15 Statements vor und bleibt nach dem ersten Zyklus bei 15. Die Probe belegt begrenzte Vorbereitungsarbeit, keine Latenzverbesserung. Der unveränderte lange Budgetfall scheitert mit ausschließlich altem Limiter weiterhin am tatsächlichen späteren Poll mit 0 statt 1.

Alle zwölf Quellmanifeste enthalten dieselben 516 Dateien, die bisherigen 515 plus die neue Testdatei. Der gebaute Server hat SHA-256 `2c10ba6eaa82527511afb18292652af24dc8d26f4e1c37f331f6f793d57597f0`. Private Belege liegen unter `$TMPDIR/opencode/strava-query-preparation-*` und `full-ride-delivery-proof-suite-MSmKj0/`.

Unabhängiges Review bestanden. Der exakte PR-Head `614befe7bc225508ce8fb9194edbda744ea67e4b` besteht beide nativen vollständigen Gates; der baumgleiche Main `61ca9c0aac33c5ad9730931b3397e7b9c9d677c4` besteht zusätzlich alle drei Main-Prüfjobs. Jeweils 1061 Tests und 50 Browserfälle einschließlich des unveränderten Budgettests. [Issue #35](https://github.com/henrysachs/voltonaut/issues/35) ist damit geschlossen. Der API-Deploy wartet noch auf seine menschliche Produktionsfreigabe. Keine Beschleunigungsquote, Hardware- oder persönliche Strava-Pilotabnahme wird behauptet.
