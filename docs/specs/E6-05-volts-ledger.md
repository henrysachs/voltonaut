# Spec E6-05 – Atomares Volts-Ledger

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E6, Checkbox „`economy/`: Volts-Ledger, Verdienformel, Tageslimit".
- **Status:** Erledigt (softwaregeprüft; Merge/CI ausstehend).
- **Betroffene Module:** `packages/shared`, `packages/rules`, `apps/server/src/economy`, Dokumentation. Keine neue externe Abhängigkeit.

## Ziel

Der Server besitzt ein unveränderliches SQLite-Journal für Volts. Zusammenhängende kumulative Fahrtabschnitte sowie Abbuchungen werden idempotent und atomar gebucht; Kontostand und verbleibendes Tagesbudget werden ausschließlich aus dem Journal abgeleitet.

Die Einheit ist die Grundlage für spätere Checkpoint-Freigabe und Shop-Käufe. Sie aktiviert weder automatische Fahrtbelohnungen noch einen Kaufendpunkt.

## Gewählte Form

`economy/` besitzt die Tabelle `volts_ledger` und den einzigen Schreibzugriff darauf. Es gibt keine mutable Wallet-Spalte. Jede Buchung hat einen eindeutigen Owner-/Idempotenzschlüssel und einen Hash des fachlichen Auftrags. Abweichende Wiederholungen sind ein Konflikt statt einer zweiten Buchung.

Alle Schreiboperationen laufen in einer unmittelbaren SQLite-Transaktion. `EconomyService.transaction` stellt späteren Modulen ein schmales Ledger-Transaktionsport bereit, damit Inventar und Volts-Abbuchung in einer gemeinsamen Transaktion committen oder rollen.

Ein Belohnungsauftrag enthält den kumulierten `RewardFacts`-Satz bis `endTick`. Das Ledger speichert die kumulierten Volts-Komponenten und bucht nur die Differenz zum vorherigen Abschnitt. Die Summe aller Abschnitte entspricht exakt der einmaligen Rundung der Gesamtfahrt. Abschnitte müssen lückenlos zusammenhängen; Lücken, Überlappungen, rückläufige Fakten und zurückliegende Belohnungstage werden abgewiesen. Ein Journal gehört global genau einem Konto. Der UTC-Belohnungstag ist ein expliziter, validierter Eingang. Die endgültige Mitternachts-, Bereichsgrößen- und Checkpunkt-Politik bleibt Issue #56 vorbehalten.

[ADR-027](../decisions/ADR-027-server-volts-ledger.md) erlaubt die direkte Rules-Abhängigkeit des Servers. Eine zusätzliche TypeScript-Projektreferenz ist nicht vorgesehen.

## Abnahmekriterien

- [x] AK1 – Shared validiert Volts-Beträge, Delta, Idempotenzschlüssel, UTC-Belohnungstag, Befehle und Belege strikt. Typen sind schemaabgeleitet; ungültige, unsichere oder unerlaubte Werte werden abgewiesen.
- [x] AK2 – `volts_ledger` ist additiv migriert, gehört zum Konto und erzwingt Idempotenz sowie metadatenabhängige SQLite-Checks. Bestehende Nutzer, Fahrten und Aufnahmen bleiben unverändert.
- [x] AK3 – Der Kontostand ist die Summe aller Buchungen und nie negativ. Reine Delta-Anwendung und Property-Tests belegen die Invariante.
- [x] AK4 – Zusammenhängende kumulative Bereiche teleskopieren exakt zur Ganzfahrt-Rundung. Identische Wiederholung liefert denselben unveränderlichen Beleg; Lücke, Überlappung, Roh- und Volt-Regression, Tagesrückschritt und fremdes Journal werden ohne Buchung abgewiesen.
- [x] AK5 – Eine Abbuchung prüft Guthaben und Buchung in derselben Transaktion. Zu wenig Guthaben verändert nichts; identische Wiederholung bucht nicht doppelt; Konflikte rollen zurück.
- [x] AK6 – Ein Journal gehört genau einem Konto. Tageslimit 3000 und Guthaben gelten kontoweit; zwei echte SQLite-Verbindungen belegen Serialisierung und `SQLITE_BUSY` bei konkurrierender Schreibtransaktion.
- [x] AK7 – Reload und SQLite-Neustart erhalten Journal, Kontostand und Idempotenz. `GET /v1/me/volts` erfordert eine Session und liefert `no-store`.
- [x] AK8 – Vollständiges Gate, Build und Mutation sind grün; ein unabhängiger Review bestätigt Spec und State-Ownership.

## Testplan (`docs/10-testing.md`)

| AK  | Ebene                          | Datei / Fixture                                                                                                                                                             |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Vitest, Shared-Verträge        | `packages/shared/src/economy.test.ts`                                                                                                                                       |
| 3   | Vitest, Property               | `packages/rules/src/voltsLedger.test.ts`, `voltsFacts.test.ts`                                                                                                              |
| 2   | Migration, echte SQLite        | `apps/server/src/database/*migrations.test.ts`, `economy.persistence.test.ts`, `economy.indexes.test.ts`                                                                    |
| 4–7 | Nest-Integration, echte SQLite | `economy.test.ts`, `economy.range-validation.test.ts`, `economy.debit.test.ts`, `economy.persistence.test.ts`, `economy.transaction.test.ts`, `economy.concurrency.test.ts` |
| 8   | Statik, Gate, Build, Mutation  | `mise run check`, `mise run build`, `mise run check:mutation`                                                                                                               |

## Nicht-Ziele

- Keine Checkpoint-Transport-, Quellen-, Mitternachts- oder Offline-Politik (#56–#59).
- Keine automatische Belohnungsfreigabe und keine Nachbewertung bestehender Fahrten.
- Kein Shop-Kaufendpunkt, Inventar, Preisfreigabe oder Ausrüsten (#64).
- Keine Web3-, Crypto-, Wallet- oder Blockchain-Komponente.
- Keine UI-, Hardware- oder Produktionsfreigabe.

## Offene Fragen / Risiken

- Die spätere Fahrtannahme muss kumulative Fakten in nativer Tickreihenfolge und einen serverseitig gewählten Belohnungstag je Bereich liefern.
- Bereiche sollten aus Effizienzgründen deutlich größer als ein einzelner E6-04-Checkpoint sein; die endgültige Größe entscheidet Issue #56.
- SUM-Abfragen skalieren mit dem Journal; für den kleinen Freundeskreis ist das bewusst gewählt. Bei Bedarf kann später ein geprüfter Lese-Cache hinzukommen, ohne das Journal zur Wahrheit zu machen.
- Produktive API-Deploys und echte Hardware bleiben gesondert freizugeben.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Roadmap-Checkbox
- [x] `docs/06-gamification.md`
- [x] `docs/08-backend.md`
- [x] `docs/dependencies.md`
- [x] ADR-027
