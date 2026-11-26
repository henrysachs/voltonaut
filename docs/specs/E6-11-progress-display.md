# Spec E6-11 – Bestätigten Fortschritt live und in der Historie zeigen

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E6, Volts-Ledger und automatischer Fortschritt (E6-05, E6-10)
- **Issue:** #61 · Abhängigkeiten: [E6-10](E6-10-progress-server-intake.md) (Serverannahme), [E6-05](E6-05-volts-ledger.md) (Ledger), [E6-09](E6-09-progress-outbox.md) (Outbox)
- **Status:** In Arbeit
- **Betroffene Module:** `packages/shared`, `apps/server/src/progress`, `apps/web/src/{sync,ui}`, `apps/web/index.html`. Keine neue Abhängigkeit.

## Ziel

Während einer normalen Fahrt sieht der Fahrer im HUD, wie viele Volts die Fahrt vorläufig bringt, wie viele der Server davon bestätigt hat und ob Daten ausstehen, offline warten oder fehlschlagen. Im Konto-Menü zeigt eine Historie die bestätigten Fahrtjournale mit Zeitraum und Volts. Nach einem Reload steht dort derselbe bestätigte Stand.

## Entscheidungen

- **Vorschau aus nativen Fakten mit derselben Formel.** Die HUD-Vorschau summiert `energyKj` und `elevationGainM` der Checkpoints des laufenden Journals und rechnet mit `calculateBaseRewards` aus `packages/rules`, also mit derselben Formel wie der Server. Das Tageslimit kennt nur der Server, deshalb heißt der Wert ausdrücklich „vorläufig“. Der Client summiert Fließkommawerte in einer anderen Reihenfolge als der Server; an einer Rundungsgrenze kann die Vorschau um 1 Volt abweichen.
- **Bestätigt heißt: eine Quittung vom Server.** Bestätigte Volts sind die Summe von `awardedVolts` aus den `VoltsRideRangeReceipt`s des laufenden Journals, je `entryId` nur einmal gezählt. Ohne Quittung zeigt das HUD „–“ und nie einen geschätzten Wert.
- **Sim bleibt Vorschau.** Sim wird nie erfasst (E6-07). Für Sim zeigt das HUD die Vorschau mit dem Status „Sim – keine Serverbuchung“.
- **Historie pro Journal.** `GET /v1/me/progress-history` liefert die neuesten 20 Journale (absteigend nach Anlage, Cursor `before`) aus `ride_progress_journals` mit den Summen der gespeicherten Range-Quittungen. Die Tabellen gehören `progress`; das Ledger wird nicht direkt gelesen.

## Abnahmekriterien

- [ ] AK1 – Shared-Vertrag `ProgressHistoryResponseSchema` ist strikt: `{ journals: ProgressHistoryJournal[] (max 20), nextCursor: string | null }`. Ein Journal hat `journalId`, `routeId`, `startedAt`, `lastConfirmedAt` (ISO), `confirmedTicks`, `rangeCount ≥ 1`, `rewardDays` (sortiert, eindeutig), `awardedVolts`, `withheldVolts` und `candidateVolts` mit `awarded + withheld = candidate`.
- [ ] AK2 – `GET /v1/me/progress-history` verlangt eine Session, liefert nur eigene Journale, absteigend und mit stabiler Seitengrenze über `before`. Ein ungültiger Cursor oder ein unbekannter Parameter ergibt `422`. Fremde Journale und Journale ohne gespeicherte Range erscheinen nicht.
- [ ] AK3 – `ProgressLive` (Web) leitet aus Checkpoints, Quittungen und dem Sync-Zustand eine Anzeige ab: `previewVolts` wächst mit jedem Checkpoint des laufenden Journals. Ein neues Journal setzt die Werte zurück. `confirmedVolts` ändert sich nur durch Quittungen dieses Journals, und eine doppelt gelieferte Quittung zählt einmal. Status: `sim`, `guest`, `off` (keine aktive Zustimmung oder Fahrt vor der Zustimmung begonnen), `pending`, `syncing`, `offline`, `failed`, `confirmed`.
- [ ] AK4 – Das HUD (`hud-volts`) zeigt Vorschau, bestätigten Wert und Status während der Fahrt. Im Sim-E2E steigt der Vorschauwert, während die Distanz läuft.
- [ ] AK5 – Die Historie im Konto-Menü zeigt pro Journal Datum, Zeitraum, bestätigte und zurückgehaltene Volts. Nach einer neuen Quittung wird sie neu gelesen. Bei einem Fehler erscheint „Historie nicht erreichbar“ ohne erfundene Werte. Gäste senden keinen Request. E2E mit gemocktem Server: Die Historie und der Kontostand sind nach einem Reload gleich.
- [ ] AK6 – Keine erfundenen Kontostände: Ohne Serverantwort zeigt weder HUD noch Historie bestätigte Volts (Unit-Tests für Fehler, Timeout und Kontowechsel).

## Testplan (`docs/10-testing.md`)

| AK  | Ebene            | Datei                                                                    |
| --- | ---------------- | ------------------------------------------------------------------------ |
| 1   | Contract         | `packages/shared/src/api/progressHistory.test.ts`                        |
| 2   | Nest-Integration | `apps/server/src/progress/progress.history.test.ts`                      |
| 3   | Unit             | `apps/web/src/sync/progressLive.test.ts`                                 |
| 4   | Unit, E2E        | `apps/web/src/ui/hudVolts.test.ts`, `e2e/progress-live.spec.ts`          |
| 5–6 | Unit, E2E        | `apps/web/src/sync/progressHistory.test.ts`, `e2e/progress-live.spec.ts` |

## Nicht-Ziele

- Kein XP, kein Level, kein Season Pass in der Anzeige (E6-06).
- Keine Anzeige des Tagesrestbudgets vor der Quittung. Kein neuer Ledger-Endpunkt für Käufe oder Operator-Gutschriften.
- Keine Hardwareabnahme. Echte BLE-Fahrten mit Serverbuchung sind softwareseitig über Unit-Tests belegt, nicht an echter Hardware.

## Risiken

- `progressSync.ts` ist bereits groß; die Änderung beschränkt sich auf eine Quittungs-Rückmeldung und den Journalzustand.
- Die Outbox purgt gespeicherte Zeilen; nach einem Reload kommt der bestätigte Stand deshalb aus der Serverhistorie, nicht aus dem Browser.

## Doku-Updates (Pflicht beim Abschluss)

- [ ] Roadmap-Unterpunkt E6-11 · [ ] `docs/08-backend.md` (Endpunkt) · [ ] `docs/06-gamification.md` (Anzeige)
