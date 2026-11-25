# Render-Lab-Nachweise

Dieses Verzeichnis enthält die auswertbaren Ergebnisse des isolierten WebGPU-Prototyps aus [E10-10](../../E10-10-webgpu-evaluation.md). Der Prototyp selbst ist kein App-Code und wird nicht gebaut oder ausgeliefert. `environment.json` enthält die exakte Variantenreihenfolge und SHA-256-Hashes der Lab-Quellen. Die Messung lief im Worktree-Commit `065b633` auf Code-Basis `82238d3` und enthält die aktuelle See-Wald-Szene mit Werbetafeln. Das ausführbare Scratch-Lab bleibt lokal im OpenCode-Temp-Verzeichnis. Aus dem Repository allein ist der Prototyp nicht reproduzierbar.

## Dateien

- `environment.json` enthält Hardware, Browser, Adapter und Last beim Start.
- `baseline.json` enthält die Framerate einer leeren Seite als Nachweis der 120-Hz-Anzeigegrenze.
- `compact-runs.json` enthält einen Datensatz pro Lauf ohne Prozess-IDs und temporäre Pfade.
- `summary.json` enthält Median, Spannweite und relative Vergleiche je Variante.
- `visual-comparison.png` zeigt alle vier Varianten bei derselben Kamera und demselben Frame.
- `visual-metrics.json` enthält die Kantenstärke und die mittlere Helligkeitsdifferenz der Screenshots als ergänzende, nicht allein entscheidende Qualitätswerte.
- `webgl-high.png`, `webgpu-high.png`, `webgl-ultra.png` und `webgpu-ultra.png` zeigen je einen repräsentativen Lauf in voller CSS-Auflösung.

## Messrahmen

Der Produktionsbuild des Scratch-Lab lief in sichtbarem Chromium 159 auf dem MacBook Pro M5 Pro. Jede Variante erhielt fünf Sekunden Aufwärmzeit und acht Sekunden Messzeit. Die Reihenfolge wechselte zwischen WebGL und WebGPU. Jeder Lauf startete in einem frischen Chromium-Prozess. Renderer, Szene und WebGPU-Device wurden vor dem Schließen entsorgt.

Die Szene blieb bei Streckenposition 850 m, Seed 42, Startzeit 17:30 Uhr, Sturm und Chase-Kamera. Dargestellt werden etwa 17:32:10 bis 17:32:26. Die Screenshots zeigen 17:32:10. Gelände, Straße, Werbetafeln, Fahrer, Licht und Regen stammen aus den aktuellen Systemen. High rendert mit DPR 1,5 und 900 Regentropfen, Ultra mit DPR 2,0 und 1400 Regentropfen. Beide Backends verwendeten 4x-MSAA, SRGB, ACES und Unsigned-Byte-Ausgabe.

Der produktive GLSL-Himmel war im WebGPU-Backend nicht kompatibel. Das Lab ersetzte nur diesen Himmel für beide Backends durch dieselbe scheitelgefärbte Geometrie. Alle übrigen Systeme blieben unverändert.

## Grenzen

Die FPS stammen aus `requestAnimationFrame` im sichtbaren Browser. Sie belegen die Framerate des Lab, nicht die spätere OffscreenCanvas-Darstellung der App. FPS p5 entspricht der p95-Frame-Zeit, FPS p95 der p05-Frame-Zeit. Einzelne kurze Frame-Intervalle können dadurch FPS über 120 ergeben.

Die `renderCpu*`-Zeit misst Frame-Vorbereitung und Render-Submission mit 0,1-ms-Quantilierung, nicht die GPU-Ausführungsdauer. `renderer.info.memory` liefert für WebGL keine Bytegrenzen. Die GPU-Prozess-RSS-Stichprobe wird am Punkt des höchsten Gesamt-RSS des Browsers erfasst. Sie ist weder eine GPU-Spitzenlast noch dedizierter VRAM. Die Systemlast war während der Messung erhöht, weil ein anderer Worktree gleichzeitig prüfte.
