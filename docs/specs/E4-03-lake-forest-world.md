# Spec E4-03 – See und Wald auf der fahrbaren Testrunde

- **Roadmap-Bezug:** Schmaler E4-Teilschritt für Terrain und instanzierte Umgebung. Keine vollständige E4-Checkbox wird abgeschlossen.
- **Status:** Lokales Gesamtgate und unabhängiges Review grün. Integration und externe CI stehen aus.
- **Betroffene Module:** `apps/web/src/world`, Web-Tests und E4-Dokumentation.

## Ziel

Die echte 10-km-Testrunde erhält Gelände, einen See mit Ufer und einen Wald. See und Wald sind bereits während der ersten normalen Sim-Minute sichtbar. Die Worker-Engine bleibt alleiniger Besitzer der Fahrt.

## Architektur

Variante A ergänzt ein begrenztes Terrainband und statische, instanzierte Dekoration in einem `RenderSystem`. Ein unveränderlicher Geländeplan enthält Route, See und deterministische Platzierungen. Das System besitzt und entsorgt sämtliche Three-Ressourcen.

Variante B teilt Terrain, Wasser und Vegetation in eigene Systeme mit gemeinsamem Höhenmodell und einer zusätzlichen Initialisierungsreihenfolge.

Gewählt wird A. Die Objekte sind statisch, haben denselben Lebenszyklus und brauchen keinen Austausch pro Frame. Ein Höhenmodell berechnet Straßenanschluss, Seebecken und Pflanzenstandort. Es gibt weder Streaming noch einen neuen Weltzustand.

## Abnahmekriterien

- [x] AK1 – Begrenztes Gelände folgt `EngineRoute.worldPos` und dem unveränderten Höhenprofil. Der Straßenrand bleibt frei und höhengleich angeschlossen.
- [x] AK2 – Ein flacher See mit sichtbarem Ufer und gesetzte Baumgruppen sind am Start und während normaler Fahrt sichtbar. Wasser und Pflanzen liegen außerhalb des Asphalts.
- [x] AK3 – Instanzierte Pflanzen, Straßenmarkierung und Wegmarken geben Orientierung. Alle Geometrien entstehen im Code, ohne externe Assets oder neue Abhängigkeiten.
- [x] AK4 – Seed, Platzierungen, Straßenabstand, Geländeanschluss und Freigabe echter Three-Ressourcen sind unit-getestet.
- [x] AK5 – Browser prüft echte WebGL-Ausgabe, Worker-Bewegung, Kameras und Render-Budgets. Temporäre Vergleichsbilder zeigen Start und Seeabschnitt in beiden Kameras sowie eine laufende normale Fahrt.
- [x] AK6 – Render-Yield, Kontextverlust, BLE-Fallback, HUD, Profil und Tasten bleiben erhalten. `mise run check` und Build sind durch den Parent serialisiert ausgeführt und grün.

## Testplan

Vitest prüft deterministische Gelände- und Pflanzendaten, Geometriepositionen sowie Dispose-Ereignisse. Playwright prüft die tatsächliche Szene und `renderer.info`. Vergleichsbilder sind temporär und keine Baselines. Headless-Werte belegen keine Hardware-Bildrate.

## Nicht-Ziele

Keine neue Route oder Physik, kein Avatarersatz, keine Assets, Texturen, Spiegelungen, Shader-Frameworks, Terrain-Chunks, LOD, Wetter, Minikarte oder vollständige E4-Abnahme. Kein Strava-Upload. Keine Änderungen an Engine, Rules, Shared, Server oder Leitplanken.

## Ergebnisse

Das System ersetzt das breite Grasband durch ein 720 m breites, an der echten Route gesampeltes Terrainband. Eine begrenzte Grundfläche verdeckt den fernen Hintergrund. Die Straße bleibt 7 m breit. Das Gelände schließt 6 cm unter der Routenmitte an beide Schultern an und folgt den unveränderten 100–196 m Routenhöhen.

Der See liegt außen neben dem Startabschnitt und 1,4 m unter der Straße. Ein gemeinsames Höhenmodell formt Seegrund und Ufer. Die Außenlage hält den See auch in der unveränderten Seitenübersicht sichtbar. Seed 42 bestimmt die Baum- und Felspositionen. Die dichte Waldzone beginnt am Start und reicht bis 650 m. Instanzen sind räumlich in 250-m-Gruppen begrenzt. Geometrien und Materialien bleiben geteilt.

Sieben neue Unit-Tests prüfen gleiche und verschiedene Seeds, freie Asphalt- und Wasserflächen, den gesamten Straßenanschluss, echte Dreiecksflächen an Anstiegen und Rundenschluss, Seehöhe sowie Ressourcenfreigabe. Ein Raycast prüft den Stand jedes Baums auf dem tatsächlich erzeugten Terrain. Die Platzierung berücksichtigt Nachbardreiecke an den Knicken der öffentlichen Centerline.

Die Browserprüfung verwendet Port 5191 mit einer temporären Konfiguration außerhalb des Repos. Timeouts, Viewport und Tests entsprechen der vorhandenen Konfiguration. `reuseExistingServer` bleibt `false`. Port 5173 wurde nicht verwendet.

Temporäre Bilder liegen unter `/private/var/folders/23/tg_nxvb56ybfx4bqy70w6rjm0000gn/T/opencode/lake-forest-evidence/`. `before-{0,180}-{chase,overview}.png` und `after-{0,180}-{chase,overview}.png` zeigen denselben öffentlichen Startsnapshot beziehungsweise dieselbe Routenposition bei 180 m. `normal-{10,180}-{chase,overview}.png` zeigen separat eine laufende Worker-Fahrt ohne schnelle Uhr. Keine Baselines wurden ergänzt oder verändert.

Das Vorher-Bild enthält 74 Draw Calls und 40 302 Dreiecke. Diese Bestandswerte sind kein Performance-Versprechen. Die neuen Zählwerte stammen weiterhin aus `renderer.info`; Qualitätsstufe, Auflösung, Kameras und Render-Yield bleiben unverändert. Headless-Chromium belegt Funktion und begrenzte Grafikarbeit, keine Laptop-Bildrate.

| Szene                                                                  | Draw Calls |        Dreiecke |
| ---------------------------------------------------------------------- | ---------: | --------------: |
| Start, eingefroren, Verfolger                                          |        126 |         165 070 |
| Start, eingefroren, Übersicht                                          |        101 |         150 038 |
| 180 m, eingefroren, Verfolger                                          |        119 |         161 138 |
| 180 m, eingefroren, Übersicht                                          |         94 |         147 058 |
| Zusätzliche Proben bei 600, 3000, 5000, 5600 und 8000 m, beide Kameras |     95–125 | 133 770–158 318 |
| Normale Worker-Fahrt bei 13,9–193,7 m, beide Kameras                   |     99–135 | 149 482–170 478 |

Die normale Fahrt erreicht 185,5 m nach 31,6 s und 193,7 m nach 32,5 s seit dem Seitenaufruf. See und Wald sind auf den zugehörigen Bildern sichtbar. Der Browser meldet weder Page- noch Console-Errors. `normal-diagnostics.json` enthält die tatsächlich gelesenen Positionen, Kamerapositionen, Kurbelwinkel, Zählwerte und verstrichene Zeit. Die vier eingefrorenen Nachher-Bilder sind bei zwei Durchläufen bytegleich. Die Kameras und der Renderer verwenden in allen Proben die unveränderten App-Einstellungen.

Der erste schnelle Sim-Lauf überschritt mit einzeln gezeichneten Wegmarken 150 Draw Calls. Instanzierte Wegmarken beheben den Befund, ohne Grafikqualität oder App-Funktionen zu senken. Ein Gelände-Test fand außerdem einen zu niedrigen äußeren Uferrand. Das gemeinsame Beckenmodell stützt jetzt den gesamten Wasserrand. Der Standtest fand schwebende Baumfüße. Die Platzierung interpoliert jetzt die tatsächlichen Terrain-Dreiecke statt nur die analytische Höhe.

Das vollständige `CI=true mise run check` ist beim Parent auf Basis von `main` bei `9138af5` mit 330 Tests und zwölf E2Es grün. Build und Diff-Prüfung sind ebenfalls grün. Das unabhängige Review ist Approve und prüft zusätzlich 15 000 Straßenpositionen mit echten Terrain-Raycasts. Änderungen betreffen weder Engine noch Rules. Mutation ist deshalb nicht erforderlich. An echter Hardware getestet: nein.

| Prüfung                                                                          | Ergebnis                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `mise run install`                                                               | Grün, eingefrorenes Lockfile                              |
| `mise run fmt:check`, `lint`, `typecheck`, `depcruise`, `guard`                  | Grün                                                      |
| `mise run test`                                                                  | Grün, 330 Tests in 69 Dateien einschließlich Coverage     |
| `mise run build`                                                                 | Grün. Bekannte Chunk-Warnung über 500 kB bleibt bestehen. |
| Szenen-E2E auf Port 5191                                                         | Drei Tests mit drei Wiederholungen, 9/9 grün              |
| Sim, Profil, BLE-Abbruch mit erneutem Verbinden und WebGL-Fallback auf Port 5191 | 5/5 grün                                                  |
| `git diff --check`                                                               | Grün                                                      |
| Gesamtgate und unabhängiges Review                                               | Grün, 330 Tests, zwölf E2Es und Approve                   |

## CI-Nachprüfung des normalen Fahrtstarts

CI-Lauf `44735610176` scheiterte im neuen normalen Szenentest. Die Distanzprüfung startete bei 0 m und las zuletzt 6,984 m statt mehr als 8 m. Geräteverbindung und gezeichnetes Gelände belegen noch keine laufende Tretbewegung.

Eine lokale Linux-Reproduktion nutzt dasselbe Playwright-Image, zwei CPU-Kerne und zusätzliche Chromium-CPU-Drosselung um Faktor 4. Der unveränderte Test scheitert am selben Assert mit zuletzt 7,845 m. Beobachtete echte Worker-Snapshots zeigen zunächst 0 W und 0 U/min, anschließend Beschleunigung und weiter steigende Distanz. Die Engine meldet keinen übersprungenen Takt. Nach dem fehlgeschlagenen Poll erreicht der Worker 18,901 m, die gerenderte Position 13,757 m mit wachsendem Kurbelwinkel. Das belegt einen zu frühen Messbeginn im Test, keinen dauerhaften Stillstand. Die genaue Last des GitHub-Runners ist lokal nicht reproduziert.

Der Test wartet jetzt vor dem Distanz-Basiswert auf einen positiven gerenderten Kurbelwinkel. Dieser entsteht aus der Kadenz und Fahrzeit echter Worker-Snapshots. Die bestehenden Prüfungen auf weitere 8 m Distanz, weitere 5 m Fahrerposition, steigenden Kurbelwinkel, Kameras und Render-Budgets bleiben unverändert. Timeouts, Wiederholungen, Uhr, Grafik und Produktionscode bleiben unverändert.

Die gedrosselte Serie vor der Korrektur scheitert einmal in acht Läufen. Dieselbe Serie besteht danach achtmal. Auch alle zwölf E2Es mit zwei Linux-Workern sowie Lint und Typecheck sind nach der Korrektur grün. Logs und Fehlerspur liegen temporär unter `/private/var/folders/23/tg_nxvb56ybfx4bqy70w6rjm0000gn/T/opencode/lake-cpu4-instrumented-{red,green}*`. Diese Diagnose ist kein Bildratenvergleich und kein Hardwaretest.
