# Spec E10-12 – Zusammenhängende Welt, Schritt 2: Höhenraster mit Korridor-Einebnung

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, „Zusammenhängende Welt: Straßennetz, Höhenraster, Biome als Regionen“, Unterpunkt Schritt 2
- **Issue:** [#150](https://github.com/henrysachs/voltonaut/issues/150) (Schritt 2: #160), Entscheidung [ADR-033](../decisions/ADR-033-connected-worlds.md) §5 und §9 (angenommen am 2026-11-27)
- **Vorgänger:** [E10-11](E10-11-connected-world.md) (Schritt 1, #158), Biome aus #138 mit #168/#169
- **Status:** Review
- **Betroffene Module:** `apps/web/src/world` (Planung ohne `three`, Darstellung mit `three`)

## Ziel

Das Gelände ist kein Streifen entlang einer Strecke mehr, sondern ein Höhenraster der ganzen Welt in Kacheln zu 256 m. Jede Straße der Welt ebnet das Raster in ihrem Korridor ein; wo sich Korridore überlappen, gewinnt die tiefere Straße. Ein exakter Abstandstest belegt für jede ausgelieferte Route: Kein Geländepunkt liegt über der Fahrbahn. Die Biome aus #138 (Küste, Alpenpass, Nachtstadt) behalten Farben, See-Regel, Szenerie und das Bankett unter den Alpenkehren.

## Begriffe

- **Straßen einer Welt:** alle Routen der Welt, in der die gefahrene Route liegt (`TEST_WORLDS`, Schritt 1). Heute hat jede Welt genau eine Route.
- **Fahrbahnband:** das gezeichnete Bankett-Band (8 m breit, ±4 m um die Mittellinie), exakt so trianguliert wie in `road.ts` (Stützstellen alle ≤ 4 m, gemeinsam aus `road-plan.ts`). Seine Höhe ist die Streckenhöhe an den Stützstellen; die gezeichneten Schichten liegen 0,005–0,035 m darüber.
- **Gelände:** alles, was als Boden gezeichnet wird: das Raster (gleiche Zelldiagonale wie die Geometrie) und auf Routen des Alpen-Bioms die Bankettschürze aus #138.
- **Abstand:** Höhe des Fahrbahnbands minus Geländehöhe an derselben XZ-Stelle.

## Abnahmekriterien

- [x] AK1 – **Raster in Kacheln.** Das Raster deckt die XZ-Hülle aller Straßen der Welt plus 384 m Rand ab, auf Vielfache von 256 m ausgerichtet. Jede Kachel ist 256 m × 256 m. Kacheln, die näher als 64 m an einer Straße liegen oder die Seemulde schneiden, haben 8 m Punktabstand (33 × 33 Punkte), alle anderen 32 m (9 × 9).
- [x] AK2 – **Korridor-Einebnung.** Auf einer geraden Straße mit konstanter Steigung liegt jeder Rasterpunkt bis 4 m neben der Mittellinie exakt (± 1e-9 m) 0,06 m unter der Straßenhöhe am Lotfußpunkt. Bis 17 m neben der Mittellinie liegt kein Rasterpunkt über dieser Höhe. Ab 48 m wirkt keine Straße mehr; neben der Testrunde weicht das Gelände dort irgendwo um mehr als 8 m von der Straßenhöhe ab.
- [x] AK3 – **Tiefere Straße gewinnt.** Zwei Straßen mit überlappenden Korridoren auf unterschiedlicher Höhe (parallel im Abstand von 14 m, 6 m Höhenunterschied; kreuzend wie eine Brücke, 10 m Höhenunterschied): Im Überlappungsbereich liegt jeder Rasterpunkt höchstens auf der Einebnungshöhe der tieferen Straße, bis 4 m neben der tieferen Straße exakt darauf. Beide Straßen bestehen den Abstandstest (AK4). In einer Kehre liefert jeder Ast einen eigenen Kandidaten, der tiefere gewinnt. Die Reihenfolge der Straßen ändert das Raster nicht (≤ 1e-9 m).
- [x] AK4 – **Abstandstest für jede Route.** Für jede Route in `TEST_ROUTES` (`flat-loop`, `test-loop`, `kom-climb`, `coast-loop`, `alpine-pass`, `night-city`) ist der kleinste Abstand im gesamten Fahrbahnband ≥ 0,05 m, mit der See-Regel ihres Bioms. Die Prüfung ist exakt, nicht stichprobenhaft: Band und Gelände sind stückweise linear, also wird an allen Ecken der Überlagerung geprüft (Raster: Banddreiecks-Ecken, Rasterpunkte im Banddreieck, Schnitte der Bandkanten mit Rasterlinien und Zelldiagonalen; Schürze: Ecken und Kantenschnitte beider Dreiecksnetze). Dieselbe Prüfung besteht eine synthetische Kehre (12 m Bogenradius, 6 % Steigung). 20 000 Zufallsproben finden keinen kleineren Abstand als die exakte Prüfung. Ein künstlich angehobener Rasterpunkt unter der Fahrbahn wird als Verstoß mit Ort gemeldet.
- [x] AK5 – **Kachelgrenzen stetig.** Benachbarte Kacheln gleicher Auflösung haben bitgleiche Randpunkte. Eine feine Kachel neben einer groben legt ihre Randpunkte auf die Kante der groben Kachel (± 1e-9 m). Die Geländehöhe springt an keiner Kachelgrenze (Proben 1e-6 m links/rechts der Grenze, Abweichung ≤ 1e-4 m).
- [x] AK6 – **Determinismus.** Gleiche Straßen, gleicher See und gleicher Seed ergeben ein feldweise gleiches Raster und gleiche Szenerie; ein anderer Seed ändert Relief und Bäume. Kein Zufall zur Laufzeit.
- [x] AK7 – **Szenerie und Biome bleiben stimmig.** Wald: See unter der Startstraße, über seinem Grund, hinter trockenem Ufer; Bäume und Felsen ≥ 7 m Kronenabstand zu jeder Straße, außerhalb des Sees, exakt auf der Geländehöhe; Plakatwände und Kilometersteine wie bisher. Biome (#138): Paletten färben das Raster je Biom, Wald und Küste behalten den See, Alpenpass und Nachtstadt nicht; Alpenfelsen und -kiefern ≥ 8 m von jedem Straßenast. Alpen-Regression aus #169: Unter beiden Fahrbahnkanten (±3,5 m) liegt alle 10 m auf 28,4 km Boden unter der Fahrbahn, höchstens 0,6 m tiefer, mit Normale > 0,9.
- [x] AK8 – **Gezeichnetes Netz = Planung.** Raycasts von oben auf die `three`-Meshes treffen an Stichproben auf Straße, See, Bäumen, Felsen und Umland die geplante Geländehöhe (± 1e-3 m); Normalen zeigen nach oben. An jeder Kachelnaht haben die gezeichneten Punkte gleiche Höhe und gleiche Normale.
- [x] AK9 – **Render-Budget.** Die E2E-Prüfungen (`ride-scene.spec.ts`, `routes.spec.ts` je Katalogroute) halten ≤ 150 Draw Calls und ≤ 500 k Dreiecke. Messwerte vorher/nachher unten.
- [x] AK10 – **Ressourcen.** Alle Geometrien und Materialien des Geländes werden genau einmal freigegeben (bestehender Freigabetest).

## Verfahren

1. **Natürliches Gelände:** Basis = inverse Distanzgewichtung der Straßenhöhen (Straßenpunkte alle 32 m, Reichweite 600 m) auf einem 32-m-Gitter, bilinear interpoliert; weit weg von allen Straßen die mittlere Straßenhöhe. Dazu Relief aus zwei Sinuswellen (etwa −5 bis +11 m) mit seedabhängiger Phase und, bei Wald und Küste, die Seemulde.
2. **Korridor-Kandidaten:** je Straße die lokalen Abstandsminima zur gezeichneten Mittellinie (ein Kandidat je vorbeiführendem Ast; Kehren liefern zwei). Einebnungshöhe je Kandidat: Fahrbahnhöhe am Lotfußpunkt minus 0,06 m.
3. **Tiefere Straße gewinnt:** Kandidaten absteigend nach Einebnungshöhe mischen (`h ← h + a·(f − h)`, `a` = 1 bis 4 m, Smoothstep bis 36 m), der tiefste zuletzt. Jeder Kandidat deckelt zusätzlich: bis 17 m auf `f`, danach mit Steigung 1 (Böschung).
4. **Banddecke (Beweis der Freiheit):** Jeder Rasterpunkt bleibt 0,06 m unter der tiefsten verlängerten Ebene aller Banddreiecke im Umkreis von 8·√2 m + 0,01 m. Ein Geländedreieck, das einen Bandpunkt P überdeckt, hat alle Ecken höchstens eine Zelldiagonale von P entfernt, also nahe am Banddreieck von P. Da Ebenen linear sind, liegt das interpolierte Gelände bei P dann unter der Fahrbahn – unabhängig von Kurvenradius, Knicken und Höhenprofil. Auf konstanter Steigung fallen alle Ebenen zusammen, die Decke kostet dort keine Höhe; in scharfen Senken und neben tieferen Ästen liegt das Raster tiefer.
5. **Bankettschürze (Alpen-Biom, aus #138):** Wo ein tieferer Ast das Raster hält oder eine Senke es absenkt, trägt die Schürze die Fahrbahnkanten: ein gehrungsverbundenes Band alle ≤ 2 m, ±4 m breit, 0,3 m unter der Straße. Neu: Jeder Schürzenpunkt bleibt auch 0,3 m unter jedem Fahrbahnband, das direkt über ihm liegt. Ohne diese Regel ragte die Schürze an einem 90°-Knick des Alpenpasses (km 26,9) 0,11 m über die Fahrbahn; das hat der exakte Abstandstest gefunden.
6. **Raster:** Kacheln tasten die Höhenfunktion ab; feine Randpunkte neben groben Kacheln werden auf die grobe Kante gelegt. 32-m-Zellen ohne Straße im Umkreis von 48 m plus halber Zelldiagonale überspringen die Korridor- und Bandsuche (ergibt dieselben Höhen, spart Startzeit). Normalen kommen aus dem Raster mit festem 8-m-Abstand. Zur Darstellung werden 4 × 4 Kacheln (1024 m) zu einem Mesh zusammengefasst; Frustum-Culling arbeitet je Mesh.
7. **Szenerie:** Waldbäume und -felsen werden wie bisher je Straße gestreut (gleicher Seed, gleiche Reihenfolge) und auf die Geländehöhe gesetzt; Biom-Szenerie (#138) liest die Geländehöhe über `terrainPosition`. Der Streifen-Sonderfall aus #138 (Querversätze an Kehren stauchen, Streifendreiecke über fremden Ästen verwerfen) entfällt, weil das Raster keine Querversätze mehr kennt.

## Testplan (`docs/10-testing.md`)

| AK                | Ebene         | Datei / Fixture                                                                |
| ----------------- | ------------- | ------------------------------------------------------------------------------ |
| AK1, AK5, AK6     | Unit          | `apps/web/src/world/heightfield.test.ts`                                       |
| AK2, AK3          | Unit          | `apps/web/src/world/road-corridor.test.ts`                                     |
| AK4 (Raster)      | Unit (exakt)  | `apps/web/src/world/road-clearance.test.ts`                                    |
| AK4 (Schürze)     | Unit (exakt)  | `apps/web/src/world/road-apron.test.ts`                                        |
| AK7 (Alpen, #169) | Unit          | `apps/web/src/world/alpineLandscape.test.ts` (acht Abschnitte über 28,4 km)    |
| AK7 (Biome)       | Unit/three    | `apps/web/src/world/biomeScenery.test.ts`                                      |
| AK6–AK8, AK10     | Unit/three    | `apps/web/src/world/landscape.test.ts`, `billboard-plan.test.ts`               |
| AK9               | E2E           | `apps/web/e2e/ride-scene.spec.ts`, `apps/web/e2e/routes.spec.ts`               |
| Stützstellen      | Unit          | `apps/web/src/world/road-plan.test.ts`                                         |
| Weltstraßen       | Unit          | `apps/web/src/world/render-loop.test.ts` (`resolveRenderRoads`)                |
| Golden            | Golden/Replay | unverändert: `apps/web/src/golden/golden.test.ts` (Engine und Rules unberührt) |

## Nicht-Ziele

- Keine LOD-Stufen, kein Geomorphing, kein Splat-Mapping, keine KTX2-Texturen (`docs/04-world-3d.md` §4 bleibt dafür Ziel; Issue #68).
- Keine Regionen, Atmosphären, Übergangszonen und keine Welt `voltonaut` (Schritt 3).
- Kein Nachladen von Kacheln zur Laufzeit; das Raster entsteht einmal beim Start des Render-Workers.
- Keine Änderung an Engine, Rules, Streckendaten, Aufnahmen, Replay oder Server.

## Offene Fragen / Risiken

- **Breiteres flaches Bankett bergseitig:** Damit kein 8-m-Dreieck über die Fahrbahn ragt, bleibt das Gelände bis gut 15 m neben der Mittellinie auf Fahrbahnhöhe (Banddecke) und steigt ab 17 m mit Steigung 1. Talseitig fällt die Böschung wie bisher ab 4 m. Ein 4-m-Raster würde das Bankett auf etwa 10 m verkleinern, kostet aber etwa viermal so viele Dreiecke nahe der Straße. Henry entscheidet, ob das so bleibt.
- **Schürze nur im Alpen-Biom:** Wie in #138 bekommen nur Routen mit `scenery: "alpine"` die Schürze; das sind `alpine-pass` und `kom-climb`. In Schritt 3 hängt sie besser an der Straße (enge Kehren) als am Biom.
- **Straßen = Routen der Welt:** `World` aus Schritt 1 gibt Routen, keine einzelnen Abschnitte heraus. Ein Abschnitt, den kein Weg benutzt, ebnet das Raster nicht ein. Für Schritt 3 sollte `World` die Abschnitte als Straßen liefern.
- **Kehren und Knicke:** Neben einem tieferen Ast schwebt die höhere Fahrbahn über dem Raster; die Schürze füllt nur ±4 m. Optisch fehlt dort eine Stützmauer. Der Alpenpass hat weiter 90°-Knicke (Krümmungsprüfung aus Schritt 1 ist für ihn ausgesetzt).
- **Startkosten:** Das Raster entsteht im Render-Worker beim Start. Gemessen in Node 24 (Vitest, warm): Testrunde etwa 0,12–0,17 s Planung plus 0,05–0,07 s Meshes; Alpenpass etwa 0,7 s Planung (vor den Startzeit-Optimierungen gemessen). Der Garage-E2E (`garage-loadout.spec.ts`, zweiter Browser) reagiert hier stark auf die Worker-Startzeit: Mit 300 ms künstlicher Wartezeit scheitert er auch auf `main` (3 von 8). Vor den Optimierungen scheiterte er auf diesem Zweig in 2 von 6, danach in 1 von 21 Läufen; `main` bestand 9 von 9. Auf echter Hardware nicht gemessen.

## Kosten im Render-Budget

| Welt          | Kacheln (fein / grob) | Dreiecke Raster gesamt | Meshes (4 × 4 Kacheln) | Schürze |
| ------------- | --------------------- | ---------------------- | ---------------------- | ------- |
| `test-loop`   | 256 (79 / 177)        | 184 448                | 16                     | –       |
| `flat-loop`   | 100 (43 / 57)         | 95 360                 | 9                      | –       |
| `kom-climb`   | 56 (24 / 32)          | 53 248                 | 4                      | 2 500   |
| `coast-loop`  | 162 (67 / 95)         | 149 376                | 15                     | –       |
| `alpine-pass` | 616 (235 / 381)       | 530 048                | 44                     | 28 380  |
| `night-city`  | 96 (48 / 48)          | 104 448                | 6                      | –       |

Gezeichnet werden nur die Meshes im Sichtkegel. E2E-Messung (`/?sim=1&debug=1&route=…`, 1280 × 720, headless Chromium mit SwiftShader, je zwei Messungen je Kamera; Draw Calls / Dreiecke):

| Route         | Kamera    | `main` (d4bf14b)         | dieser Zweig             |
| ------------- | --------- | ------------------------ | ------------------------ |
| `test-loop`   | Verfolger | 108 / 238 k · 92 / 229 k | 112 / 231 k · 96 / 220 k |
| `test-loop`   | Übersicht | 82 / 223 k · 77 / 221 k  | 85 / 197 k · 79 / 194 k  |
| `coast-loop`  | Verfolger | 74 / 184 k · 74 / 184 k  | 75 / 159 k · 76 / 160 k  |
| `coast-loop`  | Übersicht | 72 / 182 k · 70 / 181 k  | 74 / 168 k · 72 / 167 k  |
| `alpine-pass` | Verfolger | 86 / 454 k · 85 / 454 k  | 94 / 378 k · 91 / 382 k  |
| `alpine-pass` | Übersicht | 83 / 453 k · 83 / 453 k  | 89 / 377 k · 88 / 376 k  |
| `night-city`  | Verfolger | 55 / 120 k · 52 / 120 k  | 56 / 127 k · 53 / 126 k  |
| `night-city`  | Übersicht | 48 / 119 k · 48 / 119 k  | 47 / 109 k · 48 / 109 k  |

Die Messwerte stammen vom Stand vor den letzten Startzeit-Optimierungen; diese ändern weder Geometrie noch Dreieckszahl.

## Nachweisstand

- **Implementiert:** Schritt 2 (Raster, Korridor-Einebnung, Banddecke, Schürze im Alpen-Biom, exakter Abstandstest, Darstellung, Szenerie, Biome aus #138).
- **Am tatsächlichen Artefakt softwaregeprüft:** lokal Format, Lint, Typecheck, depcruise, guard, Unit- und Golden-Tests mit Coverage, E2E im Sim-Modus (Ergebnisse im Bericht zum Push). CI steht aus.
- **An echter Hardware geprüft:** nein (keine Hardwarefunktion; Render-Budget und Startzeit auf echter Hardware bleiben #86).
- **Bereitgestellt:** nein.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Roadmap-Unterpunkt Schritt 2 · [x] `docs/04-world-3d.md` §4 und §11 · [x] ADR-033 Freigabe (Henry, 2026-11-27)
