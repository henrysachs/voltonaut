# Spec E1-02 – BLE-Verbindung zur E3-Fahrt

- **Ziel:** Trainer und Pulsgurt nur lesend mit der vorhandenen E3-Fahrt verbinden.
- **Bezug:** E1, Parser und Verbindungsdialog. Kein Abschluss der E1-Hardware-Abnahme.
- **Module:** `packages/ble`, `apps/web`, Bluetooth-Dokumentation und Abhängigkeitsregister.
- **Status:** Softwarekriterien einschließlich Regressionen am 20.11.2026 geprüft. An echter Hardware getestet: nein.

## Messbare Softwarekriterien

- [x] HRS-, FTMS-/Feature- und CPS-Parser bestehen Byte-, Property- und synthetische Replay-Tests. Beschädigte Daten werfen nicht.
- [x] Trainer-Auswahl akzeptiert FTMS **oder** CPS und autorisiert beide Services. Ein Test prüft die tatsächlichen Auswahloptionen.
- [x] Adapter melden Zustände und verbinden sich nach Abbruch ohne erneuten Picker. Versuche beginnen frühestens 1, 2, 5, 10 und 15 Sekunden nach dem Abbruch. Nach fünf fehlgeschlagenen Versuchen folgt `error`. Manuelle Wiederholung setzt die Folge zurück. Fehler und Wiederholung sind getestet.
- [x] Der Dialog zeigt Trainer/Puls und Status. Abbruch, Fehler und Wiederholung sind bedienbar. Browser ohne Web Bluetooth erhalten einen Hinweis.
- [x] „Gerät wählen“ öffnet den Picker synchron im Klick. Manuelle und automatische Wiederverbindung verwenden dagegen das gemerkte Gerät. Ein falsches Gerät lässt sich ersetzen.
- [x] CPS meldet nach drei Sekunden ohne Kurbel-Fortschritt explizit 0 rpm. Schnellere wiederholte Frames setzen die Kadenz vorher nicht auf null.
- [x] Native GATT-Operationen einschließlich Notification-Abmeldung laufen pro Transport seriell. Andere Geräte bleiben unabhängig. Abgebrochene Sessions liefern keine verspäteten Daten oder `ready`-Meldungen. Auch nach ausgeschöpften Versuchen und späterem Funkabbruch bleibt `error` manuell behebbar.
- [x] Synthetische GATT-Daten gelangen im echten Browser über Adapter, DeviceEvent, EngineLink und Dedicated Worker ins HUD. Verbunden gilt erst nach `trainer.ready`. Aus der Fahrt erfolgen keine GATT-Schreibzugriffe.
- [x] Sim-Modus, Tastaturschalten, Profilpersistenz, beschleunigte Uhr und Hintergrund-Worker bleiben durch die bestehenden E2Es geprüft.
- [x] `mise run check`, Web-Build und `git diff --check` sind am letzten Stand grün. Engine/Rules und geschützte Konfiguration bleiben unverändert.

## Architektur

Bytes → BLE-Parser/Adapter → typisierter EventBus → vorhandener `EngineLink.ingest` → Worker → Snapshot → HUD. Der `ConnectionMonitor` besitzt den Trainer-Verbindungsstatus. Nur die Composition Root wählt Sim- oder Echtgeräte. Ein fokussiertes Composition-Modul hält Geräteverdrahtung aus Profil-/Worker-Code heraus.

Alternative wäre direkte Verdrahtung sämtlicher Adapter in `main.ts`. Sie vermischt Geräte-Lifecycle mit Profil und Worker und wird daher nicht verwendet.

BLE-Adapter ergänzen `DeviceAdapter` um `select()`; Sim-Slots bieten dieselbe Dialogaktion. Der Transport besitzt Auswahl, Session-Abbruch und eine FIFO für native GATT-Operationen. Der Picker bleibt außerhalb der FIFO, damit die Browser-Aktivierung erhalten bleibt. Abmeldung entfernt Listener sofort und reiht `stopNotifications()` vor die nächste GATT-Operation ein. Fehlgeschlagene Operationen geben die FIFO frei. Adapter-Abbruchsignale verhindern, dass alte FTMS-Lesezugriffe in einer neuen Session weiterarbeiten.

CPS speichert Kurbelzähler und monotone Zeit des letzten Fortschritts über die injizierte Uhr. Der Leerlauf-Timeout beträgt drei Sekunden, entsprechend dem Datenverlustfenster der Engine. Ohne Notifications bleibt die vorhandene E3-Staleness-Erkennung zuständig.

## Nachweise und Grenzen

Unit-/Replay-Tests in `packages/ble/src`, Dialogtests und Browser-E2Es in `apps/web`. Synthetische Fixture-Module liegen unter `packages/ble/src/testdata`; keine echten BLE-Fixtures oder geänderten Test-Compileroptionen.

Nachweis am 20.11.2026:

- `CI=true mise run check`: nach Freigabe des fremd belegten Test-Ports vollständig grün. 261 Tests in 52 Dateien und 5 Browser-E2Es bestanden, einschließlich des verschärften Picker-Tests und des FTMS-Abbruchtests.
- Format, Lint, Typecheck, Coverage, Modulgrenzen und Guard bestanden im selben Gesamtlauf.
- `mise exec -- pnpm --filter @voltonaut/web build`: bestanden.
- `git diff --check`: bestanden.
- `apps/web/e2e/connect-ride.spec.ts`: Native GATT-Fakes liefern 244 W, 90 rpm und 132 bpm durch den echten E3-Worker. Der Test wartet auf dessen geglättete Leistung. Er prüft Abbruch, Fehler, manuelle Wiederholung, automatischen Reconnect, Tastatur und fehlende Schreibzugriffe.
- `packages/ble/src/ftms/selection.test.ts`: prüft die Optionen am tatsächlichen `requestDevice`-Aufruf. `ftms.replay.test.ts` prüft zusätzlich CPS-Fallback und ausbleibende Schreibzugriffe.
- `packages/ble/src/reconnect.test.ts`: prüft Wiederverbindung nach Abbruch und verhindert Wiederverbindung nach absichtlichem Trennen.
- `packages/ble/src/lifecycle.regression.test.ts`: CPS-Leerlauf und Wiederantritt, ausgeschöpfte Notification-Setups mit spätem Abbruch und manueller Erholung, verzögertes HRS-/FTMS-Teardown ohne GATT-Überlappung, unabhängige Transporte sowie abgebrochene Retry-/Feature-Lesevorgänge. Die fünf ursprünglichen Regressionen scheiterten vor der Korrektur; auch der zusätzliche FTMS-Abbruchfall wurde zuerst rot nachgewiesen.
- Der Browser-Test wählt zunächst ein ungeeignetes Gerät. Retry öffnet keinen weiteren Picker; „Gerät wählen“ ersetzt es. Der Fake erlaubt Picker-Aufrufe nur während des synchronen Klick-Dispatchs mit aktiver Browser-Benutzergeste. Automatischer Reconnect erhöht den Picker-Zähler nicht.

Keine Sniffer-UI, Controller-Protokolle, Trainer-Steuerung, Widerstands- oder Hardware-Abnahme. Reale Firmware, Funkstabilität, Parallelverbindungen und Chrome Page Freezing mit BLE bleiben manuell offen. Keine Roadmap-Checkbox wird abgeschlossen.
