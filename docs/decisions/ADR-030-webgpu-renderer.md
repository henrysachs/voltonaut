# ADR-030 – WebGPU ohne zweites Render-Backend, Ultra zurückgestellt

- **Status:** Vorgeschlagen für [Issue #79](https://github.com/henrysachs/voltonaut/issues/79). Henrys Freigabe steht aus. Die Entscheidung gilt für den aktuellen Fahr-Renderpfad, nicht für einen späteren WebGPU-Umbau.
- **Bezug:** ADR-002, ADR-008, ADR-014, ADR-019, Spec [E10-10](../specs/E10-10-webgpu-evaluation.md).

## Kontext

Der Fahr-Renderpfad verwendet `WebGLRenderer` aus three r187 im Render-Worker. Issue #79 verlangt einen Vergleich mit WebGPU auf echter Hardware. Ein zweiter Renderer soll nur bei einem nachweisbaren Nutzen entstehen.

Der Prototyp verglich WebGL2 und WebGPU mit High und Ultra auf einem MacBook Pro M5 Pro. Beide Backends erhielten dieselben Szenenparameter, denselben Seed und dieselbe Kamerapose. [E10-10](../specs/E10-10-webgpu-evaluation.md) dokumentiert die Messbedingungen, den Backend-Nachweis, die Rohdaten und die Screenshots.

Der produktive Himmel verwendet GLSL-`ShaderMaterial`. Three r187 lehnt dieses Material im WebGPU-Backend ab. Das Lab ersetzte den Himmel für beide Backends durch dieselbe scheitelgefärbte Geometrie. Die übrigen Szenensysteme blieben unverändert.

## Messergebnis

Die erste Messung protokolliert den `WebGPURenderer`, aber nicht das tatsächlich initialisierte Backend pro Lauf. Die Tabellenbezeichnung „WebGPU“ bezeichnet daher die angeforderte Variante. Ein WebGL2-Fallback ist nicht ausgeschlossen. CPU- und Bildunterschiede werden erst durch die Folgemessung mit `renderer.backend.isWebGPUBackend` dem WebGPU-Backend zugeordnet.

| Variante | FPS p50 | FPS p5 | CPU Frame + Submission p50 | GPU-Prozess-RSS | WebGPURenderer-Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| WebGL High | 120,48 | 108,70 | 0,40 ms | 118,45 MiB | nicht verfügbar |
| WebGPU High | 120,48 | 108,70 | 0,60 ms | 116,61 MiB | 28,12 MiB |
| WebGL Ultra | 120,48 | 108,70 | 0,40 ms | 121,06 MiB | nicht verfügbar |
| WebGPU Ultra | 120,48 | 108,70 | 0,60 ms | 116,34 MiB | 40,43 MiB |

Alle Variantenwerte sind Mediane aus fünf Läufen. Die p5-Spannen überlappen sich. Die leere Seite erreicht p50 120,48 fps und p5 109,89 fps. Die 120-Hz-Anzeige begrenzt jede Variante. Die Messung zeigt daher keinen messbaren FPS-Unterschied in diesem Setup. Sie schließt einen Unterschied ohne Anzeigelimit oder mit GPU-Zeitmessung nicht aus.

Die CPU-Zeit für Frame-Vorbereitung und Render-Submission liegt bei WebGPU median 50 % über WebGL. Die Differenz beträgt 0,2 ms bei einer Quantisierung von 0,1 ms. Sie enthält keine GPU-Ausführungsdauer und ist kein alleiniger Beleg höherer Gesamtkosten.

Der mediane GPU-Prozess-RSS ist bei High 1,6 % und bei Ultra 3,9 % niedriger. Die Spannweiten überlappen. Die Stichprobe erfasst Prozessspeicher am höchsten Gesamt-RSS des Browsers, nicht den GPU-Spitzenbedarf oder dedizierten VRAM. Der Speicherzähler des WebGPURenderer steigt von High auf Ultra um 43,8 %. WebGL liefert keine vergleichbaren Bytegrenzen.

Die Backends erzeugen trotz gleicher Szenenparameter keine pixelgleichen Bilder. Bei High liegt die Kantenstärke bei WebGPU rund 44 % über WebGL. Die mittlere Helligkeitsdifferenz zwischen den Backends beträgt 3,236 bei High und 3,223 bei Ultra auf einer 0-bis-255-Skala. Die Screenshots zeigen bei WebGPU hellere Nebel- und Hügelbereiche. Das Lab hat die Ursache nicht bestimmt. Der Unterschied ist weder ein belegter Qualitätsgewinn noch ein Beleg visueller Parität.

Ultra erhöht die Kantenstärke innerhalb desselben Backends um 3,2 % bei WebGL und 1,4 % bei WebGPU. Die mittleren Helligkeitsdifferenzen betragen 0,160 und 0,230. Die Bilder haben 1280 × 720 CSS-Pixel bei `deviceScaleFactor = 1`. Sie zeigen Ultra nur durch Supersampling. Das Urteil eines geringen sichtbaren Gewinns gilt nur für diesen Vergleich. Die native Darstellung auf einem Display mit DPR 2 wurde nicht bewertet.

## Entscheidung

Der Fahr-Renderpfad bleibt bei WebGL. Es gibt keinen WebGPU-Renderer, keinen Renderer-Schalter und keine parallele dauerhafte Backend-Implementierung. Der Vergleich zeigt keinen messbaren FPS-Vorteil am Anzeigelimit. Zudem bleiben die Bilddifferenz, die Himmel-Portierung und der produktive Worker-Pfad offen.

Eine eigene Ultra-Stufe wird nicht aktiviert. Medium bleibt der aktuelle Produktionswert. High und Ultra bleiben Experimentierwerte. Der kleine Gewinn im Supersampling-Vergleich rechtfertigt keine neue Produktstufe, solange der native DPR-2-Vergleich und die Kosten in der Performance-Budget-Szene fehlen.

Die Entscheidung wird erneut geprüft, wenn einer der folgenden Fälle eintritt:

- Die Performance-Budget-Szene mit Bots, Zuschauern und Post-Processing erreicht auf WebGL das 60-fps-Ziel nicht.
- Ein WebGPU-Port unterstützt den Himmel und die übrigen Materialien mit erklärten oder kontrollierten Bildunterschieden.
- Eine Messung ohne Anzeigelimit oder mit GPU-Zeitmessung zeigt einen reproduzierbaren Vorteil auf der aktuellen Szene.
- Ein Vergleich auf einem Display mit nativem DPR 2 zeigt einen relevanten Qualitätsgewinn durch Ultra.

## Folgen

- Render-Worker, Canvas-Übertragung und Lebensdauer bleiben unverändert.
- Keine neue Abhängigkeit, kein zusätzlicher Produktions-Build-Pfad und keine doppelte Renderer-Wartung entstehen.
- Die Messung auf Code-Basis `82238d3` deckt spätere Bots, Zuschauer, Post-Processing und LOD nicht ab. Das neue Avatar aus PR #105 wurde nicht erneut gemessen.
- Das Lab lief im Main-Thread. Es misst weder den produktiven Render-Worker noch die OffscreenCanvas-Darstellung.
- Die Ergebnisse gelten für Chromium 159 und Apple M5 Pro. Andere Browser und GPUs sind nicht abgedeckt.
- Die Rohdaten bleiben erhalten. Das Scratch-Lab wird nicht ausgeliefert und ist aus dem Repository allein nicht reproduzierbar.

## Verworfen

Ein dauerhafter WebGPU-Renderer kommt derzeit nicht in Betracht. Die Messung zeigt im gedeckelten Setup keinen FPS-Vorteil. Die unerklärte Bilddifferenz, die erforderliche Himmel-Portierung und der fehlende Worker-Vergleich verhindern eine belastbare Nutzenaussage. Die höhere, grob quantisierte Submission-Zeit ist nur ein zusätzliches Indiz.

Eine Ultra-Stufe kommt derzeit ebenfalls nicht in Betracht. Die Messung bestimmt ihre Kosten am 120-Hz-Limit nicht. Sie zeigt nur einen kleinen Gewinn im Supersampling-Vergleich und keine native DPR-2-Darstellung. Eine zusätzliche Stufe wird erst nach einem Vergleich in der Performance-Budget-Szene und auf einem geeigneten Display geprüft.
