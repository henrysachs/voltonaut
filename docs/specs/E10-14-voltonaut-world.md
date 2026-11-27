# Spec E10-14 – Zusammenhängende Welt, Schritt 3: Welt `voltonaut` mit Regionen

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, „Zusammenhängende Welt: Straßennetz, Höhenraster, Biome als Regionen“
- **Issue:** [#171](https://github.com/henrysachs/voltonaut/issues/171) (Teil von [#150](https://github.com/henrysachs/voltonaut/issues/150)), Entscheidung [ADR-033](../decisions/ADR-033-connected-worlds.md) §6 und „Umsetzung“ Schritt 3 (vorgeschlagen, Henrys Freigabe ausstehend)
- **Vorgänger:** [E10-11](E10-11-connected-world.md) (Schritt 1), [E10-12](E10-12-world-heightfield.md) (Schritt 2), [E10-13](E10-13-world-recording-contract.md) (Schritt 4)
- **Status:** Implementiert und lokal softwaregeprüft; CI, Review und Hardware offen
- **Betroffene Module:** `packages/engine/src/world`, `apps/web/src/world`, `apps/web/src/routeSelection.ts`, `apps/server/src/rides/replayRoute.ts`

## Ziel

Die erste zusammenhängende Welt `voltonaut`: Wald und See (Testrunde), Küste und Nachtstadt sind Regionen, verbunden durch Übergangsstraßen. Die „Voltonaut-Tour“ fährt ohne Unterbrechung durch alle drei Regionen. Jede Region behält ihren eigenen Rundweg. Zunächst feste Wege, noch ohne Abbiegen.

## Abnahmekriterien

- [x] AK1 – **Welt als Daten.** `VOLTONAUT_WORLD` (Revision `"1"`) entsteht aus den ausgelieferten Rundwegen `test-loop`, `coast-loop` und `night-city` an festen Orten. `createWorld` akzeptiert sie mit allen Prüfungen aus Schritt 1 (Höhenstetigkeit, Krümmungsgrenze). Wege: `voltonaut-tour` sowie `voltonaut-forest`, `voltonaut-coast`, `voltonaut-night-city`.
- [x] AK2 – **Übergangsstraßen.** Eine Übergangsstraße verlässt eine Region an dem Punkt ihres Rundwegs, dessen Tangente zur nächsten Region zeigt, und mündet tangential in den nächsten Rundweg (kubische Bézier-Kurve, ≤ 10 m Sehnen, Höhe mit Kosinus-Übergang). Ihre Mitte ist die Regionsgrenze: Die erste Hälfte gehört zur verlassenen, die zweite zur erreichten Region.
- [x] AK3 – **Fahrt durch mehrere Regionen.** Die Tour (23,2 km) fährt Wald → Küste → Nachtstadt → Wald als ein Rundweg. Server und Client zeichnen und rechnen sie als Welt `voltonaut`, Revision `1`, Weg `voltonaut-tour` (ADR-033 §7).
- [x] AK4 – **Keine Kreuzungen.** Kein Abschnittspaar kommt sich außerhalb von 400 m um gemeinsame Knoten näher als 36 m (gemessen 36,5 m). Die Rundwege verschiedener Regionen liegen mindestens 1,8 km auseinander (gemessen 1823 m). Beides ist per Test abgesichert, ebenso eine Prüfsumme der Geometrie von Revision `1`: Jede Geometrieänderung muss die Revision erhöhen (ADR-033 §8).
- [x] AK5 – **Kein Gelände über der Fahrbahn.** Der Abstandstest aus Schritt 2 prüft jeden Weg der Welt gegen das gezeichnete Raster dieser Welt (≥ 5 cm).
- [x] AK6 – **Regionen im Bild.** Jede Region hat einen Heimweg (ihren eigenen Rundweg). Geländefarben gehen über 600 m zwischen Regionen über (Regionskarte). Bäume gehören der Region, die die Karte an ihrem Standort nennt. Jede Region trägt ihre Biom-Ausstattung und ihren See entlang ihres Heimwegs.
- [x] AK7 – **Alle Straßen sichtbar.** Abschnitte außerhalb des gefahrenen Wegs werden als Nebenstraßen gezeichnet (drei zusammengefasste Meshes). Das Gelände plant jede Straße genau einmal: Heimwege plus die Abschnitte, die auf keinem Heimweg liegen.
- [x] AK8 – **Render-Budget je Region** (ADR-033 §6). Jedes Ausstattungsobjekt (Mesh, instanziertes Mesh) wird nur gezeichnet, solange der Fahrer höchstens 1500 m (Kamera-Fernebene) von seiner tatsächlichen Grundfläche entfernt ist. Ein Test fährt eine Tour ab und belegt, dass kein ausgeblendetes Objekt näher als 200 m am Fahrer liegt. In Welten mit mehreren Regionen bringt die Ausstattung kein eigenes Licht mit (das Umgebungslicht der Nachtstadt wirkte sonst szenenweit). Draw Calls und Dreiecke über die ganze Tour sind eine **manuelle Messung** (siehe unten); `routes.spec.ts` prüft automatisch nur den ersten Frame.
- [x] AK9 – **Einzelstrecken unverändert.** Welten mit einer Region zeichnen wie vorher: gleiche Pläne, gleiche Farben, Testrunde höchstens 111 Draw Calls. Golden-Fahrten unverändert grün.
- [x] AK10 – **Katalog.** Die Streckenwahl bietet „Voltonaut-Tour“ an. Unbekannte Wege lehnt der Server als `unknown_revision` ab.

## Testplan (`docs/10-testing.md`)

| AK        | Ebene           | Datei                                                                                                                            |
| --------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| AK1–AK4   | Unit            | `packages/engine/src/world/data/voltonaut.test.ts`, `build/*.test.ts`, `regions.test.ts`                                         |
| AK3       | Unit/Replay     | `apps/web/src/routeSelection.test.ts`, `apps/server/src/rides/replay.world.test.ts`                                              |
| AK5       | Unit            | `apps/web/src/world/road-clearance.test.ts`                                                                                      |
| AK6       | Unit            | `region-map.test.ts`, `regional-landscape.test.ts`, `terrain-shades.test.ts`, `render-world.test.ts`, `landscape-system.test.ts` |
| AK7, AK8  | Unit/E2E        | `region-visibility.test.ts`, `render-loop.test.ts`, `apps/web/e2e/routes.spec.ts`                                                |
| AK9, AK10 | Unit/Golden/E2E | bestehende Suites, `routeCatalog.test.ts`, `routes.spec.ts`                                                                      |

## Messungen (manuell, lokal, Sim, SwiftShader, ein Worker; Messfahrt mit `clock=fast`)

| Strecke        | „Sim connected“ → erster Frame | Draw Calls (Spitze über die Runde) | Dreiecke (Spitze) |
| -------------- | ------------------------------ | ---------------------------------- | ----------------- |
| test-loop      | 1,7–1,9 s                      | 111                                | 234 k             |
| alpine-pass    | 2,0–2,2 s                      | –                                  | –                 |
| voltonaut-tour | 2,85–2,95 s                    | 137                                | 359 k             |

## Nicht-Ziele

- Atmosphäre je Region (Tageszeit, Wetter, Farbkorrektur) mit Überblendung: Die Tour fährt mit einer Atmosphäre.
- Der Alpenpass als Region: Seine Wendepunkte haben 90°-Knicke und bestehen die Krümmungsprüfung nicht.
- Abbiegen während der Fahrt, Mini-Map (Schritt 5), Terrain-Streaming (#68).

## Offene Fragen / Risiken

- **Startzeit:** Die Welt hat 38 km Straße; das Raster aus Schritt 2 wächst mit der Straßenlänge. Bis zum ersten Frame vergehen rund 1 s mehr als beim Alpenpass. Größere Welten brauchen Streaming (#68).
- **Draw Calls an Kreuzungen:** Bäume an Verbindungsstraßen werden in 500-m-Abschnitten gebündelt, an Heimwegen weiter in 250-m-Abschnitten; die Ausfahrt aus dem Wald ist die engste Stelle.
- **Atmosphäre und Alpenpass:** Folgeschritt; Henry entscheidet, ob vor Schritt 5.
- **Weltrevision:** Jede Geometrieänderung an `voltonaut` braucht eine neue Revision und einen Eintrag in der Server-Liste nachrechenbarer Welten.

## Nachweisstand

- **Implementiert:** ja.
- **Am tatsächlichen Artefakt softwaregeprüft:** lokal (Gate, E2E, Messfahrt im Sim); CI offen.
- **An echter Hardware geprüft:** nein (Render-Budget und Startzeit offen, #86).
- **Bereitgestellt:** nein.
