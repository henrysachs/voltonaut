# Review-Checkliste (zweiter Agent)

Der Reviewer ist **nicht** der Autor. Ergebnis als PR-Kommentar: „Approve" oder Liste der Befunde.

- [ ] Spec vorhanden und verlinkt; jedes Abnahmekriterium ist erfüllt **und** durch mindestens einen Test belegt (Testplan stimmt mit Code überein).
- [ ] `check` und `mutation` grün in CI am exakten Head (beide Required ohne Bypass, ADR-036).
- [ ] Keine Lockerung: keine Änderungen an `oxlint.config.ts`, `tools/oxlint/**`, `tsconfig*`, `.dependency-cruiser.cjs`, `.oxfmtrc.json`, `mise.toml`, `scripts/guard.mjs`, `.github/**` ohne ADR; keine `oxlint-disable` ohne stichhaltige Begründung; `// SAFETY:`-Kommentare sind inhaltlich korrekt.
- [ ] Golden-/Screenshot-Baselines/BLE-Fixtures nur geändert, wenn fachlich begründet (Label `baseline-update`, Begründung im PR).
- [ ] Neue Abhängigkeiten: ADR + `docs/dependencies.md`.
- [ ] State-Ownership eingehalten (nur engine schreibt RideState, Server vergibt Belohnungen, Render-Systeme lesen nur).
- [ ] Sim-Modus funktioniert weiterhin; UI/3D-Änderungen haben E2E-/visuelle Tests.
- [ ] Doku aktualisiert (Roadmap-Checkbox, `02-bluetooth.md`-Befunde, ADRs).
- [ ] Hardware-relevant? „An echter Hardware getestet: ja/nein" angegeben.
