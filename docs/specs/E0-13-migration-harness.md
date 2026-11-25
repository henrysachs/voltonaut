# Spec E0-13 – Gemeinsamer Harness für Migrations-Upgrades

- **Roadmap-Bezug:** E0 (Leitplanken/Verifikation), keine eigene Checkbox; reiner Test-Refactor
- **Status:** Review
- **Betroffene Module:** `apps/server/src/testing`, `apps/server/src/database` (nur Tests), Tests in `apps/server/src/{economy,auth,rides}` und `admin.test.ts`

## Ziel

Jeder Upgrade-Test öffnet eine echte SQLite-Datei an einem benannten Migrations-Tag, legt Altbestand über einen Hook an, migriert auf den Kopfstand und prüft Altbestand und neue Invarianten. Eine neue Migration ändert keinen bestehenden Test mehr.

## Ausgangslage

- Sieben Kopien von „die ersten N Journal-Einträge in ein Temp-Verzeichnis kopieren“ (`owned-`, `membership-`, `ledger-`, `strava-migrations*`, `database.test.ts`/`legacy-account.ts`, `replay-upgrade.spec.ts`), adressiert per Index statt Tag.
- Die Kopfzahl `toHaveLength(13)` stand in sieben Tests; jede Migration änderte alle.
- Datenbanken wurden teils mit rohem `migrate` ohne `foreign_keys`/WAL, teils mit `createDatabase` geöffnet.
- Positionsabhängige `INSERT INTO <tabelle> VALUES (…)` brachen bei jeder Spaltenänderung.
- Fünf Economy-Tests starteten Magic-Link-Login nur für eine Nutzer-ID.

## Abnahmekriterien

- [x] AK1 – `apps/server/src/testing/migration-harness.spec.ts` bietet `upgradeFrom(tag, seed)`: Datei-DB über `createDatabase` an `tag`, prüft genau die Journal-Einträge bis `tag`, führt `seed` aus, schließt; `open()` migriert auf den Kopfstand, prüft per `expectHead` alle Journal-Einträge und lässt sich erneut öffnen.
- [x] AK2 – Unbekannte Tags werfen sofort (`test: unknown migration tag …`).
- [x] AK3 – Temp-Verzeichnisse (`scratchDirectory`) und offene Verbindungen werden über `onTestFinished` auch bei Fehlschlag entfernt bzw. geschlossen.
- [x] AK4 – `seedOwners` legt `users` über die Spaltennamen des echten Drizzle-Schemas an und schreibt nur Spalten, die seit `0000` existieren; damit funktioniert es an jedem Tag.
- [x] AK5 – Keine Kopie der Journal-Schneidelogik und kein `toHaveLength(<Migrationszahl>)` mehr in `apps/server/src`; kein `INSERT INTO users` außerhalb des Harness in den migrierten Dateien; positionsabhängige `INSERT … VALUES` in migrierten Dateien sind benannt.
- [x] AK6 – Jede bisherige Upgrade-Garantie bleibt assertiert: Altzeilen byte-gleich, neue Spalten/Defaults, FKs, CHECKs, Trigger, Chiffrate entschlüsselbar, Reopen.
- [x] AK7 – Economy-Tests (`grant`, `debit`, `indexes`, `range-validation`, `transaction`) säen den Eigentümer direkt statt per Login. Sie rufen nur `EconomyService`/`OperatorGrants` mit einer ID auf und prüfen keine Session.
- [x] AK8 – Nachweis „neue Migration ändert keinen alten Test“: siehe unten.

## Nachweis AK8

Kopfstand und Kopfzahl stammen ausschließlich aus `apps/server/drizzle/meta/_journal.json` (`headMigrations()`); Tests vergleichen `__drizzle_migrations.created_at` mit den `when`-Werten des Journals. Alte Startpunkte sind Tags, die sich durch eine neue Migration nicht verschieben.

Probelauf (nicht committet, 25.11.2026): Ein zusätzlicher Journal-Eintrag `0013_scratch_probe` mit `CREATE TABLE scratch_probe` wurde ergänzt. Alle sieben Upgrade-Testdateien (15 Tests) liefen unverändert grün. Rot wurde nur `database.test.ts` → „creates owned tables…“, dessen ausdrückliche Tabellenliste die neue Tabelle meldet. Das ist gewollt: Eine neue Tabelle soll bewusst in die Liste aufgenommen werden. Danach wurde der Probelauf zurückgesetzt.

## Testplan (`docs/10-testing.md` §5 „Datenbankmigrationen“)

| AK      | Ebene              | Datei                                                                                        |
| ------- | ------------------ | -------------------------------------------------------------------------------------------- |
| AK1–AK4 | Integration Server | `apps/server/src/testing/migration-harness.spec.ts` (genutzt von allen Upgrade-Tests)        |
| AK6     | Integration Server | `apps/server/src/database/*-migrations.test.ts`, `database.test.ts`, `rides.upgrade.test.ts` |
| AK7     | Integration Server | `apps/server/src/economy/economy.{grant,debit,indexes,range-validation,transaction}.test.ts` |

## Nicht-Ziele

- Keine Änderung an Migrations-SQL, Journal, Snapshots oder Schema.
- Strava-Lieferungs-/Scheduler-Tests (`apps/server/src/strava/**`) bleiben unverändert, um den parallelen Strava-Refactor nicht zu kollidieren; ihre `INSERT INTO users` stellt ein Folge-PR auf `seedOwners` um.
- Economy-Tests mit HTTP-Session (`economy.test.ts`, `economy.persistence.test.ts`, `inventory`, `progress`) behalten den Login, weil sie Bearer-Sessions prüfen.

## Offene Fragen / Risiken

- `seedOwners` schreibt nur die Ursprungsspalten. Bekommt `users` eine neue NOT-NULL-Spalte ohne Default, muss der Harness sie ergänzen (eine Stelle statt ~15).
- Harness-Dateien enden auf `.spec.ts` und laufen nicht als eigene Testdateien; sie werden über die Upgrade-Tests ausgeführt.

## Doku-Updates

- [ ] Roadmap-Checkbox (keine) · [x] `docs/10-testing.md` · [ ] ADR (keine Entscheidung/Leitplanke/Abhängigkeit)
