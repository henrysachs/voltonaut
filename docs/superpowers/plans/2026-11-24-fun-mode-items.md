# Spaß-Modus (Item-Boxen, Power-ups, Malus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wählbarer Spaß-Modus, in dem Item-Boxen auf der Strecke Power-ups geben, die per Power-up-Taste aktiviert werden und deterministisch in der Engine wirken. Der normale Modus bleibt Standard und unverändert.

**Architecture:** Der Modus ist ein Engine-Intent (`setMode`). Item-Boxen werden seed-basiert aus der Route geplant (`planItemBoxes`). Einsammeln, Zufallsinhalt (Seed im `RideState`), Aktivierung und Ablauf laufen im Tick. Aktive Effekte verändern die Fahrparameter für Physik **und** Trainerkommando über eine einzige Funktion `effectiveRiderParams`. Web: Worker-Request, HUD-Item-Slot, Item-Boxen in der Welt, Menü-Umschalter.

**Tech Stack:** TypeScript, Vitest + fast-check, Stryker (engine), three.js (Welt), Playwright (E2E Sim-Modus).

**Spec:** GitHub-Issue #45. Task 1 überführt es in `docs/specs/E9-01-fun-mode-items.md` und eine ADR. Ausführende lesen Issue, Spec und ADR.

## Phasen

| Phase | Inhalt                                              | Voraussetzung                               | In diesem Plan             |
| ----- | --------------------------------------------------- | ------------------------------------------- | -------------------------- |
| 1     | Moduswahl, Item-Boxen, Power-ups solo               | keine                                       | Tasks 1–7, voll ausgeplant |
| 2     | Malus gegen Bots, Schutzschild, Windschatten-Magnet | E8 Bots + Windschatten in `packages/engine` | Task 8, Skizze             |
| 3     | Malus gegen Freunde                                 | E9 `live/` + `net/`                         | Task 9, Skizze             |

Phase 1 ist ein PR. Phase 2 und 3 bekommen eigene Pläne, sobald die Voraussetzungen auf `main` liegen.

## Global Constraints

- **Normaler Modus bit-identisch:** Ohne `mode: "fun"` ändern sich keine Golden-Ausgaben (`fixtures/rides/*.golden.json`, `apps/web/src/golden/golden.test.ts`). Golden-Dateien werden nicht angefasst.
- **Trainer (AGENTS.md §3.9):** Phase-1-Items senken die Last nur, nie erhöhen sie sie. Effekte laufen durch das bestehende `nextCommand` mit Klemmung `[-10, +20] %` und Ratenbegrenzung. Kein neuer Kommando-Pfad. Malus mit Lasterhöhung erst nach ADR (Phase 2).
- **Determinismus:** Zufall nur über `seed` im `RideState` (mulberry32), keine `Date.now()`/`Math.random()` in der Engine.
- **Belohnungen:** Spaß-Modus-Ticks erzeugen keine Fortschritts-Checkpoints und keine Aufnahme (`docs/06-gamification.md`; PBs/Volts nicht vermischen).
- **Eigene Items, eigene Namen und Optik** (`docs/00-vision.md` Nicht-Ziele).
- Phase-1-Items und Werte (⚠️ Startwerte):
  - `aeroBoost`: CdA × 0,85, 15 s
  - `featherweight`: Fahrer- und Radmasse × 0,90, 20 s
  - `tailwind`: Wind −3 m/s (Rückenwind), 10 s
- Item-Boxen: alle 800 m, erste bei 300 m, nicht innerhalb von Sprint-/KOM-Segmenten (dort auf das Segmentende verschieben). Gilt pro Runde erneut.
- Höchstens ein gehaltenes Item. Box überfahren mit vollem Slot ⇒ nichts passiert. Aktivieren während eines aktiven Effekts ⇒ ignoriert.
- Tastatur-Fallback: Taste `p` ⇒ `powerUp`.
- `mise run check` und `mise run check:mutation` grün.

## Review Focus

1. **Moduswechsel mitten im Effekt** auf „normal": gehaltenes und aktives Item verschwinden sofort, Parameter sind im nächsten Tick wieder die Profilwerte. → Task 4, `switching to normal clears items and restores params`.
2. **Hohe Geschwindigkeit überspringt eine Box in einem Tick** oder Rundenwechsel genau über einer Box: die Box wird trotzdem genau einmal gezählt. → Task 4, `collects box crossed across lap wrap`.
3. **Auto-Pause oder Datenverlust während eines aktiven Effekts:** die Effektdauer läuft nur in fahrenden Ticks ab, nicht im pausierten Zustand. → Task 4, `paused ticks do not consume effect time`.
4. **Doppeldruck der Power-up-Taste** (zwei Events vor einem Tick): genau eine Aktivierung. → Task 4, `double press activates once`.
5. **Trainerlast mit aktivem Item** darf bei gleicher Steigung, Kadenz und Gang nie höher sein als ohne. → Task 3, Property `effective grade never increases with an active power-up`.

---

### Task 1: Spec und ADR

**Files:**

- Create: `docs/specs/E9-01-fun-mode-items.md` (aus `_template.md`)
- Create: `docs/decisions/ADR-0xx-fun-mode-trainer-effects.md` (nächste freie Nummer)
- Modify: `docs/07-roadmap.md` (E10 „Power-ups": auf Spec verweisen; E9: Unterpunkt „Spaß-Modus Phase 3")
- Modify: `docs/04-world-3d.md` §7, `docs/06-gamification.md` „Power-ups“: Spaß-Modus als eigener Modus. Abweichend von der Power-up-Regel dort (Protokollierung im Ride-Upload, Nachrechnung) gilt: keine Belohnungen, keine Aufnahme, spätere Aufnahmen der Sitzung nur lokal (`fun_mode`). Begründung in ADR-025 Punkt 5.

- [ ] **Step 1:** Spec mit den AK aus Issue #45 für Phase 1 schreiben und die Global Constraints oben als messbare AK übernehmen, zum Beispiel: „Golden-Läufe ohne `mode` unverändert", „100 Box-Überfahrten mit Seed 42 ⇒ identische Itemfolge".
- [ ] **Step 2:** ADR: Power-ups dürfen die Trainerlast nur senken. Ein Malus mit Lasterhöhung braucht eine eigene Grenze (Vorschlag: höchstens +2 % effektive Steigung, höchstens 10 s, Opt-out „nur visuell") und Henrys Freigabe.
- [ ] **Step 3:** `mise run check` → grün
- [ ] **Step 4: Commit** `docs(engine): specify fun mode items (E9-01) and trainer effect ADR`

---

### Task 2: Shared-Verträge

**Files:**

- Create: `packages/shared/src/funMode.ts`
- Modify: `packages/shared/src/ride.ts` (`TickInputs`, `RideEvent`)
- Modify: `packages/shared/src/index.ts`
- Modify: alle `TickInputs`-Erzeuger: `packages/engine/src/internal/engine.ts`, `tick.test.ts`, `autopause.test.ts` (Helper `inputs()`)

**Interfaces:**

- Produces:
  - `type RideMode = "normal" | "fun"`
  - `type FunItemId = "aeroBoost" | "featherweight" | "tailwind"`
  - `FUN_ITEMS: Readonly<Record<FunItemId, { durationS: Seconds; cdaFactor: number; massFactor: number; windMps: Mps }>>` mit den Werten aus den Global Constraints (neutrale Faktoren 1 bzw. 0)
  - `TickInputs` neu: `readonly useItem: boolean`; `readonly mode: RideMode`
  - `RideEvent` neu: `{ type: "item.collected"; item: FunItemId; tS }` | `{ type: "item.activated"; item: FunItemId; durationS: Seconds; tS }` | `{ type: "item.expired"; item: FunItemId; tS }`

- [ ] **Step 1:** Felder ergänzen, Test-Helper liefern Default `useItem: false, mode: "normal"`.
- [ ] **Step 2:** `mise run check` → grün (reine Vertragsänderung, Verhalten unverändert; Golden grün)
- [ ] **Step 3: Commit** `feat(shared): add fun mode item contracts`

---

### Task 3: Effektparameter und Seed-Zufall (rein)

**Files:**

- Create: `packages/engine/src/fun/effects.ts`, `effects.test.ts`, `effects.property.test.ts`
- Create: `packages/engine/src/fun/rng.ts`, `rng.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `RiderParams` (`physics/params.ts`), `FUN_ITEMS`, `FunItemId` (Task 2), `effectiveGradePct` (`trainer/gradeMap.ts`)
- Produces:
  - `effectiveRiderParams(base: RiderParams, active: FunItemId | undefined): RiderParams`: `cdaM2 × cdaFactor`, `massKg` und `bikeMassKg × massFactor`, Rest unverändert; `undefined` ⇒ exakt `base` (gleiche Referenz)
  - `effectWindMps(active: FunItemId | undefined): Mps`
  - `nextRandom(state: number): { readonly value: number; readonly state: number }`: mulberry32, `value ∈ [0, 1)`
  - `pickItem(value: number): FunItemId`: gleichverteilt über die Reihenfolge in `FUN_ITEMS`

- [ ] **Step 1: Failing tests:**
  - `no active item returns base params by reference`
  - `aeroBoost scales only cdaM2 by 0.85`, `featherweight scales rider and bike mass by 0.9`, `tailwind yields -3 m/s wind`
  - `nextRandom is deterministic for seed 42` (erste drei Werte fest eintragen, nachdem die Implementierung sie geliefert hat und sie gegen eine Referenzimplementierung geprüft wurden)
  - `pickItem covers all items for values 0, 0.34, 0.67, 0.999`
  - Property `effective grade never increases with an active power-up`: für zufällige Kadenz 40–120, Steigung −10…20, Gang aus dem Preset und jedes Item gilt `effectiveGradePct(mit Item) <= effectiveGradePct(ohne)`. Bei `tailwind` geht der Wind nicht ins Trainerkommando ein (`windMps: 0` bleibt). Das als eigene Assertion auf `simulationCommand` festhalten.
- [ ] **Step 2:** `pnpm --filter @voltonaut/engine exec vitest run src/fun` → FAIL
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** → PASS
- [ ] **Step 5: Commit** `feat(engine): add fun mode effect parameters and seeded rng`

---

### Task 4: Item-Boxen und Tick-Integration

**Files:**

- Create: `packages/engine/src/fun/itemBoxes.ts`, `itemBoxes.test.ts`
- Modify: `packages/engine/src/internal/state.ts` (Felder + Init)
- Modify: `packages/engine/src/internal/tick.ts` (neuer Schritt `applyFunMode`, `advanceRide` und `computeNextCommand` nutzen effektive Parameter)
- Modify: `packages/engine/src/internal/engine.ts` (Puffer `useItem`, `mode`; `setMode`; Snapshot)
- Create: `packages/engine/src/internal/funMode.test.ts`

**Interfaces:**

- Consumes: Task 3
- Produces:
  - `planItemBoxes(route: EngineRoute): readonly Meters[]`: aufsteigende Routenpositionen nach den Regeln in den Global Constraints. Die Verteilung ist fest. Der Zufall steckt nur im Inhalt.
  - `RideState` neu: `mode: RideMode`, `heldItem: FunItemId | undefined`, `activeItem: FunItemId | undefined`, `activeRemainingS: Seconds`, `rngState: number`
  - `CreateEngineOptions` neu: `mode?: RideMode` (Default `"normal"`), `seed?: number` (Default 42)
  - `Engine.setMode(mode: RideMode): void`: Intent, wirkt im nächsten Tick
  - `RideSnapshot` neu: `fun: { readonly heldItem: FunItemId | undefined; readonly activeItem: FunItemId | undefined; readonly activeRemainingS: Seconds } | undefined` (`undefined` im normalen Modus)
  - `ingest` eines `controller.button`-Events mit `button: "powerUp", pressed: true` setzt `useItem` für den nächsten Tick. Mehrfachdruck bis dahin zählt einmal.
- Tick-Reihenfolge neu: shifts → measurements → pause → **fun (Modus übernehmen, Aktivierung, Restdauer)** → advanceRide (mit effektiven Parametern und Wind) → **Box-Überquerung (`crossedBoundaryM` wiederverwenden)** → stationary → trainerCommand (mit effektiven Parametern).

- [ ] **Step 1: Failing tests** `itemBoxes.test.ts`: `first box at 300 m then every 800 m`, `box inside a segment moves to segment end`, `same route yields same boxes`.
- [ ] **Step 2: Failing tests** `funMode.test.ts` (über `createEngine` mit Sim-Eingaben, keine Mocks):
  - `normal mode never collects items or emits item events`
  - `fun mode collects an item when crossing a box`
  - `collects box crossed across lap wrap`
  - `full slot ignores the next box`
  - `powerUp activates held item and emits item.activated`
  - `double press activates once`
  - `effect expires after its duration and emits item.expired`
  - `paused ticks do not consume effect time`
  - `aeroBoost rider is faster than baseline at equal power` (zwei Engines, gleicher Seed, 250 W, 30 s)
  - `switching to normal clears items and restores params`
  - `seed 42 yields identical item sequence over 100 boxes` (Determinismus)
- [ ] **Step 3:** → FAIL
- [ ] **Step 4:** Implementieren. Die effektiven Parameter je Tick einmal berechnen und an `advanceSpeedMps` und `computeNextCommand` übergeben. Im normalen Modus läuft exakt der bisherige Pfad.
- [ ] **Step 5:** Engine-Tests und Golden-Test (`apps/web/src/golden/golden.test.ts`) → PASS ohne Änderung an Golden-Dateien
- [ ] **Step 6:** `mise run check:mutation` → Schwellen gehalten
- [ ] **Step 7: Commit** `feat(engine): run fun mode item boxes in the tick`

---

### Task 5: Worker, Tastatur und Fortschrittssperre

**Files:**

- Modify: `apps/web/src/game/engineWorkerCore.ts` (+ Test), `engine-link.ts` (+ Test)
- Modify: `packages/ble/src/keyboard.ts` (+ Test): `p` ⇒ `powerUp`

**Interfaces:**

- `EngineWorkerRequest` neu: `{ type: "engine.setMode"; actorId: string; mode: RideMode }`; `engine.init` erhält `mode: RideMode`
- `EngineLink.setMode(mode: RideMode): void`
- Im Spaß-Modus: `progress` im `engine.update` bleibt `undefined`. Aufnahme-Kommandos werden mit dem bestehenden Ablehnungsergebnis und dem Grund `"funMode"` beantwortet.

- [ ] **Step 1: Failing tests:** `setMode request reaches the engine`, `fun mode posts no progress checkpoints`, `recording start is refused in fun mode`, `switching back to normal resumes progress`, Tastatur `p maps to powerUp press and release`.
- [ ] **Step 2:** → FAIL; **Step 3:** implementieren; **Step 4:** → PASS
- [ ] **Step 5: Commit** `feat(web): route fun mode through the engine worker`

---

### Task 6: HUD, Menü und Welt

**Files:**

- Modify: `apps/web/src/ui/hud.ts` (+ `hud.test.ts`): Item-Slot
- Modify: `apps/web/index.html`, `apps/web/src/ui/gameMenu.ts` (+ Test): Umschalter „Spielmodus: Normal / Spaß" im bestehenden Fahrt-Tab
- Create: `apps/web/src/world/itemBoxes.ts` (InstancedMesh, Muster `scenery.ts`/`waymarks.ts`), Anbindung in `scene-core.ts`

**Interfaces:**

- HUD liest nur `snapshot.fun`: zeigt das gehaltene Item (Symbol + Name), bei aktivem Effekt einen Countdown in ganzen Sekunden; `fun === undefined` ⇒ Slot ausgeblendet. Texte: „Aero-Boost", „Leichtgewicht", „Rückenwind".
- Welt: Boxen an `planItemBoxes(route)`, ein Draw Call. Sichtbar nur im Spaß-Modus.
- Menü: Umschalter ruft `EngineLink.setMode`. Die Fahrt läuft weiter, das Menü bleibt offen.

- [ ] **Step 1: Failing tests:** `hud hides item slot in normal mode`, `hud shows held item name`, `hud shows remaining seconds while active`, `menu mode switch calls setMode and keeps ride running`, `item boxes use one instanced draw call`.
- [ ] **Step 2:** → FAIL; **Step 3:** implementieren; **Step 4:** → PASS
- [ ] **Step 5: Commit** `feat(web): show fun mode items in hud, menu and world`

---

### Task 7: E2E und Doku-Abschluss Phase 1

**Files:**

- Create: `apps/web/e2e/fun-mode.spec.ts`
- Modify: Spec-Status, `docs/07-roadmap.md`

- [ ] **Step 1:** E2E im Sim-Modus (`/?sim=1`): Menü → Spaß-Modus → Menü schließen → fahren bis zur ersten Box → HUD zeigt Item → `p` → HUD zeigt Countdown → nach Ablauf leer. Zweiter Fall: Rückwechsel auf Normal blendet den Slot aus. Keine Timeouts oder Sim-Uhr zum Bestehen verbiegen (AGENTS.md §10). `clockScale` nur so nutzen wie die bestehenden Specs.
- [ ] **Step 2:** Visueller Test für HUD-Slot und Item-Box.
- [ ] **Step 3:** `mise run check` + `mise run check:mutation` → grün
- [ ] **Step 4:** Status in der Spec getrennt angeben: implementiert / softwaregeprüft / Hardware (Trainerlast mit Item) offen / bereitgestellt.
- [ ] **Step 5: Commit** `test(web): cover fun mode end to end`. **Ende Phase 1, PR öffnen.**

---

### Task 8 (Phase 2, Skizze, blockiert durch E8)

Erst planen, wenn Bots und Windschatten in der Engine existieren:

- Items `draftMagnet` (stärkerer Draft) und `shield` (blockt nächsten Malus).
- Malus `headwindCloud` (Fahrer direkt vor dir: Wind +3 m/s, 8 s) und `mudPatch` (Abschnitt: Crr × 1,5, 10 s), wirkt auf Bots über dieselbe `effectiveRiderParams`.
- Wirkt ein Malus auf den eigenen Trainer: nur innerhalb der ADR-Grenze aus Task 1 und mit Opt-out „nur visuell".
- Bots nutzen Items seed-basiert; Positionsausgleich (Hintere ziehen stärkere Items) als Gewichtung in `pickItem`.

### Task 9 (Phase 3, Skizze, blockiert durch E9)

- Item-Events über `live/` als Zod-Schemas in `packages/shared`. Der Server prüft Besitz und Abklingzeit.
- Malus gegen Freunde nur in Räumen, deren Ersteller den Spaß-Modus aktiviert hat.
- Latenz: Effekt startet beim Empfänger mit Serverzeitstempel. Bei verspätetem Eintreffen wird die Restdauer gekürzt, nicht verlängert.
