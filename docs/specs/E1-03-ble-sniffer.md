# Spec E1-03 – BLE-Sniffer integrieren

- **Ziel:** Den vorhandenen Sniffer als separates Diagnosewerkzeug auf die geprüften BLE-APIs portieren.
- **Roadmap:** E1, `debug/ble.html`; keine Abnahme der gesamten Etappe.
- **Status:** Software portiert und automatisiert geprüft. An echter Hardware getestet: nein.
- **Module:** `apps/web/debug/ble.html`, `src/debug/ble/`, Testhilfen, E2E, Vite-Multi-Page-Entry; ergänzende UUIDs und Diagnose-Presets in `packages/ble`.

## Architektur und Grenzen

`SnifferSession` besitzt Mitschnitt und Notification-Abonnements. Transport, Parser, Fixture-Schema und Replay stammen aus der öffentlichen API von `@voltonaut/ble`. JSON wird an der Dateigrenze validiert. Neue Geräteauswahl erfolgt synchron im Klick-Handler; nur nachfolgende GATT-Arbeit darf warten. Wiederverbinden nutzt ausdrücklich das gemerkte Gerät. Zeitstempel sind monoton und relativ zum Sitzungsbeginn.

Gerätebezogene Aktionen binden ihre Sitzung vor dem Einreihen in die Warteschlange. Fehler gehören zum Mitschnitt dieser Sitzung. Nur die ausgewählte Sitzung darf den sichtbaren Gerätestatus ändern. `SnifferObservations` besitzt je Sitzung und Characteristic den ausstehenden oder aktiven Beobachter. Der Explorer leitet seine Schaltflächen daraus ab. Ein Ansichtswechsel beendet keine Hintergrundaufnahme.

Fahrt, `main.ts`, EngineLink, Profil, Server, Engine/Rules und Hardware-Fixtures bleiben unverändert. Kein automatisches Schreiben beim Verbinden. Play-Protokoll bleibt unverifiziert; eine verschlüsselte Antwort sperrt weitere Schreibversuche.

## Messbare Software-Abnahme

- [x] Separater Build erzeugt `index.html` und `debug/ble.html`.
- [x] Replay-E2E bedient Scan, GATT-Explorer samt Properties/Descriptors, Read, Subscribe, Hex-/ASCII-Write, Logger-Pause, Filter, Marker, Presets und schema-validierten JSON-Download ohne Hardware.
- [x] Native Browser-Fake lehnt Picker außerhalb des synchronen Klicks ab; neue Auswahl und gemerktes Wiederverbinden bestehen den Test ohne automatische Writes.
- [x] Session-Tests belegen geteilte Abonnements, natives Unsubscribe beim letzten Empfänger, Abbruch während ausstehendem Subscribe, Teardown und keine doppelten Notifications nach Reconnect.
- [x] Regressionstests bedienen die Produktions-UI mit verzögertem nativem GATT-Fake. Preset und Trennen bleiben trotz ausstehendem Read und Gerätewechsel bei A. Verzögerte Fehler und Marker bleiben ebenfalls bei A.
- [x] Hintergrundaufnahme von A läuft bei Ansicht B weiter. Unsubscribe nach A → B → A beendet die Aufnahme. Ausstehende Beobachter bleiben nach erneutem Rendern bedienbar und werden beim Verbindungsabbruch nicht wiederhergestellt. Andere Empfänger bleiben abonniert.
- [x] Export → JSON-Parse → ReplayTransport funktioniert ab t=0 auch bei wiederholten Sitzungen und fortgeschrittener monotoner Uhr.
- [x] Ungültiges Hex und Nicht-ASCII werden abgelehnt. Widerstandswarnung sichtbar. FTMS-Presets abonnieren Indications vor Writes und warten jede erfolgreiche Antwort ab. Timeout/Fehler verhindern Folgeschritte.
- [x] Verschlüsselte Play-Antwort stoppt weitere Writes; unbekannte Play-Nachrichten bleiben Rohdaten.
- [x] `CI=true mise run check`, Web-Build und `git diff --check` grün; bestehende Fahrt-/Profil-/Hintergrund-E2Es erhalten.

## Testplan

Vitest prüft Session-Lebenszyklus, relative Zeitstempel, Export-Replay und Preset-Bytes/Antworten. Playwright prüft Replay-UI und synchronen nativen Picker. Gesamtes Gate gemäß `docs/10-testing.md`. Keine neuen Abhängigkeiten oder gelockerten Leitplanken.

Die drei zuerst ergänzten Regressionstests schlugen vor der Korrektur fehl. A erhielt keine Preset-Writes, A wurde nicht getrennt, und nach erneutem Rendern zeichnete Unsubscribe einen weiteren Frame auf. Derselbe Testlauf besteht nach der Korrektur. Alle Geräteantworten stammen aus Fakes oder Replay. Es gab keine Bluetooth-Schreibzugriffe auf echte Geräte.

## Hardware-Abnahme offen

Keine Aussage über reale Geräte, Firmware, Play-Tastenmapping, Verschlüsselung oder Widerstand. Echte Captures und Hardware-Abnahme erfolgen separat nach `docs/02-bluetooth.md` §5. Roadmap-Hardware-Checkboxen bleiben offen.

## Offene Fragen

Keine für die Software-Portierung. Hardware-Fragen bleiben unverändert offen.

## CI-Nachtrag am 20.11.2026

Der Replay-Browsertest wurde unter verzögerter Automation dreimal mit dem CI-Fehler reproduziert. `page.clock.install()` allein hielt die Uhr nicht an; `fastForward()` bündelte dadurch Antworten verschiedener Preset-Schritte. Der Test pausiert die Uhr jetzt vor der Navigation und verarbeitet Zeitabschnitte mit `runFor()`. Anwendung, Fixture und Assertions bleiben unverändert. Temporäre Diagnose-Verzögerungen wurden entfernt.

Nach der Korrektur bestanden 30 wiederholte Sniffer-Browsertests. Nach Integration des aktuellen `main` samt Auth-Grundlage ist auch `CI=true mise run check` mit 311 Tests und acht E2Es grün. Beide HTML-Seiten bauen. Das unabhängige Nachreview des Test-Fixes ist Approve.
