# Spec E10-07 – Biome Küste, Alpenpass und Nachtstadt

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, Checkbox „Biome Küste,
  Alpenpass (Serpentinen), Nachtstadt (Neon); Streckenauswahl mit
  Vorschau".
- **Status:** Entwurf
- **Betroffene Module:** `apps/web/src/world`, `apps/web/src/ui`,
  `packages/shared`, Web-Tests und E10-Dokumentation.

## Ziel

Neben der bestehenden Testrunde sind drei zusätzliche Biom-Umgebungen
auswählbar: Küste mit Leuchtturm, Alpenpass mit Serpentinen und
Nachtstadt mit Neon. Jede Route besitzt eigene Daten, Atmosphäre und
Budget. Die Auswahl zeigt vor dem Start eine Vorschau. Bestehende
Aufnahmen und Zuordnungen bleiben lesbar und werden nicht neu bewertet.

## Abnahmekriterien

- [ ] AK1 – Die App bietet eine Streckenauswahl mit Vorschau für vier
  Routen: bestehende Testrunde, Küste, Alpenpass und Nachtstadt.
- [ ] AK2 – Küste, Alpenpass und Nachtstadt besitzen eigene Route-Daten
  mit eigener Atmosphäre und eigenem Budget.
- [ ] AK3 – Die Streckenauswahl rendert pro Route eine Vorschau, ohne
  die laufende Fahrt oder bestehende Aufnahmen zu verändern.
- [ ] AK4 – Bestehende Aufnahmen, Replay-Daten und Zuordnungen bleiben
  lesbar. Keine bestehende Fahrt wird stillschweigend neu bewertet.
- [ ] AK5 – `mise run check` ist grün. Änderungen an `packages/engine`
  oder `packages/rules` lösen zusätzlich `check:mutation` aus.

## Testplan

| AK  | Ebene       | Datei / Fixture                              |
| --- | ----------- | -------------------------------------------- |
| AK1 | E2E         | `apps/web/e2e/route-selection.spec.ts`       |
| AK2 | Unit        | `apps/web/src/world/route.data.test.ts`      |
| AK3 | E2E        | `apps/web/e2e/route-preview.spec.ts`         |
| AK4 | Unit/Replay | `packages/engine/src/journal/codec.test.ts`  |
| AK5 | Gate        | `mise run check`                             |

## Nicht-Ziele

- Keine neue Physik, keine Änderung an Engine-Regeln, keine neuen
  Abhängigkeiten, kein GPX-Import, kein Fit-Export.
- Keine Neubewertung bestehender Fahrten oder Aufnahmen.
- Keine parallelen V1/V2-Subsysteme oder Weiterleitungsfassaden.

## Offene Fragen

- Die konkreten Dateien für Route-Daten und Streckenauswahl folgen nach
  der Codeanalyse.
- Die Vorschau muss ohne laufende 3D-Szene funktionieren oder eine feste
  Standbild-Vorschau verwenden.

## Doku-Updates

- [ ] Roadmap-Checkbox
- [ ] betroffene `docs/*.md`
- [ ] ADR, falls Entscheidung oder Leitplanke betroffen ist
