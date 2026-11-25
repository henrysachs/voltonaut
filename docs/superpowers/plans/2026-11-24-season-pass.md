# Season Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zeitlich begrenzte Saison mit mindestens 20 Stufen, deren Fortschritt aus denselben bestätigten Fahrtabschnitten wie XP entsteht und deren Stufenbelohnungen genau einmal vergeben werden.

**Architecture:** Saison-Definition und Belohnungsmodell als Zod-Schemas in `packages/shared`. Reine, uhrfreie Rechenlogik (Punkte, Stufe, fällige Belohnungen) in `packages/rules`. Erste Saison als typisierte Datei in `packages/rules/src/data/seasons/`. Der Server rechnet verbindlich mit derselben Logik. Der Client zeigt eine Vorschau im Ingame-Menü.

**Tech Stack:** TypeScript, Zod, Vitest + fast-check, Stryker (rules), NestJS + Drizzle/SQLite (Server), Playwright (E2E).

**Spec:** GitHub-Issue #44. Task 1 überführt es in `docs/specs/E6-06-season-pass.md`. Ausführende lesen Issue und Spec.

## Abhängigkeiten und Phasen

| Phase                    | Tasks | Voraussetzung                                                                    | Jetzt umsetzbar |
| ------------------------ | ----- | -------------------------------------------------------------------------------- | --------------- |
| A – Rechenkern           | 1–4   | keine                                                                            | ja              |
| B – Verbindliche Vergabe | 5–6   | E6 `progression/` mit serverseitig bestätigten Fahrtabschnitten, E7 `inventory/` | nein, blockiert |
| C – Oberfläche           | 7     | Phase B (Endpunkt)                                                               | nein, blockiert |

Phase A endet mit einem eigenen PR. Phase B und C starten erst, wenn die Voraussetzungen auf `main` liegen. Bis dahin keine Ersatz-Vergabe und keine Client-Fassade bauen (AGENTS.md §9).

## Global Constraints

- Keine `Date.now()` in `packages/rules`: Zeitpunkt und Saisonzeitraum werden explizit übergeben.
- Jede öffentliche Rechenfunktion parst ihre Eingaben erneut mit den Shared-Schemas und rechnet nur mit der geparsten Kopie (`docs/06-gamification.md`).
- Sim-Fahrten bringen keinen Saisonfortschritt.
- Fortschritt außerhalb des Saisonzeitraums zählt nicht. Start inklusive, Ende exklusiv.
- Verdiente Season-Items bleiben nach Saisonende dauerhaft im Inventar.
- Nicht-Ziele v1: keine Echtgeld-Käufe, kein Premium-Track, keine Maps als Belohnung, kein Stufenkauf mit Volts.
- Saisonpunkte = Basis-XP derselben bestätigten Fahrtabschnitte, 1:1 (Annahme, siehe Task 1; Henry bestätigt).
- Rundung: Punkte werden wie Basis-XP einmal über die aggregierte Fahrt abgerundet. Pro Abschnitt zählt die Differenz der kumulierten Fahrtpunkte, nicht der einzeln abgerundete Abschnitt.
- Einheiten im Namen (`startsAtMs`, `pointsRequired`), keine `vi.mock`, kein `unknown` in Verträgen.
- `mise run check` und `mise run check:mutation` grün.

## Review Focus

1. **Abschnitt überquert mehrere Stufen auf einmal** (lange Fahrt, später Upload): alle übersprungenen Stufen werden fällig, keine fehlt. → Task 3, Test `dueRewards returns every crossed tier`.
2. **Wiederholter oder überlappender Abschnitt**: keine Doppelvergabe. → rein: Task 3, Property `split sections equal whole`; Server: Task 5, `replayed section grants nothing`.
3. **Abschnitt liegt über der Saisongrenze** (Fahrt beginnt vor Saisonende, wird danach bestätigt): maßgeblich ist der Zeitpunkt des Abschnitts, nicht der Bestätigung. → Task 3, Test `uses section time, not confirmation time`.
4. **Punkte über der letzten Stufe**: Stufe bleibt beim Maximum, keine Belohnung erfunden. → Task 3, Test `caps at last tier`.
5. **Offline gefahrene Abschnitte, die erst nach Saisonende hochgeladen werden**: zählen, wenn ihr Fahrzeitpunkt im Zeitraum lag. → Task 5, `late upload inside window counts`.

---

### Task 1: Spec und Doku anlegen

**Files:**

- Create: `docs/specs/E6-06-season-pass.md` (aus `docs/specs/_template.md`)
- Modify: `docs/07-roadmap.md` (E6: Unterpunkt „Season Pass" mit Spec-Link, offen)
- Modify: `docs/06-gamification.md` (neuer Abschnitt „Season Pass" mit Punkte-Regel und Stufenkurve, ⚠️ Startwerte)

- [ ] **Step 1:** Spec schreiben. Ziel, Nicht-Ziele und AK aus Issue #44 übernehmen. Präzisieren:
  - AK-Punkte: „Saisonpunkte = Basis-XP (`calculateBaseXp(...).total`) der bestätigten Abschnitte"
  - AK-Zeitraum: „Start ≤ Abschnittszeit < Ende"
  - AK-Kurve: „20 Stufen, 1 800 Punkte je Stufe, linear (⚠️ Startwert)"
  - Testplan-Tabelle nach `docs/10-testing.md`
  - Phasen A/B/C aus diesem Plan mit ihren Voraussetzungen
- [ ] **Step 2:** In „Offene Fragen" die vier Fragen aus dem Issue übernehmen und jeweils die Annahme dieses Plans nennen: Punkte aus XP, 10 Wochen / 20 Stufen, kein Premium-Track (ADR nötig), Maps nur vorbereitet.
- [ ] **Step 3:** `mise run check` → grün (Formatierung).
- [ ] **Step 4: Commit**

```bash
git add docs/specs/E6-06-season-pass.md docs/07-roadmap.md docs/06-gamification.md
git commit -m "docs(rules): specify season pass (E6-06)"
```

---

### Task 2: Shared-Schemas für Saison und Belohnungen

**Files:**

- Create: `packages/shared/src/season.ts`
- Create: `packages/shared/src/season.test.ts`
- Modify: `packages/shared/src/index.ts` (Export)

**Interfaces:**

- Produces:
  - `SeasonPointsSchema`: `z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER).brand<"SeasonPoints">()`, Typ `SeasonPoints`
  - `SeasonRewardSchema`: diskriminierte Union auf `kind`, strict: `{ kind: "item"; itemId: string }` | `{ kind: "volts"; amount: int 1..10_000 }`. Weitere Arten (Route) werden später ergänzt, nicht jetzt.
  - `SeasonTierSchema`: `{ tier: int ≥ 1; pointsRequired: SeasonPoints; rewards: SeasonReward[] (min 1) }`, strict
  - `SeasonDefinitionSchema`: `{ id: /^season-\d{2}$/; name: string(1..60); startsAt: ISO-Datetime mit Z; endsAt: ISO-Datetime mit Z; tiers: SeasonTier[] (min 20) }`, strict, readonly, Typ `SeasonDefinition`
  - `SeasonUnlockRuleSchema`: `{ kind: "season"; seasonId: string; tier: int ≥ 1 }`, Typ `SeasonUnlockRule`. Die spätere E7-`UnlockRule`-Union nimmt dieses Schema auf.

- [ ] **Step 1: Failing tests schreiben** in `season.test.ts`:
  - `accepts a minimal valid 20-tier season`
  - `rejects endsAt <= startsAt`
  - `rejects a season shorter than 56 days or longer than 84 days` (8 bis 12 Wochen laut Issue)
  - `rejects tiers that are not numbered 1..n consecutively`
  - `rejects pointsRequired that is not strictly increasing` (Stufe 1 > 0)
  - `rejects unknown reward kinds and extra fields`
  - `rejects fewer than 20 tiers`
- [ ] **Step 2:** `pnpm --filter @voltonaut/shared exec vitest run src/season.test.ts` → FAIL (Modul fehlt)
- [ ] **Step 3:** Schemas implementieren. Die Querregeln (Dauer, Nummerierung, Monotonie) als `.superRefine` mit `path` je Verstoß.
- [ ] **Step 4:** Test erneut → PASS
- [ ] **Step 5: Commit** `feat(shared): add season pass schemas`

---

### Task 3: Reine Saisonlogik in `packages/rules`

**Files:**

- Create: `packages/rules/src/season.ts`
- Create: `packages/rules/src/season.test.ts`
- Create: `packages/rules/src/season.property.test.ts`
- Modify: `packages/rules/src/index.ts`

**Interfaces:**

- Consumes: `SeasonDefinitionSchema`, `SeasonPointsSchema`, `RewardFactsSchema` (Task 2, bestehend); `calculateBaseXp` aus `./xp.js`
- Produces:
  - `isSeasonOpen(season: SeasonDefinition, atMs: number): boolean`: `Date.parse(startsAt) <= atMs < Date.parse(endsAt)`
  - `ridePointsDelta(before: RewardFacts | undefined, after: RewardFacts): SeasonPoints`: `calculateBaseXp(after).total - (before ? calculateBaseXp(before).total : 0)`, nie negativ (negatives Delta wirft, weil `after` kumuliert sein muss)
  - `tierForPoints(season: SeasonDefinition, points: SeasonPoints): number`: höchste Stufe mit `pointsRequired <= points`, sonst 0
  - `dueTiers(season: SeasonDefinition, previous: SeasonPoints, next: SeasonPoints): readonly SeasonTier[]`: alle Stufen mit `previous < pointsRequired <= next`, aufsteigend; `next < previous` wirft
  - `applySeasonSection(input: { season; currentPoints: SeasonPoints; before: RewardFacts | undefined; after: RewardFacts; sectionAtMs: number }): { points: SeasonPoints; newTiers: readonly SeasonTier[] }`: außerhalb des Zeitraums unverändert und `newTiers = []`

- [ ] **Step 1: Failing unit tests** (`season.test.ts`), unter anderem:
  - `isSeasonOpen includes start and excludes end`
  - `tierForPoints is 0 below tier 1 and caps at last tier` (Punkte = 10× letzte Schwelle → 20)
  - `dueTiers returns every crossed tier` (0 → Schwelle Stufe 3 ⇒ Stufen 1, 2, 3)
  - `dueTiers on exact threshold includes that tier once`
  - `ridePointsDelta keeps whole-ride rounding`: zwei Abschnitte mit je 25 m (vorher 0, dann 25 m, dann 50 m) ⇒ Delta 0 und dann 1 (nicht 0 + 0)
  - `uses section time, not confirmation time`: `sectionAtMs` = Ende − 1 ms zählt, Ende zählt nicht
  - `applySeasonSection outside window returns unchanged points and no tiers`
  - Jede öffentliche Funktion: `rejects missing inputs at public boundaries` (Muster aus `levels.test.ts`)
- [ ] **Step 2: Property tests** (`season.property.test.ts`, fast-check):
  - `split sections equal whole`: für zufällige Punktfolgen `0 ≤ a ≤ b ≤ c` gilt `dueTiers(a,b) ++ dueTiers(b,c)` = `dueTiers(a,c)` (keine Doppel- oder Fehlvergabe)
  - `tierForPoints is monotonic`
  - `ridePointsDelta summed over cumulative facts equals whole-ride points`
- [ ] **Step 3:** `pnpm --filter @voltonaut/rules exec vitest run src/season` → FAIL
- [ ] **Step 4:** Implementieren. Eingaben zuerst mit den Schemas parsen, nur mit den Kopien rechnen. Rückgaben `Object.freeze`.
- [ ] **Step 5:** Tests → PASS; dann `mise run check:mutation` → überlebende Mutanten in `season.ts` = 0 bzw. Schwelle aus `docs/10-testing.md` §9 gehalten
- [ ] **Step 6: Commit** `feat(rules): add deterministic season pass progression`

---

### Task 4: Erste Saison als Katalogdaten

**Files:**

- Create: `packages/rules/src/data/seasons/season-01.ts`
- Create: `packages/rules/src/data/seasons/index.ts` (`SEASONS: readonly SeasonDefinition[]`, `seasonAt(atMs: number): SeasonDefinition | undefined`)
- Create: `packages/rules/src/data/seasons/seasons.test.ts`
- Modify: `packages/rules/src/index.ts`

**Interfaces:**

- Consumes: `SeasonDefinitionSchema` (Task 2), `isSeasonOpen` (Task 3)
- Produces: `SEASONS`, `seasonAt(atMs)`

- [ ] **Step 1: Failing test** `seasons.test.ts`:
  - `every season parses with SeasonDefinitionSchema`
  - `season ids are unique and seasons do not overlap`
  - `season-01 has 20 tiers at 1800 points each`
  - `seasonAt returns season-01 inside and undefined outside its window`
- [ ] **Step 2:** Test → FAIL
- [ ] **Step 3:** `season-01` anlegen: `startsAt: "2027-01-04T00:00:00Z"`, `endsAt: "2027-03-15T00:00:00Z"` (10 Wochen), Stufe n hat `pointsRequired = 1800 · n`. Belohnungen abwechselnd Volts-Bonus und kosmetisches Item. Item-IDs als Platzhalter `season-01-jersey`, `season-01-wheels` usw. Die Prüfung der Item-IDs gegen den Katalog folgt mit E7 (offene Frage in der Spec).
- [ ] **Step 4:** Test → PASS
- [ ] **Step 5:** `mise run check` + `mise run check:mutation` → grün
- [ ] **Step 6: Commit** `feat(rules): add season 01 catalog data`. **Ende Phase A, PR öffnen.**

---

### Task 5 (Phase B, blockiert): Serverseitiger Saisonstand und Vergabe

**Voraussetzung:** E6 `progression/` bestätigt Abschnitte serverseitig und liefert je Abschnitt `before`/`after` als kumulierte `RewardFacts` plus Fahrzeitpunkt. E7 `inventory/` bietet eine Inventarbuchung in einer Transaktion. Vor Beginn prüfen, wie diese Schnittstellen tatsächlich heißen, und dann diesen Task anpassen.

**Files:**

- Create: `apps/server/src/seasons/seasons.module.ts`, `seasons.service.ts`, `seasons.controller.ts`
- Create: `apps/server/src/seasons/seasons.test.ts`
- Modify: `apps/server/src/schema.ts` (Tabellen), Migration additiv
- Create: `packages/shared/src/api/seasons.ts` (`SeasonStatusResponseSchema`)

**Interfaces:**

- Tabellen: `season_progress(account_id, season_id, points, PK(account_id, season_id))`, `season_tier_grants(account_id, season_id, tier, granted_at, PK(account_id, season_id, tier))`
- `SeasonsService.onSectionConfirmed(tx, { accountId, before, after, sectionAtMs, source })`: läuft **in derselben Transaktion** wie die Abschnittsbestätigung. `source === "sim"` ⇒ nichts tun.
- `GET /v1/seasons/current` → `{ season: SeasonDefinition | null; points: SeasonPoints; tier: number; grantedTiers: number[] }`

- [ ] **Step 1: Failing tests** (Supertest/`@nestjs/testing`, SQLite in-memory):
  - `confirmed section inside window adds points and grants crossed tiers`
  - `replayed section grants nothing` (gleiche Abschnitts-ID zweimal)
  - `sim ride yields no season progress`
  - `late upload inside window counts` (Fahrzeitpunkt im Zeitraum, Bestätigung danach)
  - `section outside window changes nothing`
  - `granted items stay in inventory after season end`
  - `tier grant and inventory booking roll back together` (erzwungener Fehler in der Inventarbuchung ⇒ kein Grant-Eintrag)
- [ ] **Step 2:** → FAIL
- [ ] **Step 3:** Implementieren mit `applySeasonSection` aus `@voltonaut/rules`. Die PK auf `season_tier_grants` verhindert Doppelvergabe zusätzlich auf Datenbankebene.
- [ ] **Step 4:** → PASS; `mise run check` grün
- [ ] **Step 5: Commit** `feat(server): grant season pass tiers from confirmed sections`

### Task 6 (Phase B, blockiert): Client-Spiegel

**Files:** `apps/web/src/sync/season.ts` + Test

**Interfaces:** `loadSeasonStatus(): Promise<SeasonStatus>` parst mit `SeasonStatusResponseSchema`. Vorläufige Vorschau während der Fahrt: `applySeasonSection` auf die laufenden Checkpoints anwenden, klar als „vorläufig" markiert, getrennt vom bestätigten Stand.

- [ ] Tests: `parses server status`, `preview never shows as confirmed`, `offline shows last confirmed state`
- [ ] Implementieren, `mise run check`, Commit `feat(web): mirror season pass status`

### Task 7 (Phase C, blockiert): Pass-Übersicht im Ingame-Menü

**Files:** `apps/web/index.html` (neuer Tab „Saison" neben den vorhandenen `role="tab"`), `apps/web/src/ui/seasonPanel.ts` + Test, `apps/web/e2e/season-pass.spec.ts`

- [ ] Panel zeigt Stufen, aktuelle Stufe, Punkte bis zur nächsten Stufe und Restlaufzeit. Ohne aktive Saison steht dort „Keine aktive Saison".
- [ ] Bedienung per Tastatur wie die vorhandenen Tabs (`gameMenu.ts` `mountTabs`), Fahrt läuft bei geöffnetem Menü weiter.
- [ ] Fahrtzusammenfassung: Hinweis „Saisonstufe n erreicht" nur bei bestätigtem Aufstieg.
- [ ] E2E (Sim-Modus): Menü öffnen → Tab „Saison" per Pfeiltaste → Inhalte sichtbar, Fahrt-HUD zählt weiter. Visueller Test des Panels.
- [ ] `mise run check` grün; Commit `feat(web): add season pass menu panel`; Roadmap-Checkbox und Spec-Status aktualisieren.
