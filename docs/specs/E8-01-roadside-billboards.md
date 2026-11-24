# Spec E8-01 – Werbe-Billboards am Streckenrand

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E8, Checkbox „Roadside life"
- **Issue:** #42
- **Status:** Review
- **Betroffene Module:** `apps/web/src/world`

## Ziel

Entlang der Strecke stehen Billboards. Sie machen die Welt lebendiger und können später ein Sponsor-Motiv tragen. Bis Kongstrong Motivdatei und Nutzungsfreigabe liefert, zeigen sie ein eigenes, prozedural gemaltes Platzhaltermotiv (Voltonaut-Blitz). Das echte Motiv ersetzt später nur die Textur.

## Abnahmekriterien

- [x] AK1 – Billboards erscheinen in der Sim-Welt als Teil des Landschaftssystems (`createLandscapeSystem`). Je ein Paar steht 20 m nach Start und Ziel, 25 m vor jedem Segmentbeginn und 25 m nach jedem Segmentende. Dazu kommt alle 500 m ein Billboard, abwechselnd links und rechts, mit mindestens 80 m Abstand zu den Paaren.
- [x] AK2 – Die Platzierung ist deterministisch: gleiche Route, gleiche Positionen.
- [x] AK3 – Kein Billboard steht auf der Fahrbahn oder dem Bankett: Jede Tafelkante hält mehr als 6 m zur Mittellinie. Kilometerschilder werden nicht berührt (mehr als 3 m Abstand; ein linkes Billboard weicht 12 m entgegen der Fahrtrichtung aus). Billboards stehen nicht im See. Liegt eine Paar-Seite im See, entfällt dort nur diese Seite.
- [x] AK4 – Alle Billboards zusammen brauchen 2 instanzierte Meshes: Gestell (3 Teile je Billboard) und Motivflächen.
- [x] AK5 – Die Textur ist 512 × 256 px, also unter dem Budget von 2048 px, und wird mit ihrem Material freigegeben.
- [ ] AK6 – Kongstrong-Motiv mit Nutzungsrecht in `apps/web/public/assets/LICENSES.md`, über `mise run assets` als KTX2. **Offen:** Motivdatei und Freigabe fehlen.
- [ ] AK7 – Performance-Budget-Szene bleibt grün. Die bestehende Draw-Call-Grenze (≤ 150) im E2E ist geprüft, eine Messung auf Henrys Laptop steht aus.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene | Datei                                              |
| -------- | ----- | -------------------------------------------------- |
| AK1–AK5  | Unit  | `apps/web/src/world/billboards.test.ts`            |
| AK1, AK7 | E2E   | bestehende Szenen-Specs (`apps/web/e2e/*.spec.ts`) |

## Nicht-Ziele

Kein dynamisches Ad-Serving, kein Tracking, keine Server-Anbindung, keine Klick-Interaktion. Kein Branding der Segment-Torbögen.

## Offene Fragen / Risiken

- Wer liefert Kongstrongs Motiv und Nutzungsfreigabe, in welchem Format?
- Wechselnde Motive gewünscht? Heute zeigt jedes Billboard dasselbe Motiv.
- Die Tafelhöhe folgt dem Geländeverlauf an der Tafelmitte. Pfosten reichen 1 m in den Boden, damit sie bei Unebenheiten nicht schweben.

## Doku-Updates

- [x] Roadmap-Unterpunkt · [x] Spec · [ ] `LICENSES.md` (mit echtem Motiv)
