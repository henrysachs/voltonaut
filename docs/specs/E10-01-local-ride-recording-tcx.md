# Spec E10-01 – Lokale Fahrtaufnahme und TCX

- **Roadmap-Bezug:** E10, Export und spätere Strava-Integration. Nur lokale Voraussetzung, keine abgeschlossene Roadmap-Checkbox.
- **Status:** Review
- **Module:** `shared`, `web/game`, `web/sync`, `web/ui`, Composition Root.

## Ziel

Nutzer ohne Hardware nehmen eine Sim-Fahrt auf, beenden und speichern sie lokal. Ein ausdrücklicher Klick lädt TCX herunter, auch nach erneutem Laden der Seite.

## Datenform und Entscheidung

1. Ein Recorder besitzt `idle | recording | completed`. `game` erfasst echte monotone Zeit und rohe Messwerte. `sync` speichert validierte abgeschlossene Fahrten in einer separaten IndexedDB. `ui` besitzt Bedienelemente und Download.
2. Alternativ könnte die Engine Aufnahme und Export steuern. Das würde Physik, Browserpersistenz und Gerätemesswerte vermischen und Worker-Verträge erweitern.

Gewählt ist Form 1. Die Engine bleibt alleiniger Besitzer der Physik. Distanz ist die Differenz öffentlicher Snapshots, keine zweite Integration. Route `test-loop` erhält die lokale Aufnahmerevision `1`, entsprechend dem aktuellen Routendatensatz.

## Abnahmekriterien

- [x] Aufnahme explizit starten, beenden, speichern und erneut starten. Doppelte Aktionen erzeugen keine zweite Fahrt.
- [x] Eine laufende, auch ungültige Aufnahme kann nach ausdrücklicher Bestätigung verworfen werden. Abbrechen erhält die Aufnahme. Abgeschlossene und gespeicherte Fahrten bleiben unverändert.
- [x] Versionierter Datensatz mit UUID, eingefrorenem UTC-Start, monotoner echter Zeit, Route, Profilbasis, Sim/BLE-Herkunft, Physik-Zeitfaktor und virtueller Distanz.
- [x] Etwa ein Sample pro echter Sekunde. Keine erfundenen Zwischenpunkte nach Hintergrundlücken. Fehlende/veraltete Messwerte bleiben fehlend, echte Nullwerte bleiben erhalten. Der letzte Punkt enthält auch angebrochene Sekunden.
- [x] Leere, rückwärts laufende, nichtendliche und über sechs Stunden lange Aufnahmen werden mit Meldung abgelehnt.
- [x] Maximal 20 abgeschlossene Fahrten. Keine automatische Löschung. Bei vollem Speicher bleibt die abgeschlossene Aufnahme für Download und erneuten Speicherversuch im Tab.
- [x] Gespeicherte Fahrten sind nach Reload herunterladbar. Speicherfehler blockieren nicht die Physik.
- [x] TCX v2 mit `Sport="Biking"`, UTC, virtueller Distanz, optionalem Puls, Kadenz und ActivityExtension-v2-Watt. Ohne GPS, erfundene Hersteller oder Höhenmessung.
- [x] Sim-Dateiname und Notes enthalten die Sim-Kennzeichnung. Derselbe Datensatz erzeugt identische Bytes.
- [x] Browserdownload, Reload und XSD-Prüfung sind belegt. Vollständiges Gate nach Freigabe des Port-5173-Slots ausgeführt.

## Zeit, Unterbrechungen und Grenzen

Aufnahme beenden stoppt nicht die laufende Fahrtphysik. Es gibt keine implizite Aufnahmepause. Ausrollen mit frisch gemeldeten null Watt wird aufgenommen. Fehlende Sensordaten und Lücken über 2,5 Sekunden werden deklariert. Sim-Schnelluhr beschleunigt nur die virtuelle Physik, nicht die Zeitstempel der Aufnahme. Ein Reload verwirft die ungespeicherte laufende Aufnahme. Browserdaten können vom Browser gelöscht werden. Lokale Daten sind weder servergeprüft noch belohnt.

Überlange Aufnahmen bleiben abgelehnt. Mit **Laufende Aufnahme verwerfen** und einer Bestätigung wechselt der Recorder unabhängig vom Fehlergrund in `idle`. Danach ist ein neuer Start ohne Reload möglich. Diese Aktion ist ausschließlich während einer laufenden Aufnahme verfügbar. Sie löscht keine abgeschlossenen Datensätze. Ein fehlgeschlagenes Speichern einer abgeschlossenen Aufnahme behält Download und Speicherversuch. Der neue Aufnahmebeginn bleibt bis zum Download gesperrt.

Ganzzahlfelder werden zum nächsten Integer gerundet. Grenzen werden vor Export validiert, nicht durch Überlauf gekürzt. Pflichtfeld `Calories` bleibt 0, da keine Kalorienmessung existiert; die Notes erklären dies.

## Testplan

- Unit: Zustandsübergänge, Distanzbasis, echte Zeit, Frische, Nullwerte, Grenzwerte, Speicher-DI, XML-Semantik und Escaping.
- E2E: Sim-Aufnahme, expliziter Download, identische Wiederholung, Reload, erneute Aufnahme, leere Aufnahme.
- Extern: `xmllint` mit offiziellen Garmin-XSDs. Keine neue Abhängigkeit.

## Nicht-Ziele

Strava-OAuth, Upload, FIT, Backendhistorie, Outbox, Belohnungen, Pause-UI, 3D-Änderungen und Hardwareverifikation.

## Offene Fragen

Keine blockierenden Fragen. Speicherlimit und separate Datenbank sind für diesen lokalen Umfang festgelegt.

## Ergebnisse

Geprüft am 20.11.2026 im lokalen Checkout:

- `CI=true mise run check` grün. 68 Vitest-Dateien mit 334 Tests und 12 Playwright-Tests, einschließlich vier neuer Browserfälle.
- `mise run build` und `git diff --check` grün.
- Browserfälle prüfen Sim-Schnelluhr gegen echte Aufnahmedauer, XML-Semantik, expliziten Download, identische Bytes, Reload, erneute Aufnahme, leere Aufnahme und die Speichergrenze ohne Löschung.
- Ein weiterer Browserfall nutzt den echten IndexedDB-Adapter und belegt idempotentes Speichern sowie Ablehnung einer abweichenden Nutzlast unter derselben Fahrt-ID.
- Der tatsächlich heruntergeladene Browserexport unter `apps/web/test-results/ride-recording-records-rea-2701d-eloads-the-same-saved-bytes/recorded-sim.tcx` besteht `xmllint --noout --schema <externer Wrapper> <Export>`.
- Der externe Wrapper importiert die unveränderten offiziellen [TCX-v2-XSD](https://www8.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd) und [ActivityExtension-v2-XSD](https://www8.garmin.com/xmlschemas/ActivityExtensionv2.xsd). Damit wird auch das Watt-Element geprüft, nicht nur die lax definierte TCX-Erweiterungsstelle.

Roadmap-FIT und Strava bleiben offen. Keine neue Abhängigkeit und keine Änderung an Leitplanken. Keine Hardwareprüfung. Unabhängiges Review erfolgt separat durch den übergeordneten Lauf.

## Korrektur nach unabhängigem Review

Das Review belegte eine fehlende Zustandsänderung. Nach mehr als sechs Stunden lehnten sowohl Sampling als auch Beenden ab. Ein neuer Start blieb gesperrt. Der Recorder besitzt jetzt einen ausdrücklichen `discard`-Befehl für laufende Aufnahmen. Die UI verlangt dafür eine Bestätigung.

- Rot vor Änderung: `mise exec -- pnpm exec vitest run apps/web/src/game/rideRecorder.test.ts`. Der neue Regressionstest belegt zunächst die Ablehnungen nach `MAX_LOCAL_RIDE_MS + 1` und scheitert anschließend mit `recorder.discard is not a function`.
- Grün nach Änderung: derselbe Befehl, acht Tests bestanden. Nach Verwerfen startet eine neue Aufnahme und enthält ausschließlich deren Zeit- und Distanzpunkte. Verwerfen einer abgeschlossenen Aufnahme verändert diese nicht.
- Browser rot vor Änderung: `confirmation recovers an overlong recording without reload or loss of saved rides` erreicht die Sechs-Stunden-Ablehnung und scheitert am fehlenden Verwerfen-Button.
- Browser grün nach Änderung: fünf Aufnahme-Browserfälle über eine externe Playwright-Konfiguration auf Port 5190. Der neue Fall überspringt die Zeit einmalig mit `page.clock.fastForward`, bricht die Bestätigung zuerst ab und bestätigt sie anschließend. Ohne Reload bleiben die gespeicherten TCX-Bytes unverändert; eine neue Aufnahme wird erfolgreich gespeichert.
- Alle 13 Browserfälle bestehen auf Port 5190. Zusätzlich bestehen `mise run fmt:check`, `lint`, `typecheck`, `depcruise`, `guard`, `test` mit 335 Tests, `build` und `git diff --check`. Der Kapazitätsfall prüft auch den gesperrten Verwerfen-Button für eine abgeschlossene, noch nicht gespeicherte Aufnahme sowie den erneuten Speicherversuch.
- Das vollständige Gate des korrigierten Standes ist beim Parent mit 335 Unit-/Integrationstests und 13 Browserfällen grün. Build und Diff-Prüfung sind ebenfalls grün. Das unabhängige Nachreview ist Approve und bestätigt die aktive Zustandsänderung sowie den Schutz abgeschlossener Aufnahmen. Die Ergebnisse im vorherigen Abschnitt beziehen sich auf den Stand vor dieser Korrektur.
