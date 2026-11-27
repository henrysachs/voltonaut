# Spec E10-17 – Region Weinberge: kurze Rampen für Intervalle

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, „Zusammenhängende Welt“, Folgeschritt Region Weinberge
- **Issue:** [#146](https://github.com/henrysachs/voltonaut/issues/146) (Teil von [#145](https://github.com/henrysachs/voltonaut/issues/145)), Entscheidung [ADR-033](../decisions/ADR-033-connected-worlds.md) §6, §8
- **Vorgänger:** [E10-14](E10-14-voltonaut-world.md) (Welt `voltonaut`, Revision `1`), [E10-12](E10-12-world-heightfield.md), [E10-13](E10-13-world-recording-contract.md)
- **Status:** Implementiert und lokal softwaregeprüft; CI, Review und Hardware offen
- **Betroffene Module:** `packages/engine/src/elevation/data`, `packages/engine/src/world`, `apps/web/src/world`, `apps/web/e2e`, `apps/server/src/rides/replayRoute.ts`

## Ziel

Die Welt `voltonaut` bekommt eine Region Weinberge zwischen Wald und Küste. Ihr Weg „Weinberg-Intervalle“ besteht aus neun kurzen Rampen mit Abfahrten dazwischen und eignet sich für Intervalle. Die Tour fährt jetzt Wald → Weinberge → Küste → Nachtstadt → Wald. Die Welt erhält dafür die Revision `2`; Revision `1` bleibt unverändert und nachrechenbar.

## Abnahmekriterien

- [x] AK1 – **Weg als Daten.** `VINEYARD_INTERVALS` (`vineyard-intervals`, „Weinberg-Intervalle“, Szenerie `vineyard`) ist ein Rundweg von 12,39 km mit neun Rampen von 350–800 m bei 3,5–6,8 % (Entwurfswerte; gemessen im Profil mit der 3-%-Schwelle sind sie wegen der Ausrundungen bis 40 m kürzer, alle bleiben ≥ 300 m). Kuppen und Mulden sind mit 60 m langen Parabeln ausgerundet. Die Abfahrten dazwischen (rund 3,5 %) sind je mindestens 500 m lang. Die Mittellinie ist ein langes, schmales Oval aus Bögen: weite Wendebögen an beiden Enden, sanfte Wellen wie Terrassenwege auf den Längsseiten, kleinster Kurvenradius 454 m (Krümmungsprüfung von `createWorld` bestanden). Sie schließt exakt und hat am Rundenstrich keinen Höhensprung.
- [x] AK2 – **KOM-Segment.** Die zweite Rampe (700 m, 5 %) trägt das Segment `rebhang-kom` („Rebhang KOM“, Art `kom`) für KOM-Wertung und Rangliste (#62). Auf dem Heimweg liegt es ab der Eintrittsstelle der Region (HUD: „KOM · ab 7.1 km“). Auf der Tour trägt kein Segment.
- [x] AK3 – **Revision 2.** `VOLTONAUT_WORLD_REVISION_2` ordnet die Regionen Wald → Weinberge → Küste → Nachtstadt, mit Übergangsstraßen zu beiden Nachbarn. Wege: `voltonaut-tour` (28,0 km), `voltonaut-forest`, `voltonaut-vineyard`, `voltonaut-coast`, `voltonaut-night-city`. Wald (0/0), Küste (4800/−1800) und Nachtstadt (3800/3300) behalten ihre Versätze aus Revision 1. Die Weinberge liegen südlich des Waldes zwischen Wald und Küste (Versatz 1000/−4300); das Oval läuft nach Ostsüdost (−10,3°) und belegt 5,5 × 1,8 km, damit sein Ostende 1,8 km Abstand zur Küste hält. Die Welt bleibt dadurch klein (siehe Messungen). Die Tour fährt 5,6 km des Weinberg-Rundwegs und 1,3 km der Küste. Revision `1` bleibt Byte für Byte gleich (Prüfsumme `9a7770e2:128848`, Test unverändert); Revision `2` hat eine eigene Prüfsumme (`5e9943c4:177499`). Die Übergangsstraßen von Revision `2` übernehmen die Steigung der Rundwege an ihren Enden (kubisch, `matchGrades`), statt waagerecht auszulaufen; die Steigung läuft an den Knoten ohne Sprung weiter. In der ersten, größeren Lage unterschritt die Tour ohne das am Eintritt in die Weinberge den Abstandstest (2,9 cm); in der jetzigen Lage misst sie mit und ohne Angleichung 5,5 cm. Revision `1` bleibt dabei unberührt (Opt-in je Welt).
- [x] AK4 – **Abstände.** Kein Abschnittspaar kommt sich außerhalb von 400 m um gemeinsame Knoten näher als 36 m (gemessen 41,1 m). Die Rundwege der Regionen liegen mindestens 1,8 km auseinander (gemessen 1823 m zwischen Wald und Küste wie in Revision 1; Weinberge 1958 m zum Wald, 1934 m zur Küste). Beides ist per Test abgesichert.
- [x] AK5 – **Neue Rides zeichnen Revision 2.** `routeWorldPath` nimmt die Revision aus `WORLD_REGISTRY` (die neueste), `TEST_ROUTES` und die Render-Sicht ebenso. Aufnahmen von Revision `1` lösen weiter über `worldPathRoute` auf (Welt und Revision müssen genau passen).
- [x] AK6 – **Server rechnet nach.** Eine Sim-Fahrt auf `voltonaut-vineyard` mit `worldRevision: "2"` wird nachgerechnet (`replay.world.test.ts`); die Tour wird in Revision `1` und `2` nachgerechnet. Der Weg in Revision `1`, Revision `3` und unbekannte Wege bleiben `unknown_revision`.
- [x] AK7 – **Steigung und Länge folgen dem Raster.** Die Sim-Steigung (geglättetes Profil der Engine) liegt auf jeder Rampe bei dem Wert der Rampe (6 Stellen). Der Abstandstest aus E10-12 prüft jeden Weg der Revision 2 gegen das gezeichnete Raster der Welt (≥ 5 cm; gemessen: Tour 5,5 cm, Rundwege 6,0 cm). Das Raster entsteht aus den Straßenhöhen; die Rampen formen die Weinberg-Hänge, die Hügelwelle des Rasters (±8 m) kommt dazu.
- [x] AK8 – **Weinberg-Ausstattung.** Rebzeilen folgen den Höhenlinien des gezeichneten Rasters (Sehnen von 6 m, mittlere Steigung entlang der Sehne < 3 %; eine Sehne, die steiler als 5 % ansteigt, beendet ihre Zeile) und sind **ein** instanziertes Mesh mit einer Box-Geometrie (höchstens 7000 Sehnen; die Region hat 6922). Zypressen sind instanzierte Kegel, Steinhäuser instanzierte Boxen (Wand und Dach). Zusammen vier Draw Calls. Keine Rebzeile, Zypresse oder Hütte steht im Korridor irgendeines Abschnitts der Welt (Rebzeilen ≥ 10 m, Zypressen ≥ 9 m, Häuser ≥ 20 m von jeder Mittellinie), auch nicht an den Straßen anderer Regionen. Alles steht auf dem gezeichneten Boden (Bodeninvariante aus [E10-15](E10-15-dressing-ground.md)): Rebzeilen und Häuser auf dem tiefsten Boden unter ihren Ecken, Zypressen auf dem tiefsten Boden unter ihrem Kegelrand. Steigt der Boden unter der Mitte um mehr als 30 % der Höhe darüber, entfällt die Sehne oder das Haus. Dächer werden von den Wänden getragen.
- [x] AK9 – **Sichtweite.** Wie bei E10-14 AK8 wird jedes Ausstattungsobjekt nur innerhalb von 1500 m seiner Grundfläche gezeichnet. Ein Test fährt die Tour ab und belegt, dass kein ausgeblendetes Objekt näher als 1400 m am Fahrer liegt.
- [x] AK10 – **Katalog.** Die Streckenwahl bietet „Weinberg-Intervalle“ (`route=voltonaut-vineyard`) an, Vorschau, Länge und Beschreibung inklusive. Ungültige Werte fallen auf die Testrunde zurück. Standard: klares Wetter, Startzeit 17:30 (warmer Abend), Seed 37.
- [x] AK11 – **Render-Budget.** Der Katalogeintrag hat das Standard-Budget (≤ 150 Draw Calls, ≤ 500 k Dreiecke). `routes.spec.ts` prüft den ersten Frame jedes Katalogwegs und fährt die Tour im Sim (`clock=fast`) durch die Weinberge hinein und wieder hinaus: Distanz wächst ohne Unterbrechung, Status bleibt „Sim connected“, Spitzen von Draw Calls und Dreiecken im Budget. Screenshots (Verfolgerkamera am Übergang und in der Region, Übersicht) liegen als Artefakte unter `test-results`.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene       | Datei                                                                                                                            |
| -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| AK1, AK2 | Unit        | `packages/engine/src/elevation/data/vineyard-intervals.test.ts`                                                                  |
| AK2, AK3 | Unit        | `packages/engine/src/world/data/voltonaut.revision2.test.ts`, `voltonaut.test.ts` (Revision 1 unverändert), `regionTour.test.ts` |
| AK4      | Unit        | `voltonaut.revision2.test.ts`                                                                                                    |
| AK5      | Unit        | `packages/engine/src/world/registry.test.ts`, `apps/web/src/routeSelection.test.ts`                                              |
| AK6      | Integration | `apps/server/src/rides/replay.world.test.ts`                                                                                     |
| AK7      | Unit        | `vineyard-intervals.test.ts`, `apps/web/src/world/road-clearance.test.ts`                                                        |
| AK8      | Unit        | `apps/web/src/world/vineyard-plan.test.ts`, `vineyardScenery.test.ts`, `dressing-ground.test.ts`                                 |
| AK9      | Unit        | `apps/web/src/world/vineyardScenery.test.ts`                                                                                     |
| AK10     | Unit/E2E    | `routeCatalog.test.ts`, `routeSelection.test.ts`, `apps/web/e2e/routes.spec.ts`                                                  |
| AK11     | E2E         | `apps/web/e2e/routes.spec.ts`                                                                                                    |

## Nicht-Ziele und Grenzen

- **Atmosphäre je Region:** Wie in E10-14 hat die Tour **eine** Atmosphäre. Das warme Abendlicht gilt für die Fahrt auf dem Weg `voltonaut-vineyard`; die Tour startet mit dem Katalogwert der Tour (Mittag). Eine Überblendung je Region entfällt.
- Kein eigener See in den Weinbergen. Kein Segment auf der Tour.
- Hügel kommen aus den Straßenhöhen und der gemeinsamen Hügelwelle des Rasters, nicht aus einer eigenen Regionsfunktion. Eine regionsabhängige Geländeform braucht eine Rasteränderung für alle Welten (eigener Schritt).
- Die Revision `1` der Welt bleibt nachrechenbar, wird aber nicht mehr als Neufahrt angeboten.

## Offene Fragen / Risiken

- **Größe der Welt:** Das Raster deckt den Begrenzungsrahmen der Welt ab (256-m-Kacheln plus 384 m Rand); seine Planungszeit wächst mit der Fläche, nicht mit der Straßenlänge. Die erste Lage von Revision 2 (Küste bei 7000/−2400, rundes Weinberg-Oval) verdoppelte die Fläche und ließ Tests in CI an die 5-s-Grenze von Vitest laufen. Die jetzige Lage hält die Fläche bei 75,6 km² (Messwerte unten). Größere Welten brauchen Streaming (#68).
- **Dreiecke am Tourstart:** Die Spitze liegt nahe am Budget von 500 k (Messwerte unten); weitere Regionen brauchen Entlastung.
- **Tour-Atmosphäre:** Henry entscheidet, ob die Überblendung je Region vor Schritt 5 folgt.

## Messungen (manuell, lokal, Sim, SwiftShader, `clock=fast`)

| Strecke                                                                    | Draw Calls (Spitze) | Dreiecke (Spitze) |
| -------------------------------------------------------------------------- | ------------------- | ----------------- |
| voltonaut-tour, Revision 2, ganze Fahrt bis 13,1 km (E2E `routes.spec.ts`) | 127                 | 466 k             |

Die Dreiecksspitze liegt bei 93 % des Budgets von 500 k. Die Startzeit bis zum ersten Frame wurde nicht gemessen.

Weltgröße und Planungszeit des Rasters (lokal, Apple M5 Pro, Vitest ohne Coverage, Median aus 5 Läufen). „Tour allein“ ist der Landschaftsplan der Tour als einzelne Strecke wie in `road-apron.test.ts`; seine Zeit ist fast ganz die Rasterplanung.

| Welt                   | Tour    | Begrenzungsrahmen | Rasterkacheln | Weltplan | Tour allein |
| ---------------------- | ------- | ----------------- | ------------- | -------- | ----------- |
| Revision 1             | 23,2 km | 52,4 km²          | 1044          | 297 ms   | 148 ms      |
| Revision 2, erste Lage | 32,1 km | 113,4 km²         | 2068          | 675 ms   | 328 ms      |
| Revision 2             | 28,0 km | 75,6 km²          | 1443          | 493 ms   | 228 ms      |

## Nachweisstand

- **Implementiert:** ja.
- **Am tatsächlichen Artefakt softwaregeprüft:** lokal mit der jetzigen Lage: Format, Lint, Typen, depcruise, guard und 2421 Unit-Tests grün (`mise run test`), Mutation 95,47 %, E2E `routes.spec.ts` 10/10 grün (Tour im Sim durch die Region hinein und hinaus; Screenshots zeigen Rebzeilen, Zypressen und Hänge). Die ganze E2E-Suite lief nach der Lageänderung nicht erneut. CI offen.
- **An echter Hardware geprüft:** nein.
- **Bereitgestellt:** nein.

## Doku-Updates

- [x] Roadmap-Checkbox · [x] `docs/04-world-3d.md` · [x] `docs/01-architecture.md` · [x] Revisionsnote in E10-14 · [ ] ADR nicht nötig (ADR-033 §8 deckt neue Revision).
