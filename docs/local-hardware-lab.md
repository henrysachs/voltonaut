# Lokaler Stand für Bluetooth-Tests

## Öffnen

- App mit echten Geräteadaptern: <http://localhost:5173/>
- BLE-Labor: <http://localhost:5173/debug/ble.html>
- Simulator ohne Hardware: <http://localhost:5173/?sim=1>
- API-Health: <http://localhost:3300/healthz>

Verwende Chrome oder Edge und die Adresse `localhost`. Der Browser behandelt sie als sicheren Kontext für Web Bluetooth. Die Geräte werden über **Gerät wählen** ausgewählt. Eine vorherige Kopplung im macOS-Bluetoothmenü ist normalerweise nicht nötig.

Die normale App und das BLE-Labor verwenden die echte Bluetooth-API. Es werden keine Geräte-Fakes injiziert. Nur die ausdrücklich gewählte URL `?sim=1` erzeugt simulierte Messwerte.

## Enthaltener Entwicklungsstand

Der lokale Branch `lab/hardware-all` enthält Welt und Fahrer, lesende Traineranbindung, Sniffer, Aufnahme und TCX, Browserkonto, Profil-/Fahrtenspeicherung, manuelle kontogebundene Outbox, Replay-Prüfmodul, Strava-Servergrundlage und Deploy-Werkzeuge. Auch die pausierten Korrekturen und noch nicht abschließend geprüften Implementierungen sind als lokale Snapshots integriert. Die ursprünglichen Worktrees bleiben unverändert.

Anmeldung erfolgt ausdrücklich über **Anmelden** als lokaler Testnutzer `tester@voltonaut.local`. Der Provider signiert echte Testtokens, ist aber keine Cloudflare-Anmeldung. Der Strava-Server verwendet ausschließlich einen lokalen Protokoll-Fake. Eine Strava-Oberfläche und echte Uploads sind nicht freigegeben. Keine echten Provider-Zugangsdaten werden verwendet.

Der Render-Worker ist weiterhin ein separates Wegwerfexperiment und ersetzt nicht den Renderer dieses Teststands. Replay-Prüfung bedeutet noch keine aufgezeichnete oder serverseitig angenommene prüfbare Fahrt.

## Erster Hardwaretest

1. Stelle den Trainer sicher auf und versorge ihn mit Strom.
2. Schließe Zwift, Wahoo, Rouvy und andere Apps, die das Gerät verbunden halten könnten.
3. Öffne das BLE-Labor in Chrome oder Edge.
4. Klicke **Gerät wählen** und wähle den Trainer im Browserdialog.
5. Prüfe zunächst nur Gerätestatus und GATT-Dienste. Verwende noch keine Schreibbefehle oder Widerstands-Presets.

Trainer und Controller reichen für den Beginn. Die Pulsgurt-Abnahme bleibt offen. Firmware, genaue Gerätebezeichnung und echte JSON-Mitschnitte werden während des gemeinsamen Tests erfasst. Reale Messungen sind nicht durch Simulatorprüfungen ersetzt.

## Lokaler Betrieb

Ein Launcher besitzt Web, API und beide Testprovider. Er bindet nur Loopback-Adressen. API und Browser verwenden dieselbe Hostbezeichnung, damit Cookiebindung und exaktes CORS zusammenpassen. Die Providerports sind 3301 und 3302.

Der Launcher liegt als lokales Arbeitsartefakt unter `$TMPDIR/opencode/local-lab-launcher-QCQSQs/run.mjs`. Im Integrationsworktree startet folgender Befehl denselben Stand:

```sh
mise exec -- node "$TMPDIR/opencode/local-lab-launcher-QCQSQs/run.mjs" "$PWD"
```

Starte keine zweite Kopie auf belegten Ports. `Ctrl+C` beendet nur die zugehörigen Prozesse und lässt Daten und Logs bestehen. Der Launcher gibt den privaten Logordner und ein Prozessmanifest aus.

Die lokale SQLite-Datenbank und ausschließlich erzeugte Testschlüssel liegen außerhalb des Repositories unter `$TMPDIR/opencode/voltonaut-hardware-lab-state`. Sie bleiben bei einem Launcher-Neustart erhalten. Der Ordner ist kein dauerhaftes Backup; macOS kann temporäre Dateien bereinigen. Echte Hardware-Mitschnitte deshalb als JSON herunterladen und getrennt aufbewahren. Der Fake-Strava-Provider hält seine Grants nur im Arbeitsspeicher.

Dieser Stand ist keine Produktionsfreigabe. `main`, öffentliche Website und VPS werden dadurch nicht geändert.
