# Lokaler Stand für Bluetooth-Tests

## Öffnen

- App mit echten Geräteadaptern: <http://localhost:5173/>
- BLE-Labor: <http://localhost:5173/debug/ble.html>
- Statische Mehrgeräteansicht: <http://localhost:5195/debug/ble.html>
- Simulator ohne Hardware: <http://localhost:5173/?sim=1>
- API-Health: <http://localhost:3300/healthz>

Verwende Chrome oder Edge und die Adresse `localhost`. Der Browser behandelt sie als sicheren Kontext für Web Bluetooth. Die Geräte werden über **Gerät wählen** ausgewählt. Eine vorherige Kopplung im macOS-Bluetoothmenü ist normalerweise nicht nötig.

Die normale App und das BLE-Labor verwenden die echte Bluetooth-API. Es werden keine Geräte-Fakes injiziert. Nur die ausdrücklich gewählte URL `?sim=1` erzeugt simulierte Messwerte.

Die Mehrgeräteansicht auf 5195 hat kein Hot-Reload. **Gerät hinzufügen** öffnet jeweils eine native Auswahl. Drei Karten zeigen Trainer und beide Griffe getrennt. Der Ansichtswechsel trennt keine Verbindung. Die Play-Spielanbindung ist dort noch nicht enthalten. Exportiere offene Mitschnitte vor dem Schließen oder Neuladen eines Labortabs.

## Quellstand und Bereitstellung

Der bereitgestellte Commit steht in der aktuellen Statusmeldung. Ein Merge auf `main` aktualisiert keinen Dev-Server in einem anderen Worktree. Der lokale Branch `lab/hardware-all` wird deshalb getrennt auf den geprüften Stand aktualisiert. Unfertige Aufnahme- oder Strava-Arbeit bleibt isoliert.

Die folgenden Menüpfade gelten erst nach dem lokalen Rollout des Ingame-Menüs. Implementierung und Softwareprüfung allein bestätigen keine Bereitstellung. Maßgeblich bleibt der tatsächlich laufende Commit aus der Statusmeldung.

Im kombinierten Menü-Stand laufen Welt und Fahrer im Render-Worker. Das Ingame-Menü hält Profil, Aufnahmen und Konto in Overlays. Fahrt und Geräte laufen beim Öffnen weiter. **Geräte verbinden** öffnet den Gerätedialog. Der Trainer bleibt nach dem Verbinden zunächst lesend; Widerstandssteuerung braucht eine eigene Freigabe.

Anmeldung erfolgt ausdrücklich über **Menü → Konto → Anmelden** als lokaler Testnutzer `tester@voltonaut.local`. Der Provider signiert echte Testtokens, ist aber keine Cloudflare-Anmeldung. Die Software aus E10-04 ergänzt unter **Strava** Verbindung und ausdrückliche Einzelfahrtfreigabe. Nach ihrem getrennt gemeldeten Rollout verwendet der lokale Server weiterhin ausschließlich einen Protokoll-Fake. Ein echter Strava-Pilot braucht gesonderte Zustimmung. Keine echten Provider-Zugangsdaten werden verwendet.

Lokale Aufnahme und TCX funktionieren ohne Anmeldung. Replay-Prüfung ist kein Hardwareattest. Ob Worker-Aufzeichnung, V2-Annahme oder Strava-Auslieferung bereits bereitgestellt sind, nennt die jeweilige Statusmeldung getrennt. Testzahlen und vorbereitete Module ersetzen diesen Nachweis nicht.

Journalaufnahmen enthalten für die Servernachrechnung auch Vorlaufdaten seit Sitzungsbeginn einschließlich verworfener Fenster. Die Kontozuordnung weist vor der Übertragung darauf hin. TCX und Strava exportieren nur das gewählte Fenster. Mengen- oder Bytegrenzen können das Journal vor sechs Stunden beenden. Dann bleiben lokale Aufnahme und TCX möglich, aber kein nachrechenbarer Fahrtupload.

## Ein neues Gerät aufnehmen

Das Labor erklärt jeden Schritt selbst; dies ist die Kurzfassung.

1. Andere Apps (Zwift, Companion, Wahoo, Uhren) schließen. Chrome oder Edge über `localhost` öffnen.
2. **Gerät hinzufügen** einmal pro Gerät. Trainer, jeder Griff und jeder Click-Puck sind eigene Geräte.
3. Ab dem Verbinden läuft die Aufzeichnung aller Kanäle; Firmware und Fähigkeiten werden automatisch gelesen. Kein Subscribe nötig.
4. Der Anleitung auf der Gerätekarte folgen. Vor jeder Aktion einen **Marker** setzen, sonst lässt sich ein Byte keiner Taste zuordnen.
5. **Alle exportieren** lädt eine Datei pro Gerät (`ble-<nr>-<name>-<zeit>.json`). Mitschnitte leben nur im Tab.

Ein Zwift Hub One verbindet im Spiel als **Trainer**, ein Click v2 in **Linker/Rechter Controller**. Beides ist softwaregeprüft, Hardwareabnahme offen ([E2-04](specs/E2-04-hub-click-v2-guided-lab.md)).

## Rollenschaltung und Hardwareabnahme

Beide echten Play-Mitschnitte bestätigen die Zuordnung: rechts höher, links niedriger, einmal pro Druck. Eine erneute Tastenvermessung ist nicht nötig. Das Labor zeigt Seite, Tasten und unkalibrierte Analogrohwerte.

Die [FTMS-Steuerung](specs/E2-03-ftms-virtual-shifting.md) verlangt passende Features, Echtzeit und ausdrückliche Aktivierung. Erst bestätigte Control-Point-Prozeduren erlauben begrenzte Engine-Ziele. Reconnect nimmt die Widerstandssteuerung nicht automatisch wieder auf. Ein Zielwert allein ist keine Bestätigung.

Die Softwareprüfungen verwenden Sim- und native GATT-Fakes. Widerstandsgefühl, Firmware, Kalibrierung, gleichzeitiger Funkbetrieb und Latenz brauchen die gemeinsame Probefahrt. Bis dahin gilt **softwaregeprüft, Hardwareabnahme offen**. Die Trainermasse von 83 kg ist eine Annahme.

## Gemeinsame Probefahrt

1. Stelle den Trainer sicher auf und versorge ihn mit Strom.
2. Schließe Zwift, Wahoo, Rouvy und andere Apps, die das Gerät verbunden halten könnten.
3. Öffne die App auf 5173 ohne `sim=1` und ohne `clock=fast`.
4. Prüfe unter **Menü → Profil** Gewicht, reales Kettenblatt und reales Cog. Speichere Änderungen und lade vor dem Verbinden neu. Profiländerungen gelten erst für die nächste Fahrt.
5. Öffne **Geräte verbinden**. Wähle Trainer, **Linker Controller** und **Rechter Controller** getrennt über **Gerät wählen**.
6. Prüfe Bereitschaft sowie plausible Watt- und Kadenzwerte. Aktiviere erst danach **Widerstand aktivieren** und warte auf die bestätigte Freigabe.
7. Prüfe beim kontrollierten Treten rechts und links jeweils HUD-Gang, bestätigtes Ziel und tatsächliches Widerstandsgefühl. Halten darf nicht wiederholt schalten.
8. Öffne das Menü. Fahrt und Play müssen weiterlaufen. Pfeiltasten in einem Profilfeld dürfen den Trainer nicht schalten.
9. Deaktiviere die Rollenschaltung ausdrücklich. Prüfe nach sicherem Anhalten Disconnect und Reconnect. Eine erneute Widerstandsfreigabe braucht einen neuen Klick.

Trennen oder Tab-Schließen garantiert keine Neutralisierung. Ein bestätigter Stop ist kein Stillstandsnachweis. Bei fehlender Bestätigung bleibt der Widerstand unbekannt; beende die Belastung kontrolliert und verbinde erst danach neu.

Trainer und beide Controller reichen für den Beginn. Die Pulsgurt-Abnahme bleibt offen. Notiere Gerätebezeichnung und Firmware beim gemeinsamen Test. Für zusätzliche GATT-Details und JSON-Mitschnitte bleibt das Labor auf 5195 verfügbar. Lade eigene Mitschnitte getrennt als Backup herunter.

## Lokaler Betrieb

Ein Launcher besitzt Web, API und beide Testprovider. Er bindet nur Loopback-Adressen. API und Browser verwenden dieselbe Hostbezeichnung, damit Cookiebindung und exaktes CORS zusammenpassen. Die Providerports sind 3301 und 3302.

Der Launcher liegt als lokales Arbeitsartefakt unter `$TMPDIR/opencode/local-lab-launcher-QCQSQs/run.mjs`. Im Integrationsworktree startet folgender Befehl denselben Stand:

```sh
mise exec -- node "$TMPDIR/opencode/local-lab-launcher-QCQSQs/run.mjs" "$PWD"
```

Starte keine zweite Kopie auf belegten Ports. `Ctrl+C` beendet nur die zugehörigen Prozesse und lässt Daten und Logs bestehen. Der Launcher gibt den privaten Logordner und ein Prozessmanifest aus.

Die lokale SQLite-Datenbank und ausschließlich erzeugte Testschlüssel liegen außerhalb des Repositories unter `$TMPDIR/opencode/voltonaut-hardware-lab-state`. Sie bleiben bei einem Launcher-Neustart erhalten. Der Ordner ist kein dauerhaftes Backup; macOS kann temporäre Dateien bereinigen. Echte Hardware-Mitschnitte deshalb als JSON herunterladen und getrennt aufbewahren. Der Fake-Strava-Provider hält seine Grants nur im Arbeitsspeicher.

Dieser Stand ist keine Produktionsfreigabe. `main`, öffentliche Website und VPS werden dadurch nicht geändert.
