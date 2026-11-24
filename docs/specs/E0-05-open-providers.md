# Spec E0-05 – Alle OpenCode-Provider freigeben

- **Roadmap-Bezug:** E0, projektweite OpenCode-Konfiguration
- **Status:** Review
- **Betroffene Module:** `opencode.jsonc`, `AGENTS.md`

## Ziel

Henry gibt am 24.11.2026 alle Provider wieder frei. Die projektweite Einschränkung aus [E0-02](E0-02-copilot-model.md) entfällt. Standardmodell und Agentenmodelle bleiben unverändert.

## Abnahmekriterien

- [x] AK1: `opencode.jsonc` enthält keine Providerbeschränkung.
- [x] AK2: Standardmodell und Agentenmodelle bleiben `github-copilot/gpt-6.1-sol`.
- [x] AK3: `AGENTS.md` dokumentiert die Freigabe.
- [x] AK4: JSON-Prüfung und unabhängiges Review bestehen. Henry verlangt für diese reine OpenCode-Änderung keinen Anwendungsbuild.

## Testplan

| AK      | Prüfung                                                               |
| ------- | --------------------------------------------------------------------- |
| AK1–AK2 | Konfiguration parsen und Diff gegen `origin/main` prüfen              |
| AK3     | Review gegen `opencode.jsonc`                                         |
| AK4     | JSON-Prüfung, Formatprüfung und zweiter Agent gemäß Review-Checkliste |

## Nicht-Ziele

Keine globalen Einstellungen, Zugangsdaten, Modellwechsel oder Änderungen am Spiel. Bestehende GitHub-Schutzregeln bleiben unverändert.

## Offene Fragen / Risiken

Übergeordnete Provider-Policies gelten weiterhin. Die Freigabe richtet keine Zugangsdaten ein.

## Doku-Updates

- [x] `AGENTS.md` aktualisiert. Keine funktionale Roadmap-Checkbox betroffen.
