# Spec E9-01 – Spaß-Modus mit Item-Boxen (Phase 1)

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E9, Unterpunkt „Spaß-Modus“
- **Issue:** #45 · getrennt von #84 (normale Power-ups)
- **Plan:** `docs/superpowers/plans/2026-11-24-fun-mode-items.md`
- **ADR:** [ADR-025](../decisions/ADR-025-fun-mode-trainer-effects.md)
- **Status:** In Arbeit (Phase 1)
- **Betroffene Module:** `packages/shared`, `packages/engine`, `packages/ble` (Tastatur), `apps/web/src/game`, `apps/web/src/ui`, `apps/web/src/world`

## Ziel

Neben dem normalen Modus gibt es einen wählbaren Spaß-Modus. Auf der Strecke liegen Item-Boxen. Wer eine überfährt, erhält ein Power-up und löst es mit der Power-up-Taste aus (am Griff oder `p` auf der Tastatur). Der normale Modus bleibt Standard und unverändert.

## Phasen

| Phase | Inhalt                                              | Voraussetzung                   |
| ----- | --------------------------------------------------- | ------------------------------- |
| 1     | Moduswahl, Item-Boxen, Power-ups solo               | keine                           |
| 2     | Malus gegen Bots, Schutzschild, Windschatten-Magnet | E8 Bots (#70), ADR-025 Freigabe |
| 3     | Malus gegen Freunde                                 | E9 Live (#73, #74)              |

## Abnahmekriterien (Phase 1)

- [ ] AK1 – Ohne Spaß-Modus bleiben alle Golden-Läufe (`fixtures/rides/*.golden.json`) unverändert. Golden-Dateien werden nicht angepasst.
- [ ] AK2 – Item-Boxen liegen deterministisch: die erste bei 300 m, dann alle 800 m. Eine Box innerhalb eines Sprint- oder KOM-Segments wandert an dessen Ende. Pro Runde stehen sie erneut bereit.
- [ ] AK3 – Der Inhalt kommt aus einem Seed (Standard 42). Gleicher Seed, gleiche Itemfolge über 100 Boxen.
- [ ] AK4 – Es gibt höchstens ein gehaltenes Item. Eine Box bei vollem Slot bleibt wirkungslos. Ein Doppeldruck vor dem nächsten Tick aktiviert einmal. Aktivieren während eines Effekts wird ignoriert.
- [ ] AK5 – Items (⚠️ Startwerte): Aero-Boost (CdA × 0,85, 15 s), Leichtgewicht (Fahrer- und Radmasse × 0,90, 20 s), Rückenwind (−3 m/s Wind nur in der Physik, 10 s). Die Effektzeit läuft nur in fahrenden Ticks.
- [ ] AK6 – Trainer: Mit aktivem Item ist die effektive Trainersteigung bei gleicher Steigung, Kadenz und gleichem Gang nie höher als ohne (Property-Test). Es gibt keinen neuen Kommandopfad (ADR-025).
- [ ] AK7 – Der Moduswechsel per Menü läuft während der Fahrt. Der Wechsel auf „Normal“ verwirft gehaltene und aktive Items, im nächsten Tick gelten wieder die Profilwerte.
- [ ] AK8 – Im Spaß-Modus gibt es keine Fortschritts-Checkpoints und keine Aufnahme (Ablehnung mit Grund „funMode“).
- [ ] AK9 – Das HUD zeigt das gehaltene Item und während eines Effekts die Restsekunden. Die Welt zeigt Item-Boxen nur im Spaß-Modus, mit einem Draw Call.
- [ ] AK10 – E2E im Sim-Modus: Spaß-Modus wählen, Box einsammeln, mit `p` auslösen, Countdown sehen, Ablauf erleben.

## Testplan

| AK           | Ebene    | Datei                                                                               |
| ------------ | -------- | ----------------------------------------------------------------------------------- |
| AK1          | Golden   | `apps/web/src/golden/golden.test.ts`                                                |
| AK2–AK5, AK7 | Unit     | `packages/engine/src/fun/*.test.ts`, `packages/engine/src/internal/funMode.test.ts` |
| AK6          | Property | `packages/engine/src/fun/effects.property.test.ts`                                  |
| AK8          | Unit     | `apps/web/src/game/engineWorkerCore.test.ts`                                        |
| AK9          | Unit     | `apps/web/src/ui/hud.test.ts`, `apps/web/src/world/itemBoxes.test.ts`               |
| AK10         | E2E      | `apps/web/e2e/fun-mode.spec.ts`                                                     |

## Nicht-Ziele

Keine Belohnungen, PBs oder Volts aus dem Spaß-Modus. Kein Malus und keine Bots in Phase 1. Keine Übertragung an andere Fahrer.

## Offene Fragen / Risiken

- Das Trainergefühl mit Items ist an echter Hardware nicht geprüft.
- Positionsausgleich (Hintere ziehen stärkere Items) gibt es erst mit Bots.
