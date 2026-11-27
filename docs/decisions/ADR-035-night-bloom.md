# ADR-035 – Bloom nachts, je Biom, über einen Frame-Presenter

**Status:** Vorgeschlagen (#151). Henry entscheidet mit der Optikfreigabe der Nachtstadt.

## Kontext

Die Nachtstadt (#151) soll Neon zeigen, das leuchtet und nicht nur hell ist. `docs/04-world-3d.md` §2 plant dafür Bloom über die `EffectComposer`-Addons von three. Bisher rendert `scene-core.ts` direkt mit `renderer.render` auf die Leinwand. Tone Mapping und Farbraum entstehen dabei im Material-Shader.

Ein Composer ändert drei Dinge gleichzeitig:

- Die Szene landet zuerst in einem HDR-Ziel (HalfFloat). Tone Mapping passiert erst in `OutputPass`.
- Ein Frame besteht aus mehreren `renderer.render`-Aufrufen. `renderer.info` setzt sich standardmäßig bei jedem Aufruf zurück. Die Diagnose würde dann nur den letzten Vollbild-Pass zählen, und der Budgettest in `routes.spec.ts` wäre wertlos.
- Ein einziges NaN-Pixel im HDR-Ziel verteilt die Unschärfe von Bloom auf einen großen hellen Fleck.

## Entscheidung

- **Nur nachts, nur wo ein Biom es verlangt.** `bloom.ts` hält `BIOME_BLOOM` je `Biome["kind"]`. Nur `night-city` hat einen Wert über 0. Die Stärke ist `peakBloom(regionen) × nightAmount(env)`. Bei Stärke 0 rendert `createFramePresenter` direkt wie bisher. Tagsüber und in Welten ohne Nachtstadt bleibt das Bild damit unverändert.
- **Kette erst bei Bedarf.** `RenderPass → UnrealBloomPass → OutputPass` entsteht beim ersten Frame mit Stärke über 0. Das HDR-Ziel nutzt 4-fach-MSAA, damit Kanten so glatt bleiben wie auf der antialiasierten Leinwand. `OutputPass.needsSwap` ist aus, damit nur eines der zwei Composer-Ziele je auf der GPU entsteht.
- **Schwelle 1,05 linear (Rec.-709-Leuchtdichte).** Die Nachtstadt gibt jedem Neon-Element eine feste Leuchtdichte darüber, für Cyan, Magenta und Amber gleich. Das Laternenlicht bleibt unter der halben Schwelle, beides prüfen Tests. Fenster und Fahrbahn sind nicht gezielt darunter gelegt.
- **Diagnose zählt jeden Pass.** `renderer.info.autoReset = false` und ein `info.reset()` je Frame in `scene-core.ts`. Draw Calls und Dreiecke enthalten damit die etwa 14 Vollbild-Passes der Kette. Das ist aus der Kette abgeleitet und nicht einzeln gemessen.
- **Qualitätsstufe.** `QUALITY_SETTINGS[q].bloom` ist auf Low aus. Die Szene läuft heute fest auf Medium.
- **Gültige Normalen sind Voraussetzung.** Dreiecke ohne Fläche lieferten Normalen der Länge 0 am Rad und am Fahrer. Die wenigen Pixel, die solche Splitter treffen, werden NaN, und Bloom macht daraus einen weißen Fleck am Fahrer. `mergeGeometries` und `SkinBucket` lassen solche Dreiecke jetzt weg. Ein Test prüft, dass jeder gezeichnete Eckpunkt von Rad und Fahrer eine Einheitsnormale hat.

## Konsequenzen

- Keine neue Abhängigkeit: Die Addons gehören zu `three` 0.187.0.
- Nachts in der Nachtstadt kostet ein Frame etwa 14 Draw Calls mehr. Gemessen bleibt die Strecke bei höchstens 93 Draw Calls (`docs/04-world-3d.md` §11).
- Grob geschätzter Speicher bei 1280 × 720 und Pixel-Ratio 1,25: rund 80 MB für das eine MSAA-HDR-Ziel mit Tiefe und die Bloom-Mips. Das ist nicht gemessen. Ob das auf Henrys Laptop passt, klärt die Hardwareabnahme (#86).
- In der Voltonaut-Tour läuft die Kette nachts überall, weil die Welt eine Nachtstadt-Region hat. In Wald und Küste gibt es keine Emitter über der Schwelle, das Bild bleibt gleich, nur die Passes kosten. Atmosphäre je Region (E10-14, Folgeschritt) kann die Stärke später nach Regionsgewicht am Fahrer skalieren.

## Alternativen

- **Selektives Bloom mit zweitem Szenen-Render:** verworfen. Es verdoppelt die Draw Calls der Szene.
- **Bloom-freie Lichthöfe als additive Sprites:** verworfen. Sie leuchten nicht über Kanten und brauchen eigene Geometrie je Emitter.
- **Bloom immer an:** verworfen. Tagsüber würden Sonne, Schnee und Sand ohne Freigabe anders aussehen.
- **NaN im Hochpass abfangen:** verworfen. Das verdeckt ungültige Geometrie, statt sie zu entfernen.
