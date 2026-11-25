# Spec E8-02 – Werbe-Billboards am Streckenrand

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E8, Checkbox „Roadside life"
- **Issue:** #42
- **Status:** Review-Befunde aus #89 umgesetzt; softwaregeprüft im Sim-Modus; Hardware und Bereitstellung offen
- **Betroffene Module:** `apps/web/src/world`

## Ziel

Entlang der Strecke stehen Billboards. Sie machen die Welt lebendiger und können später ein Sponsor-Motiv tragen. Bis Kongstrong Motivdatei und Nutzungsfreigabe liefert, zeigen sie drei eigene, prozedural gemalte Platzhaltermotive. Das echte Motiv ersetzt später nur die Textur.

Henrys Entscheidungen vom 24.11.2026 (Plan-Kommentar in #42): 3 Billboards pro Kilometer, zunächst nur Platzhaltermotive, jedes Billboard zeigt das nächste Motiv der Reihe.

## Abnahmekriterien

- [x] AK1 – Billboards erscheinen in der Sim-Welt als Teil des Landschaftssystems. Ein Raster liefert `round(3 · Länge/km)` Plätze, gleichmäßig verteilt und abwechselnd rechts und links (`test-loop` 30, `flat-loop` 15, `kom-climb` 8). Prioritätsorte ziehen jeweils den nächsten freien Rasterplatz an sich, statt zusätzlich gesetzt zu werden: 20 m nach dem Start, 20 m vor dem Ziel (Punkt-zu-Punkt-Strecken), 25 m vor und nach jedem Sprint- und KOM-Segment. Die Dichte bleibt dadurch 3 pro km.
- [x] AK2 – Die Platzierung ist deterministisch: gleiche Route, gleiche Positionen und Motive.
- [x] AK3 – Kein Billboard steht auf der Fahrbahn oder dem Bankett: Jede Tafelkante hält mehr als 6 m zur Mittellinie (Tafelmitte 10,5 m seitlich). Auf ihrer Seite halten Billboards mindestens 40 m Abstand zu den Kilometerschildern. Die Schilderpositionen kommen aus derselben Quelle wie die Schilder selbst (`waymark-plan.ts`). Ein blockierter Platz (See oder Kilometerschild) rückt in 5-m-Schritten bis zu ±40 m. Geht das nicht, wird er mit Grund ausgewiesen (`skipped`) und entfällt. Auf `test-loop` entfällt kein Platz; der See-Ausschluss ist getrennt getestet.
- [x] AK4 – Alle Billboards zusammen kosten 2 Draw Calls: ein instanziertes Gestell (3 Teile je Billboard) und eine instanzierte Motivfläche. Keine der beiden wirft Schatten, sonst käme ein dritter Draw Call im Schattenpass hinzu (Henrys Messung im Review von #89).
- [x] AK5 – Drei Platzhaltermotive liegen in einem Atlas von 1536 × 256 px (unter 2048 px). Sie unterscheiden sich durch Grundfarbe und 1 bis 3 Balken. Jede Instanz wählt ihre Zelle über `instanceVariant`; die Motive laufen in Streckenreihenfolge 0, 1, 2, 0, … Der Atlas wird mit dem Material freigegeben.
- [x] AK6 – Weder Verfolger- noch Übersichtskamera sitzen in einem Billboard oder sehen hindurch. Geprüft alle 2 m auf allen drei Teststrecken, mit 0,5 m Sicherheitsabstand für den Kameranachlauf. Damit keine Tafel auf einer Böschung in die Sichtlinie der Übersichtskamera ragt, folgt der Tafelfuß dem Gelände nur zwischen 1 m unter und 0,5 m über der Straße.
- [x] AK7 – Sim-Nachweis: Die Render-Diagnose zählt Billboards im Kamerablickfeld je Seite (`data-billboards-left/right`). Der E2E-Test zeigt am Start beide Seiten im Blickfeld und erstellt einen Screenshot. Ein zeitabhängiger Screenshot vom Anfahren des ersten linken Billboards war unter Last nicht stabil und wurde verworfen. Die Sichtbarkeit links ist nur durch die Blickfeld-Zählung und einen manuellen Screenshot belegt, nicht durch einen stabilen Test.
- [ ] AK8 – Kongstrong-Motiv mit Nutzungsrecht in `apps/web/public/assets/LICENSES.md`, als KTX2 über `mise run assets`. **Offen:** Motivdatei und Freigabe fehlen; der KTX2-Loader braucht eine eigene ADR (Plan in #42).
- [ ] AK9 – Performance: Die bestehenden E2E-Grenzen (≤ 150 Draw Calls, ≤ 500 000 Dreiecke) sind grün. Eine fps-Messung auf Henrys Laptop steht aus.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene | Datei                                              |
| -------- | ----- | -------------------------------------------------- |
| AK1–AK3  | Unit  | `apps/web/src/world/billboard-plan.test.ts`        |
| AK4, AK5 | Unit  | `apps/web/src/world/billboards.test.ts`            |
| AK6      | Unit  | `apps/web/src/world/billboard-camera.test.ts`      |
| AK7      | E2E   | `apps/web/e2e/billboards.spec.ts`                  |
| AK9      | E2E   | bestehende Szenen-Specs (`apps/web/e2e/*.spec.ts`) |

## Nicht-Ziele

Kein dynamisches Ad-Serving, kein Tracking, keine Server-Anbindung, keine Klick-Interaktion. Kein Branding der Segment-Torbögen.

## Offene Fragen / Risiken

- Wer liefert Kongstrongs Motiv und Nutzungsfreigabe, in welchem Format?
- Die Zählung im Blickfeld prüft den Kegel der Kamera, nicht die Verdeckung durch Bäume. Die Screenshots belegen die Sichtbarkeit nur an den beiden aufgenommenen Stellen.
- Das Atlas-Motiv hat keine Mipmaps, damit die Zellen in der Ferne nicht ineinanderlaufen. Bei großer Entfernung kann es leicht flimmern.

## Doku-Updates

- [x] Roadmap-Unterpunkt · [x] Spec · [ ] `LICENSES.md` (mit echtem Motiv)
