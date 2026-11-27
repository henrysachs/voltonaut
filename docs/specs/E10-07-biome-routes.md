# Spec E10-07 – Biome Küste, Alpenpass und Nachtstadt

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, Checkbox „Biome Küste,
  Alpenpass (Serpentinen), Nachtstadt (Neon); Streckenauswahl mit
  Vorschau".
- **Status:** Review
- **Betroffene Module:** `apps/web/src/world`, `apps/web/src/ui`,
  `packages/engine/src/elevation/data`, `apps/server/src/rides`, Web-/Engine-/Server-Tests
  und E10-Dokumentation. `packages/shared` bleibt unverändert.

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
      mit eigener Atmosphäre und eigenem Budget. Der Alpenpass ist ein
      geschlossener Auf- und Abstieg mit getrennten Fahrkorridoren.
- [x] AK3 – Die Streckenauswahl rendert pro Route eine Vorschau, ohne
      die laufende Fahrt oder bestehende Aufnahmen zu verändern.
- [x] AK4 – Bestehende Aufnahmen, Replay-Daten und Zuordnungen bleiben
      lesbar. Keine bestehende Fahrt wird stillschweigend neu bewertet.
- [x] AK5 – `mise run check` ist grün. Änderungen an `packages/engine`
      oder `packages/rules` lösen zusätzlich `check:mutation` aus.

## Testplan

| AK  | Ebene   | Datei / Fixture                                           |
| --- | ------- | --------------------------------------------------------- |
| AK1 | E2E     | `apps/web/e2e/routes.spec.ts`                             |
| AK2 | Unit    | `packages/engine/src/elevation/data/biome-routes.test.ts` |
| AK2 | Unit    | `apps/web/src/world/routeCatalog.test.ts`                 |
| AK2 | Raycast | `apps/web/src/world/alpineLandscape.test.ts`              |
| AK3 | Unit    | `apps/web/src/ui/routePreview.test.ts`                    |
| AK4 | Replay  | bestehende Journal- und Replay-Tests                      |
| AK5 | Gate    | `mise run check` und `check:mutation`                     |

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

## Review-Korrektur

- Der Alpenpass nutzt weiterhin die 12-km-Serpentine als Anstieg. Eine
  separate Rückfahrt steigt über die gesamte Strecke ab; der Centerline ist
  tatsächlich geschlossen, ohne Teleport oder überlappende Terrainbänder.
- Alpine Terrainflächen über fremden Fahrbahnen werden verworfen. Ein
  schmaler, geminderter Fahrbahnrand hält beide Schultern auch an Kehren
  unter der Straße. Die übrigen Biome behalten ihre bisherige Geometrie.
- Ein Raycast prüft die reale `ALPINE_PASS`-Terrainfläche auf beiden Seiten
  alle 10 m über die gesamte Strecke.

## Doku-Updates

- [ ] Roadmap-Checkbox bleibt bis visuelle und Hardware-Abnahme offen
- [x] betroffene `docs/*.md`
- [ ] ADR, falls Entscheidung oder Leitplanke betroffen ist
