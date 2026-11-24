# Spec E6-05 – Season Pass

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E6, Unterpunkt „Season Pass"
- **Issue:** #44
- **Plan:** `docs/superpowers/plans/2026-11-24-season-pass.md`
- **Status:** In Arbeit (Phase A)
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

- [ ] AK1 – `SeasonDefinitionSchema` in `packages/shared` validiert eine Saison: ID `season-NN`, Dauer 56 bis 84 Tage, mindestens 20 Stufen, Stufen 1..n lückenlos, Schwellen streng steigend und größer 0, Belohnungen `item` oder `volts`, keine Zusatzfelder.
- [ ] AK2 – `UnlockRuleSchema` kennt `{ kind: "season"; seasonId; tier }`. Die Garage zeigt dafür „Saison <ID> · Stufe <n>".
- [ ] AK3 – Saisonpunkte = Basis-XP (`calculateBaseXp(...).total`). Je bestätigtem Abschnitt zählt die Differenz der kumulierten Fahrtpunkte, sodass die Rundung der ganzen Fahrt erhalten bleibt.
- [ ] AK4 – Ein Abschnitt zählt, wenn `Start ≤ Abschnittszeit < Ende`. Maßgeblich ist die Fahrzeit, nicht die Bestätigungszeit.
- [ ] AK5 – `dueTiers(a, b)` liefert genau die Stufen mit `a < Schwelle ≤ b`. Für `a ≤ b ≤ c` gilt `dueTiers(a, b) ++ dueTiers(b, c) = dueTiers(a, c)` (Property-Test).
- [ ] AK6 – `season-01`: 4.1.2027 bis 15.3.2027, 20 Stufen zu je 1 800 Punkten (⚠️ Startwert). Jede Item-Belohnung verweist auf ein Katalog-Item mit passender Saison-Freischaltung und umgekehrt.
- [ ] AK7 – Keine `Date.now()` in `packages/rules`. `mise run check` und `mise run check:mutation` sind grün.

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

- Saisonpunkte: Annahme 1:1 aus Basis-XP. Alternativen wären eigene Punkte pro km/Hm oder Wochenaufgaben. Henry bestätigt.
- Saisonlänge und Stufenzahl: Annahme 10 Wochen und 20 Stufen. Bei drei Stundenfahrten pro Woche (rund 1 250 XP je Fahrt) wird die letzte Stufe knapp erreicht.
- Premium-Track: nicht vorgesehen. Bräuchte eine eigene ADR.
- Maps als Belohnung: nur vorbereitet, weil sich die Belohnungsarten erweitern lassen.

## Doku-Updates

- [ ] Roadmap-Unterpunkt · [ ] `docs/06-gamification.md` Abschnitt „Season Pass"
