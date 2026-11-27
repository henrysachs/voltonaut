# Spec E10-15 – Bodeninvariante und lichtfreie Ausstattung

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, Folgearbeit zu #138, #170 und #174
- **Status:** Review
- **Betroffene Module:** `apps/web/src/world`

## Ziel

Schwebende, versunkene oder im Wasser stehende Ausstattung und Lichter in der Regionsausstattung fallen vor dem Merge auf. Das Review zu #138 fand 16 von 88 schwebenden Kiefern und 5 Palmen in der Lagune. #174 zeigte, dass ein `AmbientLight` in der Ausstattung einer Region die ganze Szene beleuchtet.

## Abnahmekriterien

- [x] AK1 – `dressing-ground.test.ts` baut für jede Welt aus `WORLDS` die Ausstattung so wie das Landscape-System. Jede stehende Instanz wird gegen `heightAt` des gezeichneten Weltrasters geprüft. Keine Basisecke liegt mehr als ε = 0,05 m über dem Gelände. Das ist dieselbe Toleranz wie beim Fahrbahnabstand in `road-clearance.test.ts`. Das Gelände unter der Mitte liegt unter dem eigenen Höhenmittelpunkt. Keine Basisecke und keine Mitte steht in gezeichnetem See- oder Meerwasser.
- [x] AK2 – Ob ein Teil steht, getragen wird oder Wasser ist, bestimmt ein Typ (`Footing` in `dressing-group.ts`). Objektnamen spielen dafür keine Rolle. Ausgenommen sind nur Wasserflächen.
- [x] AK3 – `DressingGroup` nimmt nur `Mesh | Points | LineSegments` mit Footing sowie weitere `DressingGroup`s an. Ein `THREE.Light` in der Regionsausstattung ist ein Typfehler. Lichter kommen aus `biome-atmosphere.ts`. Das blaue Nachtlicht der Strecke `night-city` bleibt unverändert (Test in `landscape-system.test.ts`).
- [x] AK4 – Gefundene Verstöße auf `main` (a470bd1) sind in der Platzierung behoben. ε und Test bleiben unverändert.

## Testplan

| AK      | Ebene      | Datei                                                                        |
| ------- | ---------- | ---------------------------------------------------------------------------- |
| AK1–AK2 | Invariante | `apps/web/src/world/dressing-ground.test.ts`, `testdata/groundReport.ts`     |
| AK3     | Typ + Unit | `dressing-group.ts`, `landscape-system.test.ts`, `region-visibility.test.ts` |

## Nicht-Ziele

Atmosphäre je Region in verbundenen Welten (E10-14) und Gebäude in der Nachtstadt.

## Doku-Updates

- [x] `docs/04-world-3d.md` §12
