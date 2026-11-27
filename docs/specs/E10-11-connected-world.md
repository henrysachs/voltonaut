# Spec E10-11 – Zusammenhängende Welt, Schritt 1: Datentypen

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, „Zusammenhängende Welt: Straßennetz, Höhenraster, Biome als Regionen“
- **Issue:** [#150](https://github.com/henrysachs/voltonaut/issues/150), Entscheidung [ADR-033](../decisions/ADR-033-connected-worlds.md) (angenommen am 2026-11-27)
- **Status:** Schritt 1 implementiert und lokal softwaregeprüft; CI und Review offen; Schritte 2–5 offen
- **Betroffene Module:** `packages/engine` (Schritt 1); später `apps/web/src/world`, `packages/shared`, `apps/server/src/rides`

## Ziel

ADR-033 Schritt 1: Datentypen `World`, Abschnitt, Knoten, Weg und Region in `packages/engine`, mit Tests für Höhenstetigkeit an Knoten und Krümmungsgrenze je Sehne. Die bestehenden Strecken werden je eine Welt mit einem Weg, bit-identisch (Golden).

## Abnahmekriterien Schritt 1

- [x] AK1 – `createWorld(WorldData)` prüft das Netz: eindeutige Regions-, Knoten-, Abschnitts- und Weg-IDs; nicht leere Revision; bekannte Region und bekannte Knoten je Abschnitt; ≥ 2 Mittellinienpunkte und Höhenstützstellen; Länge positiv und endlich; Bogenlänge der Mittellinie = `lengthM` ± 1e-6 m; Profil von exakt 0 bis `lengthM`.
- [x] AK2 – **Höhenstetigkeit an Knoten** (ADR-033 §2): Mittellinienenden liegen bitgenau auf ihrem Knoten, Profilenden auf 1e-6 m an der Knotenhöhe. Damit stimmt die Höhe an einem Knoten für alle anschließenden Abschnitte überein.
- [x] AK3 – **Krümmungsgrenze je Sehne** (ADR-033 §2, „Bögen, keine Knicke“): An keinem Punkt dreht die Mittellinie um mehr als `min(0,2 rad, kürzere Nachbarsehne / 10 m)`. Sehnen der Länge 0 sind verboten. Geprüft innerhalb jedes Abschnitts, an jedem Knoten eines Wegs und an der Naht eines Rundwegs.
- [x] AK4 – Ein Weg setzt Abschnitte vorwärts und rückwärts zu einer `RouteData` zusammen. Gemeinsame Knotenpunkte erscheinen einmal, Rückwärtsabschnitte spiegeln ihre Distanzen. Leere, unbekannte, unterbrochene Wege und nicht schließende Rundwege werden abgewiesen.
- [x] AK5 – Jeder Abschnitt kennt seine Region (ADR-033 §2, §6). Die `scenery` einer Route ist das Biom der Region ihres ersten Abschnitts. Segmente sind Distanzen entlang des ganzen Wegs und dürfen über Knoten hinweg laufen (ADR-033 „Folgen“: „Wie Segmente über mehrere Abschnitte laufen, klärt Schritt 1“).
- [x] AK6 – `flat-loop`, `test-loop` und `kom-climb` sind je eine Welt mit einer Region, einem Abschnitt und einem Weg. Welt-, Weg- und Regions-ID entsprechen der bisherigen `routeId`, die Revision der bisherigen `routeRevision` `"1"` (ADR-033 §8: die bisherige Revision bleibt als Einzelstrecke nachrechenbar). Die abgeleitete Route ist feldweise gleich der bisherigen; `worldPos`, `headingRad` und `gradeAt` liefern an jeder Probestelle dieselben Zahlen.
- [x] AK7 – `TEST_ROUTES` wird aus den Welten abgeleitet. Alle vier Golden-Fahrten unter `fixtures/rides/` bleiben grün; Golden-Dateien wurden nicht angefasst.
- [x] AK8 – Kein Laufzeitvertrag ändert sich: Engine-Worker, Render-Worker, Aufnahmen und Server-Nachrechnung verwenden weiter `routeId`/`routeRevision`.

## Abnahme gesamt (aus #150)

- [x] ADR-033 von Henry freigegeben (2026-11-27).
- [ ] Eine Fahrt führt ohne Unterbrechung durch mindestens zwei Regionen.
- [ ] Kein Gelände über der Fahrbahn, automatisch für jede Route geprüft.
- [ ] Bestehende Aufnahmen und Bestzeiten bleiben lesbar.
- [ ] Server rechnet Fahrten in der Welt nach.
- [ ] Render-Budget je Region auf echter Hardware geprüft (#86).

## Testplan (`docs/10-testing.md`)

| AK       | Ebene       | Datei / Fixture                                                                 |
| -------- | ----------- | ------------------------------------------------------------------------------- |
| AK1, AK2 | Unit        | `packages/engine/src/world/edges.test.ts`, `world.test.ts`                      |
| AK3      | Unit        | `packages/engine/src/world/curvature.test.ts`, `edges.test.ts`, `world.test.ts` |
| AK4, AK5 | Unit        | `packages/engine/src/world/world.test.ts`                                       |
| AK6      | Unit        | `packages/engine/src/world/singleRouteWorld.test.ts`                            |
| AK7      | Golden      | `apps/web/src/golden/golden.test.ts`, `fixtures/rides/*.golden.json`            |
| AK8      | Unit/Replay | bestehende Suites in `apps/web/src/game`, `apps/server/src/rides`               |
| alle     | Mutation    | `mise run check:mutation` (Stryker über `packages/engine/src/**`)               |

## Nicht-Ziele (Schritt 1)

- Kein Höhenraster, keine Regionsflächen, Übergangszonen oder Atmosphäre, keine Welt `voltonaut`.
- Keine Änderung an Aufnahme-, Journal- oder API-Schemas; der Tick bekommt weiter eine Route.
- Keine Änderung an Rendering oder Oberfläche.

## Offene Fragen / Risiken

- **Grenzwerte der Krümmung:** 0,2 rad je Punkt und 10 m Mindestradius sind ein Vorschlag. ADR-033 nennt keine Zahl. Henry bestätigt oder legt andere Werte fest.
- **Alpenpass aus PR #138 hat Knicke:** Geprüft gegen den Stand `3fdfe7d` von `feat/issue-75-biomes`. `alpine-pass` dreht an jeder Kehre um 90° (erster Knick an Punkt 150) und würde unter AK3 abgewiesen. Vor Schritt 3 müssen die Kehren als Bögen mit kurzen Sehnen vorliegen. `coast-loop` (größte Drehung 0,080 rad, kürzeste Sehne 12,5 m) und `night-city` (0,073 rad, 12,5 m) halten die Grenze ein.
- **Mittellinie als Sehnen:** Bögen liegen als Polylinie vor, die AK3 einhält. Analytische Bögen würden `worldPos`/`headingRad` und damit die Golden-Fahrten ändern.
- **Region nur als Biom:** Die Fläche einer Region, ihre Atmosphäre und ihr Render-Budget folgen in Schritt 3 (`apps/web/src/world`, ADR-033 §9).
- **Revision je Welt:** Wie alte Weltrevisionen für die Server-Nachrechnung abgelegt werden, klärt Schritt 4 ([E10-13](E10-13-world-recording-contract.md)): Der Server hält eine Freigabeliste nachrechenbarer Weltrevisionen.

## Nachweisstand

- **Implementiert:** Schritt 1.
- **Am tatsächlichen Artefakt softwaregeprüft:** lokal Format, Lint, Typecheck, depcruise, guard, Unit-, Golden- und Replay-Tests, gezielte Mutation der neuen Dateien. CI steht aus.
- **An echter Hardware geprüft:** nein (Schritt 1 hat keinen Hardwarepfad).
- **Bereitgestellt:** nein.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Roadmap-Eintrag · [x] `docs/01-architecture.md` · [x] ADR-033 Freigabe (Henry, 2026-11-27)
