# ADR-029 – WebGPU ohne zweites Render-Backend, Ultra zurückgestellt

- **Status:** Vorgeschlagen für [Issue #79](https://github.com/henrysachs/voltonaut/issues/79). Henrys Freigabe ausstehend.
- **Bezug:** ADR-002, ADR-008, ADR-014, ADR-019, Spec [E10-10](../specs/E10-10-webgpu-evaluation.md).

## Kontext

Der Fahr-Renderpfad verwendet `WebGLRenderer` aus three r187 im Render-Worker. Issue #79 verlangt einen messbaren Vergleich mit WebGPU auf echter Hardware. Ein zweiter Renderer soll nur entstehen, wenn er einen nachweisbaren Nutzen bringt.

Der Prototyp verglich WebGL2 und WebGPU mit High und Ultra auf einem MacBook Pro M5 Pro. Beide Backends renderten dieselbe See-Wald-Szene mit Werbetafeln bei Streckenposition 850 m, Seed 42, Startzeit 17:30 Uhr, Sturm und Chase-Kamera. Dargestellt werden etwa 17:32:10 bis 17:32:26. Die Screenshots zeigen 17:32:10. High verwendete DPR 1,5 und 900 Regentropfen, Ultra DPR 2,0 und 1400 Regentropfen. Beide Seiten nutzten 4x-MSAA, SRGB, ACES und Unsigned-Byte-Ausgabe. Messung, Rohdaten und Screenshots stehen in [E10-10](../specs/E10-10-webgpu-evaluation.md).

Der produktive Himmel verwendet GLSL-`ShaderMaterial`. Three r187 lehnt dieses Material im WebGPU-Backend ab. Für den Vergleich ersetzte das Lab nur den Himmel für beide Backends durch dieselbe scheitelgefärbte Geometrie. Regen, Gelände, Straße, Fahrer, Licht, Schatten und Kamera blieben unverändert.

## Messergebnis

| Variante | FPS p50 | FPS p5 | CPU Frame + Submission p50 | GPU-Prozess-RSS | WebGPU-Speicherzähler |
| --- | ---: | ---: | ---: | ---: | ---: |
| WebGL High | 120,48 | 108,70 | 0,40 ms | 118,45 MiB | nicht verfügbar |
| WebGPU High | 120,48 | 108,70 | 0,60 ms | 116,61 MiB | 28,12 MiB |
| WebGL Ultra | 120,48 | 108,70 | 0,40 ms | 121,06 MiB | nicht verfügbar |
| WebGPU Ultra | 120,48 | 108,70 | 0,60 ms | 116,34 MiB | 40,43 MiB |

Alle Variantenwerte sind Mediane aus fünf Läufen. Die p5-Spanne überlappt sich. Ein Baseline-Lauf ohne Rendering erreicht p50 120,48 fps und p5 109,89 fps. Die 120-Hz-Anzeige begrenzt die Framerate. WebGPU verändert p50 und p5 um 0 %, sowohl bei High als auch bei Ultra.

Im Lab lag die CPU-Zeit für Frame-Vorbereitung und Render-Submission bei WebGPU High und Ultra median 50 % über WebGL. Die Zeitmessung ist auf 0,1 ms quantisiert und enthält keine GPU-Ausführungsdauer. Der mediane GPU-Prozess-RSS ist bei High 1,6 % niedriger und bei Ultra 3,9 % niedriger. Die Spannweiten überlappen. Die RSS-Stichprobe wird am Punkt des höchsten Gesamt-RSS des Browsers erfasst und ist keine GPU-Spitzenlast. Damit ist der RSS-Unterschied kein stabiler Nachweis eines Speicherbedarfs. Der WebGPU-Speicherzähler steigt von High auf Ultra um 43,8 %. WebGL liefert keine vergleichbaren Bytegrenzen. Die RSS-Werte sind Prozessspeicher und kein dedizierter VRAM-Wert.

Die Screenshots zeigen keine neue visuelle Funktion. Ultra erhöht die Kantenstärke gegenüber High um 3,2 % bei WebGL und 1,4 % bei WebGPU. Die mittlere Helligkeitsdifferenz beträgt 0,160 bei WebGL und 0,230 bei WebGPU auf einer 0-bis-255-Skala. Der sichtbare Gewinn ist gering.

## Entscheidung

Der Fahr-Renderpfad bleibt bei WebGL. Es gibt keinen WebGPU-Renderer, keinen Renderer-Schalter und keine parallele dauerhafte Backend-Implementierung.

Eine eigene Ultra-Stufe wird nicht aktiviert. Medium bleibt der aktuelle Produktionswert. High und Ultra bleiben Experimentierwerte und werden nicht als neue Produktstufen angeboten.

Die Entscheidung wird erneut geprüft, wenn eine der folgenden Grenzen erreicht ist:

- Die Performance-Budget-Szene mit Bots, Zuschauern und Post-Processing erreicht auf WebGL das 60-fps-Ziel nicht.
- Ein WebGPU-Port den Himmel und die übrigen Materialien ohne visuellen Verlust unterstützt.
- Eine neue Messung auf der dann aktuellen Szene einen reproduzierbaren FPS-Gewinn über die Anzeigegrenze hinaus zeigt.

## Folgen

- Render-Worker, Canvas-Übertragung und Lebensdauer bleiben unverändert.
- Keine neue Abhängigkeit, kein zusätzlicher Produktions-Build-Pfad und keine doppelte Renderer-Wartung.
- Die derzeitige Szene ist kein Nachweis für spätere Bots, Zuschauer, Post-Processing oder LOD.
- Die Ergebnisse gelten für Chromium 159 und Apple M5 Pro. Andere Browser und GPUs sind nicht abgedeckt.
- Die Rohdaten bleiben als Entscheidungsgrundlage erhalten. Das Scratch-Lab wird nicht ausgeliefert.

## Verworfen

Ein dauerhafter WebGPU-Renderer kommt nicht in Betracht. Der Vergleich zeigt keinen FPS-Vorteil. Im Lab lag die Render-Submission-Zeit höher, und der produktive Himmel braucht eine Portierung. Der GPU-Prozess-RSS zeigt keinen stabilen Unterschied. Ein Wechsel würde damit Aufwand ohne nachgewiesenen Nutzen erzeugen.

Eine Ultra-Stufe kommt ebenfalls nicht in Betracht. Die höhere Auflösung und die zusätzlichen Regentropfen bringen keinen FPS-Gewinn in der heutigen Szene. Der WebGPU-Speicherzähler steigt um 43,8 %, der sichtbare Gewinn bleibt gering. Eine zusätzliche Stufe rechtfertigt sich nicht, bevor die spätere Budget-Szene als Messgrundlage existiert.
