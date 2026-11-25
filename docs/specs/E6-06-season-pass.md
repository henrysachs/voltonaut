# Spec E6-06 – Season Pass

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E6, Unterpunkt „Season Pass"
- **Issue:** #44
- **Plan:** `docs/superpowers/plans/2026-11-24-season-pass.md`
- **Status:** Phase A softwaregeprüft, Review offen; Phase B/C blockiert
- **Betroffene Module:** `packages/shared`, `packages/rules`, `apps/web/src/ui/garage` (Freischalttext); später `apps/server`, `apps/web/src/sync`

## Ziel

Eine zeitlich begrenzte Saison gibt regelmäßigem Fahren ein eigenes Ziel. Wer in der Saison fährt, steigt Stufen auf und schaltet exklusive Belohnungen frei: kosmetische Items und Volts-Boni. Verdiente Items bleiben nach Saisonende im Inventar.

## Phasen

| Phase | Inhalt                                                                      | Voraussetzung                                                 |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A     | Schemas, reine Rechenlogik, erste Saison als Daten, Saison-Items im Katalog | keine                                                         |
| B     | Serverseitiger Saisonstand, einmalige Vergabe, Client-Spiegel               | E6 bestätigte Fahrtabschnitte (#59), E7 Server-Inventar (#64) |
| C     | Pass-Übersicht im Ingame-Menü, Hinweis in der Fahrtzusammenfassung          | Phase B                                                       |

## Abnahmekriterien

Phase A:

- [x] AK1 – `SeasonDefinitionSchema` in `packages/shared` validiert eine Saison: ID `season-NN`, Dauer 56 bis 84 Tage, mindestens 20 Stufen, Stufen 1..n lückenlos, Schwellen streng steigend und größer 0, Belohnungen `item` oder `volts`, keine Zusatzfelder.
- [x] AK2 – `UnlockRuleSchema` kennt `{ kind: "season"; seasonId; tier }`. Die Garage zeigt dafür „Saison <NN> · Stufe <n>" (z. B. „Saison 01 · Stufe 12").
- [x] AK3 – Saisonpunkte = Basis-XP (`calculateBaseXp(...).total`). Je bestätigtem Abschnitt zählt die Differenz der kumulierten Fahrtpunkte, sodass die Rundung der ganzen Fahrt erhalten bleibt.
- [x] AK4 – Ein Abschnitt zählt ganz, wenn `Saisonstart ≤ Abschnittsbeginn < Saisonende`. Abschnittsbeginn ist die Fahrzeit, zu der der bestätigte Abschnitt beginnt (`sectionAtMs`), nicht die Bestätigungs- oder Uploadzeit. Ein Abschnitt, der kurz vor Saisonende beginnt und danach endet, zählt also vollständig. Bestätigte Abschnitte sind kurz.
- [x] AK5 – `dueTiers(a, b)` liefert genau die Stufen mit `a < Schwelle ≤ b`. Für `a ≤ b ≤ c` gilt `dueTiers(a, b) ++ dueTiers(b, c) = dueTiers(a, c)` (Property-Test).
- [x] AK6 – `season-01`: 4.1.2027 bis 15.3.2027, 20 Stufen zu je 1 800 Punkten (⚠️ Startwert). Jede Item-Belohnung verweist auf ein Saison-Item (`SEASON_AVATAR_ITEMS`: `jersey.season-01` ab Stufe 10, `wheels.season-01` ab Stufe 20) mit passender Saison-Freischaltung und umgekehrt. Die Saison-Items gehören nicht zum dokumentierten Start-Katalog. Die Garage zeigt sie erst mit Phase C.
- [ ] AK7 – Keine `Date.now()` in `packages/rules`. Lint, Typecheck, depcruise, guard, Unit-Tests und Stryker (`season.ts`, `seasonData.ts`: 100 %) sind einzeln grün. `mise run check` als Ganzes und CI stehen aus.

Phase B und C: Kriterien aus Issue #44 (Vergabe genau einmal, Sim-Fahrten ohne Fortschritt, Items bleiben, Menü per Tastatur). Sie werden präzisiert, sobald die Voraussetzungen auf `main` liegen.

## Testplan (`docs/10-testing.md`)

| AK      | Ebene          | Datei                                                                                    |
| ------- | -------------- | ---------------------------------------------------------------------------------------- |
| AK1     | Unit           | `packages/shared/src/season.test.ts`                                                     |
| AK2     | Unit           | `packages/shared/src/avatarCatalog.test.ts`, `apps/web/src/ui/garage/garageText.test.ts` |
| AK3–AK5 | Unit, Property | `packages/rules/src/season.test.ts`, `season.property.test.ts`                           |
| AK6     | Unit           | `packages/rules/src/seasons.test.ts`                                                     |
| AK7     | Mutation       | `mise run check:mutation`                                                                |

## Nicht-Ziele

Keine Echtgeld-Käufe, kein Premium-Track, keine Maps als Belohnung, kein Stufenkauf mit Volts. In Phase A keine Vergabe, keine Kontobuchung und keine Anzeige im Menü.

## Offene Fragen / Risiken

- Voraussetzung für Phase B/C: `avatarItemsForSlot` und `avatarItemForSlot` durchsuchen nur `START_AVATAR_CATALOG`. Bevor ein Saison-Item vergeben oder ausgerüstet werden kann, müssen sie auch `SEASON_AVATAR_ITEMS` kennen. Sonst wirft das Ausrüsten „Missing avatar item“.

- Voraussetzung für Phase B: Volts-Boni bucht ausschließlich `EconomyService` aus `volts_ledger` ([E6-05](E6-05-volts-ledger.md), [ADR-027](../decisions/ADR-027-server-volts-ledger.md)). Das Ledger kennt bisher nur die Schlüssel `ride:` und `purchase:`; Saisonbelohnungen brauchen ein eigenes Schema (Vorschlag `season:<seasonId>:<tier>`) und eine Buchungsart ohne Fahrtbereich.
- Entschieden (Henry, 25.11.2026): Saison-Volts zählen **nicht** gegen das Tageslimit. Die Buchung darf also nicht über den Fahrtbereich mit Tagesbudget laufen. Das Tageslimit selbst soll später erhöht werden; das ist ein eigener Schritt.

- Saisonpunkte: Annahme 1:1 aus Basis-XP. Alternativen wären eigene Punkte pro km/Hm oder Wochenaufgaben. Henry bestätigt.
- Saisonlänge und Stufenzahl: Annahme 10 Wochen und 20 Stufen. Bei drei Stundenfahrten pro Woche (rund 1 250 XP je Fahrt) wird die letzte Stufe knapp erreicht.
- Premium-Track: nicht vorgesehen. Bräuchte eine eigene ADR.
- Maps als Belohnung: nur vorbereitet, weil sich die Belohnungsarten erweitern lassen.

## Doku-Updates

- [ ] Roadmap-Unterpunkt · [ ] `docs/06-gamification.md` Abschnitt „Season Pass"
