# Spec E10-10 – WebGPU und Ultra-Qualität evaluieren

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, Checkbox „WebGPU-Renderer evaluieren; Ultra-Qualitätsstufe", [Issue #79](https://github.com/henrysachs/voltonaut/issues/79)
- **Status:** Teilergebnis. Erste Hardwaremessung, Entscheidungsvorschlag und Messgrenzen sind dokumentiert. AK1 bleibt offen, bis eine Folgemessung das Backend pro Lauf protokolliert. ADR-030 hat Henry im Chat am 2026-11-27 angenommen.
- **Betroffene Module:** Dokumentation und ein isoliertes Scratch-Lab. Kein Produktionscode, keine neue Abhängigkeit, keine geschützte Konfiguration.

## Ziel

Ein messbarer Prototyp klärt, ob WebGPU einen zweiten dauerhaften Renderer oder eine eigene Ultra-Stufe rechtfertigt. Der Vergleich nutzt dieselbe Szene und Kamera und misst FPS, Speicher und sichtbare Qualität auf echter Hardware.

## Abnahmekriterien

- [ ] AK1 – WebGL und WebGPU rendern sequenziell dieselbe Szene, denselben Seed, dieselbe Kamerapose und dieselben Qualitätsparameter. Der tatsächlich verwendete Backend-Adapter wird protokolliert. Ein stiller WebGL-Fallback gilt als Fehler.
- [x] AK2 – High und Ultra werden je Backend auf echter Hardware gemessen. Pro Variante gibt es fünf alternierende Läufe nach identischer Aufwärmphase. FPS p5/p50/p95, Frame-Zeit, CPU-Renderzeit, Draw Calls, Dreiecke und Speicher werden roh festgehalten.
- [x] AK3 – Screenshots jeder Variante zeigen dieselbe Szene und Kamera. Die sichtbare Qualität wird mit den Messwerten zusammen bewertet. Schwarze Bilder, Treiber- oder Shaderfehler werden nicht als Erfolg gewertet.
- [x] AK4 – Die ADR entscheidet getrennt, ob ein zweiter Renderer und ob Ultra sinnvoll ist. Begründung, Alternativen, Messgrenzen und Kompatibilitätskosten sind dokumentiert.
- [x] AK5 – Ohne positive Entscheidung bleibt der Produktionspfad bei einem WebGL-Renderer. Das Scratch-Lab wird nicht in den App-Build übernommen.
- [x] AK6 – `mise run check` ist grün. Ein zweiter Agent reviewt Spec, ADR und Nachweise.

## Testplan (`docs/10-testing.md`)

| AK  | Ebene                                            | Datei / Fixture                                                                                                                |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| AK1 | Echte Hardware, Produktionsbuild des Scratch-Lab | `docs/specs/E10-10/render-lab/environment.json`, `docs/specs/E10-10/render-lab/compact-runs.json`, Backend-Nachweis unten      |
| AK2 | Manuelles Performance-Benchmark                  | `docs/specs/E10-10/render-lab/compact-runs.json`, fünf AB/BA-Läufe                                                             |
| AK3 | Visueller Vergleich                              | `docs/specs/E10-10/render-lab/visual-comparison.png`, `docs/specs/E10-10/render-lab/visual-metrics.json`, Bewertung in ADR-030 |
| AK4 | Dokumentarische Entscheidung                     | `docs/decisions/ADR-030-webgpu-renderer.md`                                                                                    |
| AK5 | Architekturreview                                | Diff enthält keinen Renderer- oder Qualitätscode in `apps/web/src/`                                                            |
| AK6 | Gesamtgate und unabhängiges Review               | `mise run check`, `docs/specs/_review-checklist.md`                                                                            |

## Messbedingungen

- MacBook Pro M5 Pro, 20 GPU-Kerne, 48 GB RAM, eingebautes Display.
- Chromium 159 über Playwright, sichtbares Fenster, 1280 × 720 CSS, `deviceScaleFactor = 1`.
- WebGL2 über ANGLE Metal. WebGPU über Apple `metal-3` mit `core-features-and-limits`. Kein Software-Renderer.
- Beide Backends verwenden 4x-MSAA, Alpha aus, SRGB und ACES. WebGPU erzeugt ein Unsigned-Byte-Ausgabebild wie WebGL.
- Feste Streckenposition 850 m, Seed 42, Startzeit 17:30 Uhr, Sturm, Chase-Kamera, See-Wald-Szene mit Werbetafeln. Dargestellt werden etwa 17:32:10 bis 17:32:26. Die Screenshots zeigen 17:32:10.
- High: DPR 1,5, 1920 × 1080 Pixel, 900 Regentropfen. Ultra: DPR 2,0, 2560 × 1440 Pixel, 1400 Regentropfen.
- Fünf Sekunden Aufwärmzeit, acht Sekunden Messzeit, fünf Wiederholungen pro Variante, alternierende Reihenfolge.
- Produktionsbuild des isolierten Lab. Jeder Lauf startet in einem frischen Chromium-Prozess. Renderer, Szene und WebGPU-Device werden vor dem Schließen entsorgt.

## Backend-Nachweis

Die erste Messung protokolliert die initialisierten Adapter nur global in `environment.json`. `compact-runs.json` enthält kein Backend-Feld pro Lauf. Die positiven Bytezähler bei WebGPU und die `null`-Werte bei WebGL unterscheiden den `WebGPURenderer` vom klassischen `WebGLRenderer`. Sie schließen den WebGL2-Fallback des `WebGPURenderer` nicht aus, weil dieser Fallback dieselbe `Info`-Implementierung verwendet. Die erfassten `consoleErrors` decken die Fallback-Warnung über `console.warn` nicht nachweisbar ab.

AK1 ist daher noch nicht erfüllt. Die Folgemessung muss `renderer.backend.isWebGPUBackend` und Warnungen pro Lauf erfassen. Ein WebGL2-Fallback ist dabei ein Fehler.

## Kompatibilitätsanpassung

Der produktive Himmel verwendet ein GLSL-`ShaderMaterial`, das Three r187 im WebGPU-Backend ablehnt. Das Scratch-Lab ersetzt nur dieses Material für beide Backends durch denselben scheitelgefärbten Himmel. Regen, Gelände, Straße, Fahrer, Licht, Schatten und Kamera stammen weiterhin aus den vorhandenen Systemen. Diese Anpassung ist kein Produktionsfix.

Gleiche Szenenparameter erzeugen keine pixelgleichen Bilder. WebGPU zeigt hellere Nebel- und Hügelbereiche sowie höhere Kantenstärke. Die Ursache ist unbekannt. ADR-030 bewertet diese Differenz als offene Kompatibilitätsfrage, nicht als Qualitätsgewinn.

## Nachweisstand

| Aussage                              | Stand                                        |
| ------------------------------------ | -------------------------------------------- |
| Prototyp implementiert               | ja, isoliertes Scratch-Lab                   |
| Am gebauten Artefakt softwaregeprüft | ja, 20 Läufe ohne Render- oder Consolefehler |
| An echter Hardware gemessen          | ja, MacBook Pro M5 Pro                       |
| Bereitgestellt                       | nein, kein Produktionsrenderer               |

## Nicht-Ziele

Kein WebGPU-Umbau der App, kein dauerhafter Renderer-Schalter, keine neue Qualitätsstufe, keine Änderung an Engine, BLE, HUD oder Garage. Das Lab ist kein Ersatz für die spätere Performance-Budget-Szene mit Bots, Zuschauern und Post-Processing.

## Offene Fragen / Risiken

- Die Ergebnisse gelten nur für die prozedurale See-Wald-Szene auf Code-Basis `82238d3`. PR #105 hat Fahrer und Rad nach der Messung verändert. Die neue Avatar-Version wurde nicht erneut gemessen.
- Alle Varianten erreichen das 120-Hz-Anzeigelimit. FPS-Vorteile ohne dieses Limit oder mit GPU-Zeitmessung bleiben unbestimmt.
- Die Screenshots werden auf 1280 × 720 CSS-Pixel heruntergerechnet. Sie bewerten Ultra nur als Supersampling, nicht die native Darstellung auf einem Display mit DPR 2.
- `renderer.info.memory` ist zwischen WebGL und WebGPU nicht direkt vergleichbar. WebGL liefert keine Bytegrenzen. Chromium-Prozess-RSS und JS-Heap ergänzen die Messung, sind aber keine dedizierte VRAM-Messung. Die Render-CPU-Zeit misst den synchronen Submission-Aufruf, nicht die GPU-Ausführung. Die RSS-Stichprobe wird am höchsten Gesamt-RSS des Browsers erfasst und ist keine GPU-Spitzenlast.
- Andere lokale Prozesse und thermische Schwankungen können die Messung beeinflussen. Die alternierende Reihenfolge begrenzt systematische Verzerrungen.
- Der produktive Render-Loop enthält bewusst eine Wartezeit nach dem Render. Das Lab misst den Renderpfad ohne diese Wartezeit und ohne den produktiven Render-Worker.
- Die Lab-Quellen und ihr Worktree-Commit sind nicht Teil des Repository. Die gespeicherten SHA-256-Hashes sind daher extern nicht nachprüfbar.

## Doku-Updates

- [x] Roadmap-Checkbox · [x] `docs/04-world-3d.md` · [x] ADR-030 · [x] ADR-Index
