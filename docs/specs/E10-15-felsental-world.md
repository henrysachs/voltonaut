# Spec E10-15 – Steinzeit-Welt Felsental

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, Checkbox „Themenwelten (#159)“, erster Teil
- **Status:** In Arbeit
- **Betroffene Module:** `packages/engine/src/world/data`, `apps/web/src/world`, `apps/web/e2e`, `apps/server/src/rides`, `docs/04-world-3d.md`, `docs/07-roadmap.md`

## Ziel

Issue [#159](https://github.com/henrysachs/voltonaut/issues/159) wünscht mehrere originale Themenwelten. Dieser erste Teil liefert die Steinzeit-Welt **Felsental**. Der Fahrer wählt sie im Tab **Strecke** und fährt eine Talrunde mit Felsenhäusern, Dino-Statuen und glühenden Vulkanen am Horizont. Der Server rechnet die Fahrt nach.

## Aufteilung von #159

Nach [ADR-033](../decisions/ADR-033-connected-worlds.md) §1 sind mehrere Welten erlaubt. Fantasiewelten passen nicht als Region in die realistische Welt `voltonaut`. Sie werden deshalb eigene Welten, wie Synthwave in #147. Eine ADR-Änderung ist dafür nicht nötig.

| Teil aus #159                          | Umsetzung                                                                                                 | Ort           |
|----------------------------------------|-----------------------------------------------------------------------------------------------------------|---------------|
| Neon-Megacity                          | Die Nachtstadt aus #138 wird zur Cyberpunk-Megacity. Eine zweite Neonstadt wäre ein paralleles Subsystem. | #151          |
| Steinzeit-Welt                         | Welt `felsental`                                                                                          | diese Spec    |
| Dark-Fantasy-Landschaft                | eigene Welt, nutzt das vorhandene Wetter `fog` und `storm`                                                | eigenes Issue |
| Wüstenplanet                           | eigene Welt. Sandsturm und zwei Monde erweitern das Umweltsystem.                                         | eigenes Issue |
| Steinzeit-Rad, optional Steinzeit-Auto | Rahmen und Laufräder im Garage-Katalog (`packages/rules`)                                                 | eigenes Issue |

Namen, Figuren, Orte und Musik der Vorbilder kommen nicht vor. Alle Objekte sind prozedural. Es gibt keine neuen Assets und keine neuen Abhängigkeiten.

## Abnahmekriterien

- [ ] AK1 – `packages/engine` enthält die Welt `felsental` mit Revision `1`: eine Region mit Szenerie `stone-age`, ein Knoten, ein Rundweg `felsental` von etwa 9 km. Die Welt ist ein natives Netz ohne `legacyRoute`. `createWorld` prüft also Höhenstetigkeit und Krümmung.
- [ ] AK2 – Das Profil hat ein flaches Tal und einen Anstieg „Steinbruch“ von etwa 2 km mit 4–8 % Steigung (Mittel um 5 %). Der Anstieg ist ein `kom`-Segment. Danach folgt eine Abfahrt, und das Profil schließt ohne Sprung.
- [ ] AK3 – Der Tab **Strecke** zeigt die Karte „Felsental“ mit Vorschau. Die Auswahl setzt `route=felsental`. Die Sim-Fahrt startet, und neue Aufnahmen speichern `worldId: "felsental"`, `worldRevision: "1"` und `pathId: "felsental"`.
- [ ] AK4 – Die Szenerie zeigt Felsenhäuser, Farne oder Palmen, Dino-Statuen und mindestens zwei Vulkane mit glühendem Krater. Sie entsteht deterministisch aus einem Seed. Jedes Objekt hält mit seinem Radius mindestens 7 m Abstand zur Straßenmittellinie, wie Pflanzen (`PLANT_ROAD_CLEARANCE_M`).
- [ ] AK5 – Der Abstandstest aus E10-12 deckt `felsental` ab. Kein Geländepunkt liegt über der Fahrbahn.
- [ ] AK6 – Über die ganze Runde bleiben Draw Calls ≤ 150 und Dreiecke ≤ 500 k, im Sim-E2E gemessen.
- [ ] AK7 – Der Server rechnet eine Sim-Fahrt auf `felsental` mit `replayRevision: "world-path-1"` nach. Eine Altreferenz `routeId: "felsental"` mit `routeRevision: "1"` lehnt er ab, weil es für diese Welt keine Aufnahmen vor ADR-033 gibt.
- [ ] AK8 – Bestehende Strecken, Aufnahmen, Golden-Dateien und Screenshot-Baselines bleiben unverändert.
- [ ] AK9 – Drei Screenshots im Sim-Modus (Verfolgerkamera im Dorf, am Anstieg und mit Blick auf die Vulkane) liegen unter `docs/specs/E10-15/`. Sie sind Nachweise, keine Baselines. Henry gibt die Optik frei.
- [ ] AK10 – `mise run check` und `mise run check:mutation` sind grün.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene        | Datei                                                                    |
|----------|--------------|--------------------------------------------------------------------------|
| AK1, AK2 | Unit         | `packages/engine/src/world/data/felsental.test.ts`                       |
| AK3      | Unit, E2E    | `apps/web/src/world/routeCatalog.test.ts`, `apps/web/e2e/routes.spec.ts` |
| AK4      | Unit         | `apps/web/src/world/biomeScenery.test.ts`                                |
| AK5      | Unit         | `apps/web/src/world/road-clearance.test.ts`                              |
| AK6      | E2E          | Budget-Test je Katalogstrecke in `apps/web/e2e/routes.spec.ts`           |
| AK7      | Integration  | `apps/server/src/rides/replay.world.test.ts`                             |
| AK8      | Golden, Gate | bestehende Golden- und Replay-Tests, `mise run guard`                    |
| AK9      | manuell      | Screenshots unter `docs/specs/E10-15/`                                   |
| AK10     | Gate         | `mise run check`, `mise run check:mutation`                              |

## Nicht-Ziele

- Kein Kies-Untergrund als Rollwiderstand. Er ändert die Widerstandsbefehle an den Trainer und braucht nach `AGENTS.md` §3.9 eine eigene Entscheidung.
- Keine eigene Fahrbahnoberfläche. PR #174 baut `road.ts` gerade um.
- Keine Rauchpartikel am Vulkan, kein Steinzeit-Rad, kein Steinzeit-Auto und keine weiteren Welten aus #159.
- Keine Region in der Welt `voltonaut` und kein Abbiegen.

## Offene Fragen / Risiken

- Welt-ID und Weg-ID sind beide `felsental`. Bis #174 `worldPathOf` einführt, leitet `apps/web/src/main.ts` die Welt-Referenz aus der Routen-ID ab.
- PR #174 ändert dieselben Register. Konflikte entstehen in `packages/engine/src/world/data/index.ts`, `apps/server/src/rides/replayRoute.ts`, `apps/web/src/world/landscape.ts`, `apps/web/src/world/routeCatalog.ts` und `apps/web/e2e/routes.spec.ts`. Wer später mergt, rebased.
- ADR-033 ist noch nicht von Henry freigegeben.
- Die Optik gibt Henry anhand der Screenshots frei. Das Render-Budget auf echter Hardware bleibt bei #86.

## Doku-Updates (Pflicht beim Abschluss)

- [ ] Roadmap-Checkbox · [ ] `docs/04-world-3d.md` · [ ] ADR nicht nötig (ADR-033 §1)
