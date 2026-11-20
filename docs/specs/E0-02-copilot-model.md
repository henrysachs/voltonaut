# Spec E0-02 – GitHub Copilot für die weitere Implementierung

- **Roadmap-Bezug:** E0, projektweite OpenCode-Konfiguration
- **Status:** Review
- **Betroffene Module:** `opencode.jsonc`, `AGENTS.md`

## Ziel

Die weitere Implementierung verwendet GPT-6.1 Sol über GitHub Copilot. Die Freigabe stammt von Henry aus dem Chat vom 2026-11-20.

## Abnahmekriterien

- [x] AK1 – Die Provider-Policy erlaubt `github-copilot` und `opencode-go`. Alle anderen Provider bleiben gesperrt.
- [x] AK2 – Standardmodell und die Agenten `poteto-agent` und `comment-sicko` verwenden `github-copilot/gpt-6.1-sol`.
- [x] AK3 – `AGENTS.md` beschreibt dieselbe Freigabe.
- [x] AK4 – `mise run check` ist grün.

## Testplan

| AK      | Prüfung                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------- |
| AK1–AK2 | Geladene Konfiguration über `opencode debug config`; Modellreferenz im OpenCode-Katalog prüfen |
| AK3     | Review gegen `opencode.jsonc`                                                                  |
| AK4     | `mise run check`                                                                               |

## Nicht-Ziele

Keine globalen OpenCode-Einstellungen, Zugangsdaten oder Anwendungsfunktionen ändern.

## Offene Fragen / Risiken

Bereits ausgewählte Session-Modelle ändern sich nicht durch den neuen Standard. Neue Subagenten erhalten die explizite Modellreferenz.

## Doku-Updates

- [x] `AGENTS.md` aktualisiert.
