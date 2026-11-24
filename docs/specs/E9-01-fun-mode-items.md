# Spec E9-01 – Spaß-Modus mit Item-Boxen (Phase 1)

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E9, Unterpunkt „Spaß-Modus“
- **Issue:** #45 · getrennt von #84 (normale Power-ups)
- **Plan:** `docs/superpowers/plans/2026-11-24-fun-mode-items.md`
- **ADR:** [ADR-027](../decisions/ADR-027-fun-mode-trainer-effects.md)
- **Status:** Phase 1 implementiert und softwaregeprüft (Sim-Modus); an echter Hardware nicht geprüft; Review offen; nicht bereitgestellt
- **Betroffene Module:** `packages/shared`, `packages/engine`, `packages/ble` (Tastatur), `apps/web/src/game`, `apps/web/src/ui`, `apps/web/src/world`

## Ziel

Neben dem normalen Modus gibt es einen wählbaren Spaß-Modus. Auf der Strecke liegen Item-Boxen. Wer eine überfährt, erhält ein Power-up und löst es mit der Power-up-Taste aus (am Griff oder `p` auf der Tastatur). Der normale Modus bleibt Standard und unverändert.

## Phasen

| Phase | Inhalt                                              | Voraussetzung                   |
| ----- | --------------------------------------------------- | ------------------------------- |
| 1     | Moduswahl, Item-Boxen, Power-ups solo               | keine                           |
| 2     | Malus gegen Bots, Schutzschild, Windschatten-Magnet | E8 Bots (#70), ADR-027 Freigabe |
| 3     | Malus gegen Freunde                                 | E9 Live (#73, #74)              |

## Abnahmekriterien (Phase 1)

- [x] AK1 – Ohne Spaß-Modus bleiben alle Golden-Läufe (`fixtures/rides/*.golden.json`) unverändert. Golden-Dateien werden nicht angepasst.
- [x] AK2 – Item-Boxen liegen deterministisch: die erste bei 300 m, dann alle 800 m. Eine Box innerhalb eines Sprint- oder KOM-Segments wandert an dessen Ende. Pro Runde stehen sie erneut bereit.
- [x] AK3 – Der Inhalt kommt aus einem Seed (Standard 42). Die Engine sammelt über zwei Runden (mindestens 20 Boxen) genau die Itemfolge, die mulberry32 mit diesem Seed vorgibt. Im Zufallsgenerator wiederholen sich 100 Ziehungen exakt.
- [x] AK4 – Es gibt höchstens ein gehaltenes Item. Eine Box bei vollem Slot bleibt wirkungslos. Ein Doppeldruck vor dem nächsten Tick aktiviert einmal. Aktivieren während eines Effekts wird ignoriert.
- [x] AK5 – Items (⚠️ Startwerte): Aero-Boost (CdA × 0,85, 15 s), Leichtgewicht (Fahrer- und Radmasse × 0,90 bei Steigung ≥ 0, 20 s), Rückenwind (−3 m/s Wind nur in der Physik, 10 s). Die Effektzeit läuft nur in fahrenden Ticks.
- [x] AK6 – Trainer: Items wirken nur in der Fahrphysik. Das Trainerkommando eines Ticks ist mit und ohne aktives Item bei gleichem Zustand und gleichen Eingaben identisch. Es gibt keinen neuen Kommandopfad (ADR-027).
- [x] AK7 – Der Moduswechsel per Menü läuft während der Fahrt. Der Wechsel auf „Normal“ verwirft gehaltene und aktive Items, im nächsten Tick gelten wieder die Profilwerte.
- [x] AK8 – Im Spaß-Modus gibt es keine Fortschritts-Checkpoints und keine Aufnahme. Ein Aufnahmestart wird mit „Im Spaß-Modus gibt es keine Aufnahme.“ abgelehnt. Während einer laufenden oder noch nicht freigegebenen Aufnahme lässt sich der Spaß-Modus nicht einschalten (Worker und Menü). Das Aufnahmeprotokoll läuft ab Sitzungsbeginn und kennt keinen Spaß-Modus. Wer ihn betritt, macht deshalb alle späteren Aufnahmen dieser Sitzung zu rein lokalen Aufnahmen (Grund `fun_mode`). Das Menü sagt das vor dem Umschalten.
- [x] AK9 – Das HUD zeigt das gehaltene Item und während eines Effekts die Restsekunden. Die Welt zeigt Item-Boxen nur im Spaß-Modus, mit einem Draw Call.
- [x] AK10 – E2E im Sim-Modus: Spaß-Modus wählen, Box einsammeln, mit `p` auslösen, Countdown sehen, Ablauf erleben.

## Testplan

| AK           | Ebene  | Datei                                                                               |
| ------------ | ------ | ----------------------------------------------------------------------------------- |
| AK1          | Golden | `apps/web/src/golden/golden.test.ts`                                                |
| AK2–AK5, AK7 | Unit   | `packages/engine/src/fun/*.test.ts`, `packages/engine/src/internal/funMode.test.ts` |
| AK6          | Unit   | `packages/engine/src/internal/funMode.test.ts`                                      |
| AK8          | Unit   | `apps/web/src/game/engineWorkerFun.test.ts`, `apps/web/src/ui/rideMode.test.ts`     |
| AK9          | Unit   | `apps/web/src/ui/hud.test.ts`, `apps/web/src/world/itemBoxes.test.ts`               |
| AK10         | E2E    | `apps/web/e2e/fun-mode.spec.ts`                                                     |

## Nicht-Ziele

Keine Belohnungen, PBs oder Volts aus dem Spaß-Modus. Kein Malus und keine Bots in Phase 1. Keine Übertragung an andere Fahrer.

## Offene Fragen / Risiken

- Nach dem Spaß-Modus sind Aufnahmen bis zum Neuladen nur lokal. Eine serverseitig nachrechenbare Lösung bräuchte Modus- und Item-Einträge im Aufnahmeprotokoll (RecordingV2) und deren Nachrechnung auf dem Server. Das ist ein eigener Schritt, spätestens vor Phase 2.

- Items wirken nur in der Fahrphysik (ADR-027). Am Trainer ändert sich der Widerstand nicht. Ob ein spürbarer Effekt gewünscht ist, entscheidet Henry. Das bräuchte eine Hardwareprobe.
- Die Item-Boxen schweben als gelbe Würfel über der Fahrbahn. Eine eigene Modellierung folgt mit der Asset-Pipeline.

- Das Trainergefühl mit Items ist an echter Hardware nicht geprüft.
- Positionsausgleich (Hintere ziehen stärkere Items) gibt es erst mit Bots.
