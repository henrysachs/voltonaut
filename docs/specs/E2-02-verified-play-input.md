# Spec E2-02 – Hardwarebelegte Play-Eingaben

- **Ziel:** Beide erfassten Zwift-Play-Griffe im Spiel verbinden, seitlich genau einmal pro Druck schalten und bekannte Eingaben im BLE-Labor lesbar anzeigen.
- **Bezug:** E2, Klartext-Handshake, `0x07`, parallele Griffe, Flankenerkennung. Kein Abschluss von Trainersteuerung oder vollständiger E2-Hardware-Abnahme.
- **Module:** `packages/ble`, Geräteverdrahtung und Verbindungsdialog in `apps/web`, BLE-Labor, neue anonymisierte Hardware-Fixtures.
- **Status:** Software einschließlich P1-Besitzkorrektur implementiert und unabhängig nachgeprüft. Vollständiges Gate mit 620 Unit-Tests samt Coverage und 21 E2Es auf Port 5194 grün. Gemeinsame reale Funkabnahme bleibt offen. Keine echte Bluetooth-Verbindung durch Agenten.

## Architekturentscheidung

Form A: Zwei Adapter mit erwarteter Seite. BLE besitzt Parser, Handshake, Seitenprüfung, Flanken und Wiederverbindung. UI zeigt Zielseite sowie ausdrücklich noch unbekannte oder tatsächlich erkannte Seite. Ein falscher Griff erzeugt einen behebbaren Fehler, keine Schaltung.

Form B: Zwei generische Controller-Slots mit erst später erkannter Seite. Die Zuordnung ist ehrlich, verlangt jedoch zusätzliche gemeinsame Geräte-/Seitenreservierung gegen doppelte Auswahl. Gewählt ist A. Bestehende Adapter-Shell, Transport-FIFO und Retry-Policy bleiben die einzige Lifecycle-Infrastruktur.

`ByteReader → ParseResult<PlayInput> → controller.button → EventBus → EngineLink → Worker → HUD`. Der Parser liefert eine Seitenunion mit konkret benannten Tasten und zwei rohen Analogkanälen. Nur die Seitentaste erzeugt Spielaktionen. Das bestehende `source` enthält Geräteidentität und tatsächlich geprüfte Seite. Andere Tasten bleiben reine Diagnosewerte. Kein neuer Shared-/Engine-Vertrag.

## Abnahmekriterien

- [x] Neue Fixtures erhalten sämtliche Bytes, Zeiten, Marker und GATT-Daten der beiden Originale. Nur Browser-Geräte-ID und vollständiger User-Agent sind anonymisiert; Herkunft und SHA-256 sind dokumentiert.
- [x] Alle 647 erfassten `0x07`-Frames werden dekodiert. Marker belegen A/B/Y/Z, Steuerkreuz und Seitentaste mit Drücken/Loslassen; Seitenwert rechts `0`, links `1`; Zigzag bleibt roh.
- [x] Eigenständiger begrenzter Varint-Parser ohne GPL-Code oder neue Abhängigkeit. Fehlende/doppelte Felder, falscher Wire-Type, ungültige Enums, Überläufe und abgeschnittene Pakete liefern Fehler statt Tasten. Unbekannte Nachrichtentypen erzeugen keine Eingaben.
- [x] `…02` und `…04` sind vor genau einem `RideOn` auf `…03` abonniert. Native Writes verwenden die tatsächlich angebotene `writeWithoutResponse`-Eigenschaft. Nur die exakt beobachtete Klartextantwort bestätigt den Handshake. Unbekannte/verschlüsselte Antworten stoppen den Versuch.
- [x] Je Zielseite ein eigener Adapter, Status und Reconnect ohne erneuten Picker. Auswahl erfolgt synchron im Nutzerklick. Vor bestätigtem Handshake kein `ready`; vor Seitenprüfung keine Spielereignisse. Falsche Seite erklärt die Korrektur.
- [x] Rechts schaltet hoch, links runter. Wiederholte gehaltene Frames erzeugen keine Wiederholung. Trennen setzt Flanken zurück und veröffentlicht nötige Releases. Alte/abgebrochene Sessions erzeugen keine Daten oder Bereitschaft.
- [x] BLE-Labor nutzt ausschließlich den öffentlichen BLE-Parser für lesbare Seite, Tasten und rohe Analogwerte. Unbekanntes bleibt roh. Keine Grad-, Brems-, Neigungs- oder Lenkwirkung; Marker, Pause, Presets, Export und Sitzungsisolation bleiben erhalten.
- [x] Unit-/Replay-Prüfung sowie isolierter Browsernachweis auf Port 5194 zeigen echte Adapter und Worker/HUD mit beiden DI-Griffen, Halten und Tastatur. Keine Writes außer `RideOn` am Controller.
- [x] Format, Lint, Typecheck, Modulgrenzen, Guard, Unit-Tests mit Coverage und Web-Build grün.
- [x] Vollständiges `E2E_PORT=5194 CI=true mise run check` nach Elternfreigabe grün. Die laufende Aufnahme auf 5173 bleibt unberührt.

## Softwarebelege

- Vollständiges Gate: 620 Tests in 107 Dateien mit unveränderten Coverage-Schwellen und 21 E2Es bestanden. Keine bestehenden Tests gelöscht oder abgeschwächt.
- `packages/ble/src/zwift-play/parse.test.ts`: sämtliche echten Frames, Marker, Vorzeichen, Grenzwerte und beschädigte Protobuf-Eingaben.
- `adapter.replay.test.ts`: Beide vollständigen Mitschnitte laufen durch die öffentliche BLE-API. Links entstehen sechs Flanken, rechts vier. Der Adapter sendet jeweils genau ein `RideOn`.
- `adapter.test.ts` und `session.races.test.ts`: gehaltene Frames, gleichzeitige Quellen, Seitenfehler, abgebrochene Auswahl, verzögerte Connects, Writes und Subscriptions, Handshake-Timeout, Reconnect und alte Callbacks.
- `webBluetoothTransport.test.ts`: tatsächliche native WithoutResponse-Methode, einschließlich Characteristics mit beiden Write-Properties.
- `deviceOwnership.test.ts`: derselbe Griff kann nicht zwei native Transporte besitzen. Ein abgelehnter Griff bleibt für Retry gemerkt, ohne dem fremden Slot zu gehören. Neue Auswahl trennt den fremden Slot nicht.
- `apps/web/src/debug/ble/session.test.ts`: lesbare A-/Steuerkreuz-Werte und rohe Analogwerte. Unbekannte und beschädigte Frames bleiben roh. Bestehende Labor-Tests bleiben erhalten.
- `play-controller.spec.ts`: Trainer, Puls und beide Play-Griffe parallel durch echte Browseradapter, Dedicated Worker und WebGL. Ein Druck pro Richtung ändert den Gang einmal. Mehrere gehaltene Pakete ändern ihn nicht weiter. Tastatur und Reconnect funktionieren.
- Auf derselben isolierten Instanz bestanden zusätzlich beide vorhandenen Fälle aus `connect-ride.spec.ts` und der vorhandene Sim-Fall aus `sim.spec.ts`. Der bestehende Picker-Test verlangt weiterhin synchrone Browseraktivierung.

Der bestehende Picker-Test deckte zunächst einen Fehler der neuen Besitzprüfung auf. Ein abgelehnter Griff war nicht für Retry gemerkt. Auswahl und GATT-Besitz werden nun getrennt gespeichert. Derselbe unveränderte Browsertest besteht danach.

Die gezielte Browserprüfung nutzt Port 5194, eine eigene temporäre Vite-Konfiguration und ein eigenes Cache-Verzeichnis. Konfigurationen und Belege liegen unter `/private/var/folders/23/tg_nxvb56ybfx4bqy70w6rjm0000gn/T/opencode/`. Der erste Belegordner heißt `verified-play-browser-proof-5194`. Er enthält `verified-play-di-connections.png`, `verified-play-di-worker.png` und `verified-play-di-hud.png`. Keine Screenshots sind neue Baselines.

## P1-Korrektur nach unabhängigem Review

Das Review belegte einen Fehler trotz des ersten grünen Gates. Nach Freigabe einer Verbindung blieb der frühere Gerätezeiger für Cleanup erreichbar. Nach einem Besitzerwechsel trennte der alte Slot damit den neuen Besitzer. Sowohl **Trennen** nach abgelehntem Wiederverbinden als auch die Auswahl eines Ersatzgeräts lösten den Fehler aus.

Vor der Produktionsänderung wurden beide Fälle in `deviceOwnership.test.ts` ergänzt und rot ausgeführt. Beide meldeten einen fremden nativen Disconnect statt null. Zwei weitere rote Checks belegten verlorene Metadaten einer abgelehnten Auswahl und zu frühe Lease-Freigabe während ausstehendem `stopNotifications()`. Beide Browserregressionen wurden ebenfalls zuerst rot ausgeführt. Der native Disconnect-Zähler stieg dort von eins auf zwei, und der rechte Griff musste erneut handshaken.

Die Korrektur trennt drei Dinge:

1. Die gemerkte Auswahl liefert Geräte-ID, Namen und den Handle für pickerfreie Wiederholung. Sie berechtigt nicht zu GATT-Zugriffen oder Cleanup.
2. `GattConnection` ist entweder `unowned` oder `owned`. Nur `owned` enthält Gerät, Servicecache, Session-Signal und Cleanup. Invalidierung entfernt den aktiven Besitz sofort aus dem Transport.
3. Die abgelöste Besitzinstanz behält ihre Lease bis zum Ende ihrer FIFO. Erst nach laufenden Operationen, Notification-Abmeldung und eigenem nativen Disconnect wird die Lease freigegeben. Idempotentes Schließen kann später keinen neuen Besitzer treffen.

`GattServices` enthält keine Geräte- oder Serverzeiger mehr. IO verwendet ausschließlich die aktive Besitzinstanz. Advertisement-Observer sind ebenfalls an deren Lebensdauer gebunden. Beim Trennen werden Listener entfernt und ihre AbortController abgebrochen. Bereits zugestellte alte Callbacks bleiben gesperrt. Gemerkte Metadaten bleiben nach Trennen erhalten.

Grüner Nachweis nach der Korrektur:

- 55 fokussierte Tests in neun Dateien bestanden. Dazu gehören die beiden originalen P1-Regressionsfälle, verzögerter Connect, ausstehendes Notification-Teardown, alte Disconnect-Callbacks, Advertisement-Cleanup und beide vollständigen Hardware-Replays.
- Sieben fokussierte Browserfälle bestanden. Beide Besitzerwechsel-Fälle halten den fremden rechten Slot auf `ready`. Kein zusätzlicher nativer Disconnect oder Handshake erfolgt. Seine Pakete schalten weiterhin genau einen Gang. Die vorhandenen Halte-, Tastatur-, Sim- und Picker-Prüfungen bleiben grün.
- Die unveränderten Prüferskripte wurden erneut ausgeführt. Drei unabhängige Unit-Prüfungen und der originale Browserfall bestanden auf 5194.
- `E2E_PORT=5194 CI=true mise run check` bestand mit 620 Unit-Tests und 21 E2Es. Der temporäre Prüfserver wurde vorher beendet. Playwright verwaltete seinen eigenen Server auf 5194.
- Web-Build, Guard, Modulgrenzen, Format, Lint, Typecheck und `git diff --check` bestanden. Original-Hashes und Fixture-Gleichheit nach ausschließlich den zwei erlaubten Metadatenersetzungen wurden erneut geprüft.

Das Belegverzeichnis heißt `play-controller-correction-sol` unter dem oben genannten temporären Wurzelverzeichnis. Es enthält `red-unit.log`, `red-browser.log`, `green-focused.log`, `green-browser.log`, `reviewer-unit-green.log`, `reviewer-browser-green.log`, `full-gate.log`, `build.log` und `fixtures.log`. Rote Browser-Traces bleiben unter `browser-red`. Grüne Screenshots liegen unter `browser-green`, einschließlich `foreign-owner-disconnect.png` und `foreign-owner-replacement.png`. Die reproduzierbaren Regressionstests und dieser Befund bleiben zusätzlich im Repository.

Das unabhängige Nachreview genehmigt die Korrektur. Es besteht die unveränderten ursprünglichen Proben mit zwei Unit-Fällen und einem Browserfall. Vier zusätzliche Lifecycle-Proben, 21 bestehende native Lifecycle-Tests und vier aktuelle Browserfälle bestehen ebenfalls. Alle 34 geprüften Quellhashes bleiben unverändert. Der Reviewbeleg liegt unter `$TMPDIR/opencode/play-ownership-correction-review-Qjg3yV0x/REVIEW.md`. Die integrierende Session bestätigt danach erneut das vollständige Gate mit 620 Unit-Tests und 21 E2Es sowie den Build.

## Grenzen

Beide Quellmitschnitte sind echte Hardwaredaten. Neue Tests verbinden keine echte Hardware. Firmware bleibt unbekannt; physische Bedeutung und Kalibrierung der Analogkanäle bleiben `UNVERIFIED`. `0x15`/`0x19`, andere Nachrichtentypen und andere Services werden nicht als Tastenzustände interpretiert. Keine Verschlüsselung, Haptik oder Trainersteuerung. Gleichzeitiger realer Betrieb mit Trainer/Puls und die Zuverlässigkeitsfahrt bleiben manuelle Abnahme, keine erneute Tastenvermessung.

## Dateiliste zur Integration

```text
apps/web/e2e/helpers/playBluetooth.ts
apps/web/e2e/play-controller.spec.ts
apps/web/src/debug/ble/session.test.ts
apps/web/src/debug/ble/session.ts
apps/web/src/rideDevices.ts
apps/web/src/ui/connect/dialog.test.ts
apps/web/src/ui/connect/dialog.ts
docs/02-bluetooth.md
docs/07-roadmap.md
docs/specs/E2-02-verified-play-input.md
fixtures/ble/zwift-play-hardware-20261120.md
fixtures/ble/zwift-play-left-hardware-20261120.json
fixtures/ble/zwift-play-right-hardware-20261120.json
packages/ble/src/deviceOwnership.test.ts
packages/ble/src/ftms/presets.ts
packages/ble/src/index.ts
packages/ble/src/testdata/playRig.ts
packages/ble/src/testdata/webCentral.ts
packages/ble/src/transport.ts
packages/ble/src/uuids.ts
packages/ble/src/webBluetoothConnection.ts
packages/ble/src/webBluetoothDiscovery.ts
packages/ble/src/webBluetoothGatt.ts
packages/ble/src/webBluetoothTransport.test.ts
packages/ble/src/webBluetoothTransport.ts
packages/ble/src/webBluetoothTypes.ts
packages/ble/src/zwift-play/adapter.replay.test.ts
packages/ble/src/zwift-play/adapter.test.ts
packages/ble/src/zwift-play/adapter.ts
packages/ble/src/zwift-play/parse.test.ts
packages/ble/src/zwift-play/parse.ts
packages/ble/src/zwift-play/session.races.test.ts
packages/ble/src/zwift-play/session.ts
scripts/import-play-captures.mjs
```

`SnifferSession` bleibt unverändert. Labor-Geräteverwaltung, `debug/ble/main.ts`, HTML und CSS gehören zum getrennten Mehrgeräte-Teilschritt. Keine Änderungen an Server, Shared, Engine, Rules oder Leitplanken. Port 5194 und alle eigenen Hilfsprozesse sind bei der Übergabe beendet. Port 5173 wurde weder bedient noch beendet.

Die zusätzliche Änderung an `apps/web/playwright.config.ts` stammt von der Elternsession. Sie stellt `E2E_PORT` bereit und gehört nicht zur obigen Dateiliste. Standard bleibt 5173. Diese Korrektur hat weder den Mehrgeräte-Prüfserver auf 5195 noch den für das Nachreview reservierten Port 5198 verwendet.

## Offene Fragen

Keine Implementierungsfragen. Reale Firmware und gemeinsame Funkstabilität bleiben unbekannt.
