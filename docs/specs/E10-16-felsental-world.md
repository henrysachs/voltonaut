# Spec E10-16 – Steinzeit-Welt Felsental

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, Checkbox „Themenwelten (#159)“, erster Teil
- **Status:** Implementiert und auf `main` `1c119ed` (#185, #186) rebased. AK1–AK8 sind durch Tests und Sim-Messläufe belegt, siehe [Nachweise](#nachweise). Softwaregeprüft erst mit grüner CI am PR-Head. An echter Hardware nicht geprüft, nicht bereitgestellt. Henrys Optikfreigabe offen.
- **Betroffene Module:** `packages/engine/src/world/data`, `apps/web/src/world`, `apps/web/e2e`, `apps/server/src/rides`, `docs/04-world-3d.md`, `docs/07-roadmap.md`

## Ziel

Issue [#159](https://github.com/henrysachs/voltonaut/issues/159) wünscht mehrere originale Themenwelten. Dieser erste Teil liefert die Steinzeit-Welt **Felsental**. Der Fahrer wählt sie im Tab **Strecke** und fährt eine Talrunde mit Felsenhäusern, Dino-Statuen und glühenden Vulkanen am Horizont. Der Server rechnet die Fahrt nach.

## Aufteilung von #159

Nach [ADR-033](../decisions/ADR-033-connected-worlds.md) §1 sind mehrere Welten erlaubt. Fantasiewelten passen nicht als Region in die realistische Welt `voltonaut`. Sie werden deshalb eigene Welten, wie Synthwave in #147. Eine ADR-Änderung ist dafür nicht nötig.

| Teil aus #159                          | Umsetzung                                                                                                 | Ort        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| Neon-Megacity                          | Die Nachtstadt aus #138 wird zur Cyberpunk-Megacity. Eine zweite Neonstadt wäre ein paralleles Subsystem. | #151       |
| Steinzeit-Welt                         | Welt `felsental`                                                                                          | diese Spec |
| Dark-Fantasy-Landschaft                | eigene Welt, nutzt das vorhandene Wetter `fog` und `storm`                                                | #179       |
| Wüstenplanet                           | eigene Welt. Sandsturm und zwei Monde erweitern das Umweltsystem.                                         | #180       |
| Steinzeit-Rad, optional Steinzeit-Auto | Rahmen und Laufräder im Garage-Katalog (`packages/rules`)                                                 | #181       |

Namen, Figuren, Orte und Musik der Vorbilder kommen nicht vor. Alle Objekte sind prozedural. Es gibt keine neuen Assets und keine neuen Abhängigkeiten.

## Abnahmekriterien

- [x] AK1 – `packages/engine` enthält die Welt `felsental` mit Revision `1`: eine Region mit Szenerie `stone-age`, ein Knoten, ein Rundweg `felsental` von etwa 9 km. Die Welt ist ein natives Netz ohne `legacyRoute`. `createWorld` prüft also Höhenstetigkeit und Krümmung.
- [x] AK2 – Das Profil hat ein flaches Tal und einen Anstieg „Steinbruch“ von etwa 2 km mit 4–8 % Steigung (Mittel um 5 %). Der Anstieg ist ein `kom`-Segment. Danach folgt eine Abfahrt, und das Profil schließt ohne Sprung.
- [x] AK3 – Der Tab **Strecke** zeigt die Karte „Felsental“ mit Vorschau. Die Auswahl setzt `route=felsental`. Die Sim-Fahrt startet, und neue Aufnahmen speichern `worldId: "felsental"`, `worldRevision: "1"` und `pathId: "felsental"`.
- [x] AK4 – Die Szenerie zeigt Felsenhäuser, Farne oder Palmen, Dino-Statuen und mindestens zwei Vulkane mit glühendem Krater (gebaut sind vier). Sie entsteht deterministisch aus einem Seed. Jedes Objekt hält mit seinem Radius mindestens 7 m Abstand zur Straßenmittellinie, wie Pflanzen (`PLANT_ROAD_CLEARANCE_M`). Die Ausstattung besteht die Bodeninvariante aus [E10-15](E10-15-dressing-ground.md): nichts schwebt, versinkt über die eigene Mitte oder bringt Licht mit.
- [x] AK5 – Der Abstandstest aus E10-12 deckt `felsental` ab. Kein Geländepunkt liegt über der Fahrbahn.
- [x] AK6 – Über die ganze Runde bleiben Draw Calls ≤ 150 und Dreiecke ≤ 500 k, im Sim-E2E gemessen.
- [x] AK7 – Der Server rechnet eine Sim-Fahrt auf `felsental` mit `replayRevision: "world-path-1"` nach. Eine Altreferenz `routeId: "felsental"` mit `routeRevision: "1"` lehnt er ab, weil es für diese Welt keine Aufnahmen vor ADR-033 gibt.
- [x] AK8 – Bestehende Strecken, Aufnahmen, Golden-Dateien und Screenshot-Baselines bleiben unverändert.
- [ ] AK9 – Drei Screenshots im Sim-Modus (Verfolgerkamera im Dorf, am Anstieg und mit Blick auf die Vulkane) liegen unter `docs/specs/E10-16/`. Sie sind Nachweise, keine Baselines. Henry gibt die Optik frei.
- [ ] AK10 – `mise run check` und `mise run check:mutation` sind grün.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene            | Datei                                                                                                                                                    |
| -------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AK1, AK2 | Unit             | `packages/engine/src/world/data/felsental.test.ts`                                                                                                       |
| AK3      | Unit, E2E        | `apps/web/src/world/routeCatalog.test.ts`, `apps/web/src/routeSelection.test.ts`, `apps/web/e2e/routes.spec.ts`                                          |
| AK4      | Unit, Invariante | `apps/web/src/world/stoneAgeScenery.test.ts`, `apps/web/src/world/dressing-ground.test.ts` (läuft für jede Welt aus `WORLDS`)                            |
| AK5      | Unit             | `apps/web/src/world/road-clearance.test.ts`                                                                                                              |
| AK6      | E2E, manuell     | erster Frame: Budget-Test je Katalogstrecke in `apps/web/e2e/routes.spec.ts`; ganze Runde: manuelle Playwright-Messfahrt mit `clock=fast`, nicht im Repo |
| AK7      | Integration      | `apps/server/src/rides/replay.world.test.ts`                                                                                                             |
| AK8      | Golden, Gate     | bestehende Golden- und Replay-Tests, `mise run guard`                                                                                                    |
| AK9      | manuell          | Screenshots unter `docs/specs/E10-16/`                                                                                                                   |
| AK10     | Gate             | `mise run check`, `mise run check:mutation`                                                                                                              |

## Nicht-Ziele

- Kein Kies-Untergrund als Rollwiderstand. Er ändert die Widerstandsbefehle an den Trainer und braucht nach `AGENTS.md` §3.9 eine eigene Entscheidung.
- Keine eigene Fahrbahnoberfläche. PR #174 baut `road.ts` gerade um.
- Keine Rauchpartikel am Vulkan, kein Steinzeit-Rad, kein Steinzeit-Auto und keine weiteren Welten aus #159.
- Keine Region in der Welt `voltonaut` und kein Abbiegen.

## Offene Fragen / Risiken

- Welt-ID und Weg-ID sind beide `felsental`. `selectRouteFromUrl` findet die Welt-Referenz über `worldPathOf` aus #174.
- #174 ist gemergt. Felsental steht in `WORLDS` hinter `VOLTONAUT`. `TEST_WORLDS` enthält weiter nur die Welten aus einer Strecke und liegt jetzt in `packages/engine/src/world/data/singleRouteWorlds.ts`. Sonst meldet Oxlint (`import/max-dependencies`) für `index.ts` elf statt höchstens zehn Abhängigkeiten.
- Die Spec hieß zuerst E10-15. Die Nummer ging mit #185 an die Bodeninvariante, deshalb E10-16. #183 (Nachtstadt) und #178 (Weinberge) tragen ebenfalls E10-15 und müssen beim Rebase neu nummerieren.
- Für die Bodeninvariante aus #185 stehen alle Teile über `settledHeightAt` auf dem gezeichneten Raster. Häuser, Statuen und Farne meiden Stellen, an denen das Gelände unter ihnen zu stark steigt; Häuser und Statuen versuchen bis zu vier geseedete Plätze. Gegenüber dem Stand vor #185 stehen 31 statt 34 Häuser, 13 statt 14 Statuen und 3114 statt 3456 Farne. Farnwedel stehen steiler (0,7 statt 1,05 rad), sonst läge ihre Mitte am Hang unter dem Gelände. Der Eingangstunnel gilt als vom Dom getragen; sein Boden liegt an der Mündung auf dem Gelände, bergseitig läuft er in den Hang.
- Die Platzwahl prüft jede Kandidatenstelle gegen alle Straßenproben im 2-m-Raster. Ein Aufbau der ganzen Steinzeit-Ausstattung dauert lokal rund 80 ms (Node, warm, unter Last gemessen). Pflanzen nutzen feste 500-m-Abschnitte statt `plan.stretchesM`. Beides ist bewusst einfach gehalten und wird erst bei Bedarf optimiert.
- Der Anstieg heißt „Steinbruch“, zeigt aber noch keine Steinbruchwände. Das gehört zur Optikfreigabe durch Henry.
- Die Optik gibt Henry anhand der Screenshots frei. Das Render-Budget auf echter Hardware bleibt bei #86.

## Nachweise

Stand 27.11.2026, Branch `feat/issue-159-felsental` auf `main` `1c119ed` (#185, #186) rebased. Lokal gemessen headless mit Chromium und SwiftShader auf macOS, Sim-Modus.

| Prüfung                                                        | Ergebnis                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub-CI am vorigen Head `5bd7478` (vor #185)                 | `check` mit E2E, `mutation`, `cloudflare-pages` grün                                                                                                                                                                                 |
| `fmt:check`, `lint`, `typecheck`, `depcruise`, `guard` (lokal) | grün                                                                                                                                                                                                                                 |
| `mise run test` (lokal, Vitest mit Coverage-Schwellen)         | 342 Dateien, 2463 Tests grün, darunter `dressing-ground.test.ts` für `felsental`                                                                                                                                                     |
| `mise run test:e2e` (lokal)                                    | 161 von 163 grün. Rot sind nur zwei Garage-Tests in `garage-loadout.spec.ts` (Look kommt nicht innerhalb von 5 s in den Render-Diagnosen an). Sie sind auf `main` lokal genauso rot, in der GitHub-CI grün. Kein Bezug zu Felsental. |
| `mise run check:mutation` (lokal, vor #185)                    | grün: Score 95,26 % (Schwelle 80 %), `felsental.ts` 95,71 %. Überlebt haben nur Mutanten an zwei Schutz-`throw`s.                                                                                                                    |
| AK6 erster Frame                                               | 84 Draw Calls, 181 k Dreiecke                                                                                                                                                                                                        |
| AK6 ganze Runde (Messfahrt mit `clock=fast`, 603 Proben)       | Spitze 122 Draw Calls bei 2,3 km (Steinbruch), 278 k Dreiecke bei 5,4 km                                                                                                                                                             |
| AK9 Screenshots                                                | `E10-16/dorf.png` (0,03 km), `E10-16/steinbruch.png` (2,06 km), `E10-16/vulkane.png` (3,62 km), nach der Bodeninvariante neu aufgenommen                                                                                             |

Zwei Fehlaufnahmen sind kein Weltbeleg und liegen nicht im Repo, sondern lokal unter `/tmp/v159-shots/`: eine vor dem Laden der 3D-Welt (schwarz) und eine vor dem Laden des Fahrers.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Roadmap-Checkbox · [x] `docs/04-world-3d.md` · [x] ADR nicht nötig (ADR-033 §1)
