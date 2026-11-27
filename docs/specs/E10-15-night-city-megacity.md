# Spec E10-15 – Nachtstadt als Cyberpunk-Megacity

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, „Biome Küste, Alpenpass (Serpentinen), Nachtstadt (Neon)“; Issue #151
- **Status:** Review; Optik und ADR-035 am 2026-11-27 von Henry freigegeben
- **Betroffene Module:** `apps/web/src/world`, `apps/web/src/avatar`, `apps/web/e2e`

## Ziel

Die Nachtstadt sieht wie eine Stadt bei Nacht aus. Hohe Türme mit beleuchteten Fenstern bilden eine Straßenschlucht, Neon in Cyan, Magenta und Amber glüht, und Laternen hellen die Fahrbahn auf. Fahrer, Fahrbahn und HUD bleiben lesbar. Tagsüber steht dieselbe Stadt ohne Lichter da.

## Abnahmekriterien

- [x] AK1 – **Gebäude entlang der Strecke.** Zwei Reihen auf beiden Seiten. Die Straßenwand steht 13 bis 16 m neben der Mittellinie, die Skyline 44 bis 47 m. Die Türme ragen 22 bis 118 m über den Boden, deterministisch aus Seed 151. Jeder Turm steht mit seinem Fuß 0,5 m unter dem tiefsten Gelände seiner Grundfläche und erfüllt so den Bodentest aus #185 (`dressing-ground.test.ts`). Jede Gebäudemitte hält auf dem 10-m-Raster der Planung mindestens 20 m Abstand zu jedem Straßenabschnitt, exakt gemessen mehr als 19 m. Ein `InstancedMesh` je 250-m-Abschnitt.
- [x] AK2 – **Fenster als Emission.** Eine prozedurale `DataTexture` mit 16 × 16 Fenstern in Rahmen, davon etwa ein Drittel beleuchtet. Die UVs zählen in ganzen Fensterzellen, darum bleiben die Fenster unabhängig von der Turmhöhe gleich groß. Jeder Turm beginnt an einer eigenen Fensterzelle (Instanzposition im Vertex-Shader), so zeigen Nachbarn verschiedene Fassaden.
- [x] AK3 – **Neon mit Bloom.** Laternenköpfe, Schilder und senkrechte Röhren an den Fassaden teilen eine Instanzschicht. Ihre Farben kommen nur aus Cyan, Magenta und Amber. Jedes Element bekommt eine feste Leuchtdichte über der Bloom-Schwelle 1,05, damit alle drei Farben gleich glühen ([ADR-035](../decisions/ADR-035-night-bloom.md)).
- [x] AK4 – **Straßenlicht ohne Punktlichter.** Ein additives Band folgt dem Asphalt exakt und trägt das Laternenlicht als Vertexfarbe. Unter jeder Laterne gibt es einen Lichtfleck von 26 m Länge, auf der Laternenseite heller. Dazwischen bleibt es dunkel. Die Spitze bleibt deutlich unter der Bloom-Schwelle. Das Band kostet einen Draw Call.
- [x] AK5 – **Tag und Nacht unterscheidbar.** Fensterleuchten, Neon, Laternenlicht und Bloom folgen `nightAmount(env)`. Nur die Lichter der Nachtstadt reagieren, andere Biome bleiben unberührt. Das Umgebungslicht gehört seit #185 der Atmosphäre (`biome-atmosphere.ts`) und bleibt konstant.
- [x] AK6 – **Render-Budget im Sim-E2E gemessen.** `apps/web/e2e/night-city.spec.ts` fährt die Strecke nachts mit `clock=fast` und misst drei Cockpit-Ansichten, eine Tagesansicht und die Voltonaut-Tour nachts gegen das Katalogbudget (150 Draw Calls, 500 k Dreiecke).
- [x] AK7 – **Kein weißer Fleck am Fahrer.** Jeder gezeichnete Eckpunkt von Rad und Fahrer hat eine Einheitsnormale.
- [x] AK8 – **Keine neuen Abhängigkeiten und keine Assets.** Alles ist prozedural. Die Postprocessing-Addons gehören zu `three`.
- [x] AK9 – **Henry gibt die Optik frei**, anhand der Screenshots unter `docs/specs/E10-15/` (Chat, 2026-11-27).
- [ ] AK10 – **Hardwareabnahme** des Render-Budgets und des Bloom-Speichers (#86).

## Testplan

| AK  | Ebene     | Datei                                                                                    |
| --- | --------- | ---------------------------------------------------------------------------------------- |
| AK1 | Unit      | `apps/web/src/world/nightCityBuildings.test.ts` (Determinismus, Höhen, Abstand auf 1 m)  |
| AK3 | Unit      | `nightCityBuildings.test.ts` (Röhrenfarben), `nightCityLights.test.ts` (Neon > Schwelle) |
| AK4 | Unit      | `nightCityLights.test.ts` (hell unter der Laterne, dunkel 20 m weiter, < halbe Schwelle) |
| AK5 | Unit      | `nightCityBuildings.test.ts` (Tag dimmt, Küste unberührt), `bloom.test.ts`               |
| AK6 | Sim-E2E   | `apps/web/e2e/night-city.spec.ts`, Screenshots als Artefakte                             |
| AK7 | Unit      | `apps/web/src/avatar/bikeMesh.test.ts`                                                   |
| –   | Bestehend | `dressing-ground.test.ts` (Türme, Masten), `biomeScenery.test.ts`, `routes.spec.ts`      |

## Messwerte

Headless Chromium lokal auf macOS, nachher drei Läufe mit höchstens 2 Draw Calls Abweichung je Ansicht, `?sim=1&debug=1&clock=fast&route=night-city`. Die Aufnahmepunkte sind Mindestdistanzen, die tatsächliche Distanz steht im HUD und in der Test-Annotation.

| Ansicht               | Vorher (`main` 1c119ed) | Nachher         |
| --------------------- | ----------------------- | --------------- |
| Nacht, Start          | 53 Calls / 126 k Tris   | 64 Calls / 95 k |
| Nacht, Neon-Sprint    | 76 / 164 k              | 91 / 172 k      |
| Nacht, Gegenseite     | 57 / 110 k              | 73 / 115 k      |
| Tag, 12:00            | 76 / 162 k              | 80 / 168 k      |
| Voltonaut-Tour, 21:00 | 87 / 284 k              | 97 / 282 k      |

Nachts enthalten die Werte die etwa 14 Vollbild-Passes von Bloom. Die Ansichten liegen vorher und nachher nicht an exakt derselben Stelle. Der Unterschied je Ansicht ist deshalb kein sauberer Vergleich, nur die Größenordnung.

## Screenshots

Vorher (`main` a470bd1, vor #185) und nachher aus derselben Spec, Verfolgerkamera mit HUD, 1280 × 720:

- `docs/specs/E10-15/before/night-1.png` bis `night-3.png` und `day.png`
- `docs/specs/E10-15/after/night-1.png` bis `night-3.png`, `day.png` und `tour-night.png`

## Nicht-Ziele

- Nasse Fahrbahn mit Spiegelungen (#72).
- Atmosphäre je Region in der Voltonaut-Tour (E10-14, Folgeschritt). In Welten mit mehreren Regionen trägt `worldAtmosphere` das Umgebungslicht der Nachtstadt weiterhin nicht.
- Umschaltbare Qualitätsstufen. Die Szene läuft fest auf Medium. Low schaltet Bloom ab, ist aber noch nicht wählbar.

## Offene Fragen / Risiken

- **Low und High:** Ohne wählbare Stufe ist „auf Low und High klar erkennbar“ nicht prüfbar. Geprüft ist nur Medium.
- **Bloom-Speicher:** Bei 2× MSAA gerechnet 57 MB (720p bei Pixel-Ratio 1,25) bis 127 MB (1080p bei Pixel-Ratio 1,25), nicht gemessen (ADR-035).
- **Fassaden-Shader:** Fensterversatz und Stockwerke je Turm sind ein `onBeforeCompile`-Eingriff in den Vertex-Shader von `MeshStandardMaterial`. Ein three-Update kann den Einhängepunkt `#include <uv_vertex>` verschieben. Dann zeigen alle Türme dieselbe Fassade, gestreckt auf ihre Höhe.
- **Fensterstreckung:** Die Straßenfront skaliert je Turm um 0,85 bis 1,3. Die Fenster werden dabei entsprechend breiter.

## Nachweisstand

- **Implementiert:** ja.
- **Am tatsächlichen Artefakt softwaregeprüft:** ja, Screenshots unter `docs/specs/E10-15/`. CI war für Head `57a6e6f` grün: 2390 Unit-Tests und 164 E2E-Tests. Der Stand nach dem Rebase auf #185 und #186 braucht einen neuen CI-Lauf.
- **An echter Hardware geprüft:** nein (#86).
- **Bereitgestellt:** nein.

## Doku-Updates

- [x] `docs/04-world-3d.md` §2 und §11 · [x] Roadmap · [x] ADR-035
