# Spec E10-15 – Region Weinberge: kurze Rampen für Intervalle

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, „Zusammenhängende Welt“, Folgeschritt Region Weinberge
- **Issue:** [#146](https://github.com/henrysachs/voltonaut/issues/146) (Teil von [#145](https://github.com/henrysachs/voltonaut/issues/145)), Entscheidung [ADR-033](../decisions/ADR-033-connected-worlds.md) §6, §8
- **Vorgänger:** [E10-14](E10-14-voltonaut-world.md) (Welt `voltonaut`, Revision `1`), [E10-12](E10-12-world-heightfield.md), [E10-13](E10-13-world-recording-contract.md)
- **Status:** Implementiert und lokal softwaregeprüft; CI, Review und Hardware offen
- **Betroffene Module:** `packages/engine/src/elevation/data`, `packages/engine/src/world`, `apps/web/src/world`, `apps/web/e2e`, `apps/server/src/rides/replayRoute.ts`

## Ziel

Die Welt `voltonaut` bekommt eine Region Weinberge zwischen Wald und Küste. Ihr Weg „Weinberg-Intervalle“ besteht aus neun kurzen Rampen mit Abfahrten dazwischen und eignet sich für Intervalle. Die Tour fährt jetzt Wald → Weinberge → Küste → Nachtstadt → Wald. Die Welt erhält dafür die Revision `2`; Revision `1` bleibt unverändert und nachrechenbar.

## Abnahmekriterien

- [x] AK1 – **Weg als Daten.** `VINEYARD_INTERVALS` (`vineyard-intervals`, „Weinberg-Intervalle“, Szenerie `vineyard`) ist ein Rundweg von 12,39 km mit neun Rampen von 350–800 m bei 3,5–6,8 % (Entwurfswerte; gemessen im Profil mit der 3-%-Schwelle sind sie wegen der Ausrundungen bis 40 m kürzer, alle bleiben ≥ 300 m). Kuppen und Mulden sind mit 60 m langen Parabeln ausgerundet. Die Abfahrten dazwischen (rund 3,5 %) sind je mindestens 500 m lang. Die Mittellinie besteht aus Bögen (Krümmungsprüfung von `createWorld` bestanden), schließt exakt und hat am Rundenstrich keinen Höhensprung.
- [x] AK2 – **KOM-Segment.** Die zweite Rampe (700 m, 5 %) trägt das Segment `rebhang-kom` („Rebhang KOM“, Art `kom`) für KOM-Wertung und Rangliste (#62). Auf dem Heimweg liegt es ab der Eintrittsstelle der Region (HUD: „KOM · ab 6.7 km“). Auf der Tour trägt kein Segment.
- [x] AK3 – **Revision 2.** `VOLTONAUT_WORLD_REVISION_2` ordnet die Regionen Wald → Weinberge → Küste → Nachtstadt, mit Übergangsstraßen zu beiden Nachbarn. Wege: `voltonaut-tour` (32,1 km), `voltonaut-forest`, `voltonaut-vineyard`, `voltonaut-coast`, `voltonaut-night-city`. Die Küste liegt in Revision 2 weiter östlich (Versatz 7000/−2400), damit der Rundwegabstand von 1,8 km hält. Revision `1` bleibt Byte für Byte gleich (Prüfsumme `9a7770e2:128848`, Test unverändert); Revision `2` hat eine eigene Prüfsumme (`7bb98226:198112`). Die Übergangsstraßen von Revision `2` übernehmen die Steigung der Rundwege an ihren Enden (kubisch, `matchGrades`), statt waagerecht auszulaufen; ohne das unterschritt die Tour am Eintritt in die Weinberge den Abstandstest (2,9 cm). Revision `1` bleibt dabei unberührt (Opt-in je Welt).
- [x] AK4 – **Abstände.** Kein Abschnittspaar kommt sich außerhalb von 400 m um gemeinsame Knoten näher als 36 m (gemessen 41,1 m). Die Rundwege der Regionen liegen mindestens 1,8 km auseinander (gemessen 2095 m). Beides ist per Test abgesichert.
- [x] AK5 – **Neue Rides zeichnen Revision 2.** `worldPathOf` wählt unter mehreren Revisionen die neueste, `TEST_ROUTES` und die Render-Sicht ebenso. Aufnahmen von Revision `1` lösen weiter über `worldPathRoute` auf (Welt und Revision müssen genau passen).
- [x] AK6 – **Server rechnet nach.** Eine Sim-Fahrt auf `voltonaut-vineyard` mit `worldRevision: "2"` wird nachgerechnet (`replay.world.test.ts`); die Tour wird in Revision `1` und `2` nachgerechnet. Der Weg in Revision `1`, Revision `3` und unbekannte Wege bleiben `unknown_revision`.
- [x] AK7 – **Steigung und Länge folgen dem Raster.** Die Sim-Steigung (geglättetes Profil der Engine) liegt auf jeder Rampe bei dem Wert der Rampe (6 Stellen). Der Abstandstest aus E10-12 prüft jeden Weg der Revision 2 gegen das gezeichnete Raster der Welt (≥ 5 cm; gemessen: Tour 5,4 cm, Rundwege 6,0 cm). Das Raster entsteht aus den Straßenhöhen; die Rampen formen die Weinberg-Hänge, die Hügelwelle des Rasters (±8 m) kommt dazu.
- [x] AK8 – **Weinberg-Ausstattung.** Rebzeilen folgen den Höhenlinien des gezeichneten Rasters (Sehnen von 6 m, mittlere Steigung entlang der Sehne < 3 %) und sind **ein** instanziertes Mesh mit einer Box-Geometrie (bis 7000 Sehnen). Zypressen sind instanzierte Kegel, Steinhäuser instanzierte Boxen (Wand und Dach). Zusammen vier Draw Calls. Keine Rebzeile, Zypresse oder Hütte steht im Korridor irgendeines Abschnitts der Welt (Rebzeilen ≥ 10 m, Zypressen ≥ 9 m, Häuser ≥ 20 m von jeder Mittellinie), auch nicht an den Straßen anderer Regionen.
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
| AK8      | Unit        | `apps/web/src/world/vineyard-plan.test.ts`, `vineyardScenery.test.ts`                                                            |
| AK9      | Unit        | `apps/web/src/world/vineyardScenery.test.ts`                                                                                     |
| AK10     | Unit/E2E    | `routeCatalog.test.ts`, `routeSelection.test.ts`, `apps/web/e2e/routes.spec.ts`                                                  |
| AK11     | E2E         | `apps/web/e2e/routes.spec.ts`                                                                                                    |

## Nicht-Ziele und Grenzen

- **Atmosphäre je Region:** Wie in E10-14 hat die Tour **eine** Atmosphäre. Das warme Abendlicht gilt für die Fahrt auf dem Weg `voltonaut-vineyard`; die Tour startet mit dem Katalogwert der Tour (Mittag). Eine Überblendung je Region entfällt.
- Kein eigener See in den Weinbergen. Kein Segment auf der Tour.
- Hügel kommen aus den Straßenhöhen und der gemeinsamen Hügelwelle des Rasters, nicht aus einer eigenen Regionsfunktion. Eine regionsabhängige Geländeform braucht eine Rasteränderung für alle Welten (eigener Schritt).
- Die Revision `1` der Welt bleibt nachrechenbar, wird aber nicht mehr als Neufahrt angeboten.

## Offene Fragen / Risiken

- **Größe der Welt:** Revision 2 ist 32 km Tour; das Raster wächst mit der Straßenlänge (Startzeit, Dreiecke). Messwerte siehe unten. Größere Welten brauchen Streaming (#68).
- **Dreiecke am Tourstart:** Die Spitze liegt nahe am Budget von 500 k (Messwerte unten); weitere Regionen brauchen Entlastung.
- **Tour-Atmosphäre:** Henry entscheidet, ob die Überblendung je Region vor Schritt 5 folgt.

## Messungen (manuell, lokal, Sim, SwiftShader, `clock=fast`)

| Strecke                                                                    | Draw Calls (Spitze) | Dreiecke (Spitze) |
| -------------------------------------------------------------------------- | ------------------- | ----------------- |
| voltonaut-tour, Revision 2, ganze Fahrt bis 14,3 km (E2E `routes.spec.ts`) | 127                 | 471 k             |

Die Dreiecksspitze liegt bei 94 % des Budgets von 500 k. Die Startzeit bis zum ersten Frame wurde nicht gemessen.

## Nachweisstand

- **Implementiert:** ja.
- **Am tatsächlichen Artefakt softwaregeprüft:** lokal: Lint, Typen, depcruise, guard und 2422 Unit-Tests grün, Mutation 95,49 %, E2E 164/164 grün beim getrennten Lauf (`mise run test:e2e`, Tour durch die Region im Sim). Innerhalb von `mise run check` schlugen auf dieser Maschine drei Garage-/Szenentests beim Start fehl; dieselben drei Tests fehlen auch auf `origin/main` (a470bd1). CI offen.
- **An echter Hardware geprüft:** nein.
- **Bereitgestellt:** nein.

## Doku-Updates

- [x] Roadmap-Checkbox · [x] `docs/04-world-3d.md` · [x] `docs/01-architecture.md` · [x] Revisionsnote in E10-14 · [ ] ADR nicht nötig (ADR-033 §8 deckt neue Revision).
