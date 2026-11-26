# Spec E10-07 – Biome Küste, Alpenpass und Nachtstadt

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, Checkbox „Biome Küste,
  Alpenpass (Serpentinen), Nachtstadt (Neon); Streckenauswahl mit
  Vorschau".
- **Status:** Review
- **Betroffene Module:** `packages/engine` (Route-Daten),
  `apps/server/src/rides` (Replay auf registrierten Routen),
  `apps/web/src/world`, `apps/web/src/ui`, `packages/shared`, Web-Tests
  und E10-Dokumentation.

## Ziel

Neben der bestehenden Testrunde sind drei zusätzliche Biom-Umgebungen
auswählbar: Küste mit Leuchtturm, Alpenpass mit Serpentinen und
Nachtstadt mit Neon. Jede Route besitzt eigene Daten, Atmosphäre und
Budget. Die Auswahl zeigt vor dem Start eine Vorschau. Bestehende
Aufnahmen und Zuordnungen bleiben lesbar und werden nicht neu bewertet.

## Abnahmekriterien

- [x] AK1 – Die App bietet eine Streckenauswahl mit Vorschau für vier
      Routen: bestehende Testrunde, Küste, Alpenpass und Nachtstadt.
- [x] AK2 – Küste, Alpenpass und Nachtstadt besitzen eigene Route-Daten
      mit eigener Atmosphäre und eigenem Budget.
- [x] AK3 – Die Streckenauswahl rendert pro Route eine Vorschau, ohne
      die laufende Fahrt oder bestehende Aufnahmen zu verändern.
- [x] AK4 – Bestehende Aufnahmen, Replay-Daten und Zuordnungen bleiben
      lesbar. Keine bestehende Fahrt wird stillschweigend neu bewertet.
- [x] AK5 – `mise run check` ist grün. Änderungen an `packages/engine`
      oder `packages/rules` lösen zusätzlich `check:mutation` aus.

## Testplan

| AK  | Ebene  | Datei / Fixture                                 |
| --- | ------ | ----------------------------------------------- |
| AK1 | E2E    | `apps/web/e2e/routes.spec.ts`                   |
| AK2 | Unit   | `packages/engine/.../data/biome-routes.test.ts` |
| AK2 | Unit   | `apps/web/src/world/routeCatalog.test.ts`       |
| AK3 | Unit   | `apps/web/src/ui/routePreview.test.ts`          |
| AK4 | Replay | bestehende Journal- und Replay-Tests            |
| AK5 | Gate   | `mise run check` und `check:mutation`           |

## Entscheidungen

- **Alpenpass als Rundkurs (Auftraggeber, 26.11.2026, nach Henrys Review
  auf #138):** Der Pass ist eine 25,2-km-Runde statt einer 12-km-Strecke
  mit offenem Ende. Er führt in 8 Kehren 840 m hinauf, 600 m über den
  Sattel, über eine zweite Serpentine auf der anderen Flanke hinab und
  600 m über den Talboden zurück. Beide Serpentinen liegen mindestens
  600 m auseinander und teilen keine Straße. Damit gibt es kein
  Routenende, an dem Distanz und XP gegen 7 % weiterlaufen. Die Engine
  bleibt unverändert; nur die Route-Daten ändern sich.
- **Gelände an Kehren:** Jede Geländereihe endet vor jedem anderen
  Abschnitt derselben Straße. Die Grenze gilt auch für die Nachbarreihen.
  Innen an scharfen Ecken ruht das Gelände ohne Relief auf der
  niedrigsten Nachbarhöhe der Straße. Ein Test prüft auf allen vier
  Strecken alle 5 m der Fahrbahn (Mitte und ±3,5 m) gegen die echten
  Gelände-Dreiecke.

## Nicht-Ziele

- Keine neue Physik, keine Änderung an Engine-Regeln, keine neuen
  Abhängigkeiten, kein GPX-Import, kein Fit-Export.
- Keine Neubewertung bestehender Fahrten oder Aufnahmen.
- Keine parallelen V1/V2-Subsysteme oder Weiterleitungsfassaden.

## Offene Fragen

- Die Route-Daten liegen in `packages/engine/src/elevation/data/`, die
  Präsentation in `apps/web/src/world/routeCatalog.ts`, die Auswahl im
  vorhandenen Fahrtmenü. Die Vorschau ist eine 2D-SVG-Miniatur aus der
  Centerline und benötigt keine laufende 3D-Szene.

## Doku-Updates

- [x] Roadmap-Checkbox
- [x] betroffene `docs/*.md`
- [ ] ADR, falls Entscheidung oder Leitplanke betroffen ist
