# Spec E4-04 – Render-Worker gegen Main-Thread-Starvation

- **Roadmap-Bezug:** E4, RenderSystem-Scheduler, Debug-Overlay, animierter Fahrer und Kameras. Korrektur für Issue #20, keine vollständige E4-Abnahme.
- **Status:** Implementiert und unabhängig geprüft. Erneutes Gesamtgate mit 635 Unit-Tests und 31 E2Es sowie Build beim übernehmenden Agenten grün. Externe CI und Merge bleiben Integrationsschritte.
- **Betroffene Module:** `apps/web/src/world`, mechanische Scene-Option in `ridePresentation.ts`, begrenzte Render-E2E.

## Ziel

Natives Render-Warten soll nicht mehr dem Main Thread gehören, der BLE, HUD und Eingaben verarbeitet. Die vorhandene Three-Welt läuft direkt auf einem übertragenen OffscreenCanvas im Render-Worker. Bei fehlender Unterstützung bleibt die Fahrt ohne 3D bedienbar.

## Abnahmekriterien

- [x] AK1 – Main überträgt den Canvas genau einmal vor jedem Kontextzugriff. Nur der Render-Worker besitzt GL und den Render-Loop.
- [x] AK2 – Alle bestehenden Routennamen werden über die tatsächliche Registry aufgelöst. Unbekannte IDs liefern keine Ersatzroute.
- [x] AK3 – Unveränderte Welt, Medium, DPR-Grenze, Schatten, Materialien und Kameras. Echte Draw Calls, Dreiecke, Fahrer-, Kurbel- und Kamerabewegung sind nachgewiesen. Screenshots zeigen die Welt, keine schwarze Ersatzfläche.
- [x] AK4 – Höchstens ein unbestätigter und ein ersetzbarer letzter Darstellungssnapshot. Späte ACKs erzeugen keine weitere Warteschlange. Engine, BLE, Aufnahme, Uhren, Frische und EMA bleiben unverändert.
- [x] AK5 – Zugänglicher Ladestatus bis zu einem echten Render und folgender Worker-Task. Kein Ready aus einem leeren Frame. Diagnostik unterscheidet Renderabschluss von sichtbarer Browserpräsentation.
- [x] AK6 – Initfehler, Kontextverlust und Workerfehler zeigen `3D unavailable`. HUD, Fahrt und Tastatur bleiben bedienbar.
- [x] AK7 – Dispose vor Ready, Pagehide, späte Nachrichten und mehrfache Entsorgung geben Ressourcen höchstens einmal frei. Observer und Listener enden sofort. Main terminiert den Worker nach Bestätigung oder fordert die Terminierung nach einer Sekunde an.
- [x] AK8 – Ursprüngliche Background-, Connect-, Play- und Scene-Verträge bestehen. Ein Kontextverlust-Test muss den echten GL-Besitzer treffen.
- [x] AK9 – `E2E_PORT=5231 CI=true mise run check` und `mise run build` sind grün. Keine gelockerten Regeln, neuen Abhängigkeiten oder Baselines.

## Testplan

| Kriterien          | Ebene                                   | Dateien                                                                  |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------ |
| AK2, AK4, AK7      | Unit                                    | `world/render-link.test.ts`, `world/render-loop.test.ts`                 |
| AK3                | bestehende Unit und E2E                 | `world/systems.test.ts`, `world/frame.test.ts`, `e2e/ride-scene.spec.ts` |
| AK1, AK5, AK6, AK7 | Browser mit tatsächlichem Render-Worker | `e2e/render-worker.spec.ts`, `e2e/webgl-unavailable.spec.ts`             |
| AK8                | unveränderte Fahrtverträge              | Background-, Connect-, Play- und Scene-E2E                               |
| AK9                | Gesamtgate und Build                    | mise                                                                     |

Unit-Tests ersetzen nur Browser-Timer, Worker-Port und GL-Aufrufe, die Node nicht ausführen kann. Browser-Fehlerprüfungen injizieren Fehler in den tatsächlichen OffscreenCanvas-Kontext. Es gibt keine Modul-Mocks.

## Verifikation am 2026-11-21

Das Gesamtgate besteht mit 635 Unit-Tests und 31 E2E. Der vorhandene Kontextverlust-Test löst den Fehler über einen Test-Wrapper des tatsächlichen Render-Workers aus. Alle bisherigen Assertions bleiben erhalten. Zusätzlich prüft der Test weiterlaufende HUD-Distanz, Verbindungsstatus und genau eine Worker-Terminierung. Die beiden übrigen Scene-Tests sowie Background-, Connect- und Play-Tests bleiben unverändert.

Das unabhängige Ownership-Review besteht 24 Tests einschließlich eigener Bridge-/Port-Lifecycle-Proben. Das unabhängige Spec-/Runtime-Review besteht 28 World-Tests, 16 bestehende Browserfälle und zwei eigene Laufzeitproben. Sichtbare Chase-/Overview-/Resize-Bilder wurden geöffnet. Die native Auswertung wurde unabhängig nachgerechnet; alle 17 Quellhashes blieben unverändert. Reviewbelege liegen unter `$TMPDIR/opencode/render-ownership-review-g4vo9kkm/` und `$TMPDIR/opencode/render-spec-review-fMFoiia5/`. Das erneute Gesamtgate und der Build des übernehmenden Agenten bestehen ebenfalls.

Ein frisches natives Diagnosepaar verwendet den archivierten Stand `bdf5dd3` und den tatsächlichen Produktionscode ohne Scene-Overlay. Genau zwei ursprüngliche Fälle je Stand laufen unter Linux/arm64 mit einem CPU-Kern und zwei Test-Workern. Beide Baseline-Fälle sind rot, beide neuen Fälle grün. Die native Timeline zeigt das lange Readback auf Main nur in der Baseline. Im neuen Stand wartet der Render-Worker, während Main echte Engine-, Trainer- und HUD-Callbacks verarbeitet. Screenshots aus denselben Seiten zeigen die sichtbare, bewegte Welt. Das Einzelpaar belegt die Besitzgrenze, keine allgemeine Laufzeitverbesserung oder CI-Flake-Rate.

## Nicht-Ziele und Grenzen

Keine Änderung an Physik, BLE, Aufnahmen, serverseitigen APIs oder Leistungsglättung. Kein CPU-Readback-Pfad, Bitmaprenderer, Legacy-Zweitrenderer oder Qualitätsabbau. Keine allgemeine Performancebehauptung aus Software-GL.

Der frühere TEMP-Gegenversuch ist nur die Motivation. Der neue Nachweis verwendet die tatsächlichen Quellen. Wiederholbare Hardware-FPS und ein eigenständiges durchgehendes 5-s-Reconnect-/EMA-Fenster bleiben unbelegt. Der ursprüngliche Reconnect-Test besteht. An echter Hardware getestet: nein.

## Doku-Updates

- [x] Begrenzte Ergänzung in `04-world-3d.md`.
- [x] ADR-019 zur Besitzgrenze.
- [x] ADR-Index und unabhängiges Review durch den übernehmenden Agenten.
