# Spec E4-02 – Erste fahrbare 3D-Szene

- **Roadmap-Bezug:** E4, schmaler Teilschritt für Scheduler, Straße, Fahrer und Kamera. Keine vollständige E4-Checkbox wird abgeschlossen.
- **Status:** Review
- **Betroffene Module:** `apps/web/src/{world,avatar}`, Composition Root, HTML/CSS, E2E und Web-Abhängigkeiten.

## Ziel

Eine anonyme Sim- oder BLE-Fahrt zeigt erstmals ein fahrendes Rad mit Fahrer in einer 3D-Szene. Die vorhandene Worker-Engine bleibt alleiniger Besitzer der Physik.

## Abnahmekriterien

- [x] AK1 – Lokaler `RenderSystem`-Scheduler führt environment, road, riders, camera und debug geordnet aus. Lifecycle, Qualität und Freigabe sind unit-getestet.
- [x] AK2 – Straße aus öffentlichem `EngineRoute.worldPos`, Boden, Himmel/Nebel, PBR-Materialien und Sonnenlicht sind sichtbar. Keine externen Assets.
- [x] AK3 – Prozedurales Rad mit Fahrer folgt ausschließlich Snapshot-Position und Heading. Räder folgen Gesamtdistanz, Kurbel der Kadenz. Bewegungsmathematik ist unit-getestet.
- [x] AK4 – Geglättete Verfolgerkamera und Seitenübersicht wechseln mit C oder Schaltfläche. Resize und Dispose räumen eigene Ressourcen auf.
- [x] AK5 – HUD, Profil, BLE-Dialog, Gangtasten, schnelle Sim-Uhr und Hintergrundfahrt bleiben erhalten. Ohne WebGL bleibt die Fahrt mit Hinweis bedienbar.
- [x] AK6 – Browser prüft echte Draw Calls, Dreiecke, Bewegung, Kamerainteraktion, Resize und Fallback. Temporäre Screenshots dienen nur der Sichtprüfung.
- [x] AK7 – `mise run install`, `CI=true mise run check`, `mise run build` und `git diff --check` sind grün.

## Testplan

Unit-Tests prüfen Scheduler, Snapshot-Interpolation, Straßen-Sampling und Bewegungsmathematik. Playwright prüft die Szene im bestehenden Sim-Modus und behält die vorhandenen Fahrt-, Profil-, BLE- und Sniffer-E2Es. Diagnosewerte stammen aus `renderer.info` und tatsächlichen Objektpositionen. Keine schreibbaren Window-Test-Hooks.

## Nicht-Ziele

Keine 12-km-Route, Terrain-Chunks, HDRI, CSM, Texturen, Asset-Pipeline, KTX2, AutoQuality, rigged Animation, IK, Garage, Mini-Map oder FPS-Abnahme. Keine Änderungen an Engine, Rules, Shared-Verträgen, Server oder Leitplanken. Keine Screenshot-Baselines.

## Risiken und Grenzen

Die vorhandene E3-Testroute ist 10 km lang und besteht aus geraden Teilstücken. Die Darstellung glättet Snapshots, ersetzt aber nicht die Route. Ein breites, höhengleich gesampeltes Grasband und eine Grundfläche ersetzen noch kein Terrain. Die Beine verwenden eine einfache, längenveränderliche Pose, kein Rig oder IK. Der Renderer startet fest auf Medium. Die Qualitätstabelle ist kein AutoQuality-Regler.

Software-WebGL belegt Funktion, keine Laptop-Performance. Echte BLE-Hardware und GPU-Qualität bleiben manuell zu prüfen. Der Build meldet einen JavaScript-Chunk über 500 kB. Code-Splitting bleibt Folgearbeit.

## Ergebnisse

| Prüfung                  | Ergebnis                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `mise run install`       | Grün, eingefrorenes Lockfile                                                                       |
| `CI=true mise run check` | Grün, mit aktuellem `main` samt Sniffer: 323 Unit-/Integrationstests und elf E2E-Tests             |
| `mise run build`         | Grün, einschließlich Web- und Server-Build                                                         |
| `git diff --check`       | Grün                                                                                               |
| Browser-Sichtprüfung     | Straße, Fahrer, Rad, Schatten, Verfolger und Übersicht sichtbar                                    |
| Browser-Fehler           | Keine Page- oder Console-Errors im separaten Sichtlauf                                             |
| WebGL-Ausfall            | Start mit `--disable-webgl` und echter Kontextverlust geprüft. HUD und Schalten bleiben bedienbar. |

Die acht vorhandenen E2E-Tests bleiben unverändert. Drei neue Tests prüfen Szene, Resize, Kamera und beide WebGL-Ausfälle. Ein zusätzlicher Kamera-Unit-Test verhindert den im Sichtlauf gefundenen Abstandszuwachs mit schneller Sim-Uhr.

Der Live-Sichtlauf nutzt `/?sim=1&clock=fast&debug=1` und den echten Worker. Die Renderdiagnose zeigt dabei 74 Draw Calls und 40 302 Dreiecke. Snapshot-Distanz, Objektposition und Kurbelwinkel wachsen. Diese Werte sind ein Funktionsnachweis, kein Performance-Budget oder FPS-Ergebnis.

Die temporären Bilder `first-ride-chase.png` und `first-ride-overview.png` entstehen aus einem unveränderten öffentlichen Engine-Startsnapshot mit angehaltener Playwright-Uhr. Die Szene verwendet denselben Renderer wie die App. Beide Bilder sind bei zwei Durchläufen bytegleich. `first-ride-moving.png` zeigt separat die laufende Worker-Fahrt. Bilder und Prüfsystem liegen außerhalb des Repos. Es gibt keine neuen Screenshot-Baselines oder Produktions-Test-Hooks.

An echter Hardware getestet: nein. Das unabhängige Zweitreview ist Approve. Die vollständige E4-Abnahme bleibt offen.
