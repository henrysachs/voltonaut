# Spec E7-04 – Operator jeder Volts-Gutschrift festhalten

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E7
- **Issue:** #116 · Abhängigkeit: [E7-02](E7-02-server-inventory-shop.md) · **ADR:** [ADR-031](../decisions/ADR-031-server-inventory-and-operator-grant.md), Punkt 6
- **Status:** Implementiert und softwaregeprüft (Integration, Migration, kompiliertes CLI). Merge und Bereitstellung offen.
- **Betroffene Module:** `packages/shared` (Gutschrift-Vertrag), `apps/server/src/{economy,admin.ts}`, Migration `0013`. Keine neue Abhängigkeit, kein Web-Endpunkt.

## Ziel

Jede Gutschrift aus `admin credit` ist auf einen Operator zurückführbar, auch bei mehreren Operatoren oder einem kompromittierten Deploy-Zugang.

## Entscheidung (Henry, 25.11.2026)

Der Operator ist ein **bestehendes Konto mit Rolle `admin`**, angegeben als Pflichtparameter `--operator <adminUserId>`. Eine Ableitung aus `SUDO_USER` oder dem Host-Login scheidet aus, weil der Befehl im Server-Container läuft.

## Abnahmekriterien

- [x] AK1 – `admin credit --operator <adminUserId> <userId> <volts> <reference>`. Ohne `--operator` wird der Befehl abgewiesen, ebenso mit einem Operator, der nicht existiert, gelöscht ist oder keine Admin-Rolle hat. Dann wird nichts gebucht.
- [x] AK2 – Die Tabelle `volts_grant_operators` hält je Gutschrift Operator und Herkunft fest, in derselben Transaktion wie die Buchung. SQLite erzwingt: `recorded` nur mit Operator, `unknown_before_audit` nur ohne; Einträge sind unveränderlich; ein gelöschtes Operator-Konto wird abgewiesen.
- [x] AK3 – Wiederholt ein anderer Operator dieselbe Referenz, ist das `409 ledger_conflict`. Derselbe Operator erhält den gespeicherten Beleg mit Operator.
- [x] AK4 – Migrationstest: Bestehende Gutschriften und Buchungen bleiben unverändert und sind als „Operator unbekannt (vor Einführung)“ (`unknown_before_audit`) markiert, nicht nachträglich erfunden.
- [x] AK5 – Der Kontoexport des gutgeschriebenen Kontos enthält den Operator nicht. Löscht dieses Konto seine Daten, entfernt die Kontolöschung die Audit-Einträge vor dem Journal. Der Verweis hat keine Kaskade, damit ein künftiger Neubau von `volts_ledger` sichtbar scheitert, statt das Audit still zu leeren.

## Testplan

| AK            | Ebene             | Datei                                                                                            |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| AK1           | Integration (CLI) | `apps/server/src/admin.test.ts`                                                                  |
| AK2, AK3, AK5 | Integration       | `apps/server/src/economy/economy.grant.test.ts`, `apps/server/src/accounts/account-data.test.ts` |
| AK4           | Migration         | `apps/server/src/database/grant-operator-migrations.test.ts`                                     |

## Nicht-Ziele

Keine Gegenbuchung, kein Web-Endpunkt, keine Anzeige des Operators im Kontoexport.
