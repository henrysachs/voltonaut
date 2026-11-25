# Spec E7-02 – Server-Inventar und atomare Shop-Käufe

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E7, Checkbox „`inventory/` + `POST /v1/shop/purchase` (atomar), Ausrüsten nur besessener Items"
- **Issue:** #64 · Abhängigkeiten: [E6-05](E6-05-volts-ledger.md) (Volts-Ledger), [E7-01](E7-01-garage-shop-foundation.md) (Garage/Shop-Fundament)
- **ADR:** [ADR-031](../decisions/ADR-031-server-inventory-and-operator-grant.md)
- **Status:** Implementiert und softwaregeprüft (Unit, Integration, Mutation `rules`, E2E im Gastmodus). Merge, Bereitstellung und Henrys Abnahme mit echten Volts offen.
- **Betroffene Module:** `packages/shared`, `packages/rules`, `apps/server/src/{economy,inventory}`, `apps/web/src/{sync,ui/garage}`. Keine neue externe Abhängigkeit.

## Ziel

Angemeldete Fahrer kaufen Items aus dem Start-Katalog mit Volts. Der Server prüft Katalog, Preis und Besitz, bucht die Volts ab und trägt das Item in einem einzigen SQLite-Commit ins Inventar ein. Die Garage zeigt Kontostand und Besitz vom Server, nach Reload und in jedem Browser gleich. Das dauerhafte Ausrüsten bleibt #65.

## Entscheidungen (Henry über den Auftraggeber, 25.11.2026)

- **Mindestlevel vorerst nicht geprüft.** Der Server kennt noch keine Level, weil XP/Progression fehlen. Bis zur Progression sind alle Shop-Items bei genug Volts kaufbar. Die Prüfung kommt mit der Progression; Code und Doku markieren das als Übergang.
- **Operator-Gutschrift per CLI.** Volts lassen sich noch nicht verdienen (#59). Für Tests und Henrys Abnahme schreibt ein Admin-Befehl eine nachvollziehbare Buchung mit eigenem Grund `operator_grant` ins Volts-Journal. Es gibt keinen Web-Endpunkt dafür.

## Abnahmekriterien

- [x] AK1 – Shared validiert Kaufauftrag (`requestId` UUID, `itemId`, `expectedPriceVolts`), Kaufbeleg, Inventareintrag und Inventarantwort strikt. Neue Fehlercodes: `already_owned`, `item_not_for_sale`, `price_changed`.
- [x] AK2 – Eine reine Kaufentscheidung in `packages/rules` liefert für ein Katalog-Item: kaufbar mit Preis, `unknown_item`, `not_for_sale` (keine Shop-Freischaltung), `price_changed` (erwarteter ≠ Katalogpreis) oder `already_owned`. `minLevel` wird ausdrücklich nicht geprüft (Übergang).
- [x] AK3 – `inventory/` besitzt die additive Tabelle `inventory(user_id, item_id, source, purchase_request_id, acquired_at)` mit Primärschlüssel aus Konto und Item. Standard-Items gelten als besessen, ohne gespeichert zu werden.
- [x] AK4 – `POST /v1/shop/purchase` bucht Abbuchung und Inventareintrag in einer unmittelbaren SQLite-Transaktion. Fehlt Guthaben, ändert sich nichts (`409 insufficient_volts`). Scheitert der Inventareintrag, wird auch die Abbuchung zurückgerollt.
- [x] AK5 – Idempotenz: Dieselbe `requestId` bestätigt denselben Kauf ohne zweite Abbuchung; der Beleg nennt den aktuellen Kontostand. Ein zweiter Kauf desselben Items mit anderer `requestId` ergibt `409 already_owned`, auch bei konkurrierenden Anfragen.
- [x] AK6 – `GET /v1/me/inventory` liefert alle besessenen Items (gespeicherte und Standard-Items) mit `no-store`. Ein zweites Gerät desselben Kontos sieht denselben Besitz.
- [x] AK7 – Das Volts-Journal kennt den Grund `operator_grant` (positive Gutschrift ohne Fahrtfelder). Die Migration erhält bestehende Buchungen. Der Admin-Befehl `admin credit <userId> <volts> <reference>` schreibt genau eine idempotente Gutschrift.
- [x] AK8 – Die Garage zeigt für angemeldete Fahrer Kontostand und Besitz vom Server. „Kaufen (n ⚡)“ ist nur aktiv, wenn das Item kaufbar ist und das Guthaben reicht. Nach dem Kauf zeigt sie das Item als besessen. Gäste und Offline-Nutzer sehen weiterhin nur die Vorschau.
- [x] AK9 – Integration mit E5-11 (Kontodaten): Migration `0011_volts_operator_grant` folgt auf `0010_common_jack_flag`, legt die Lösch-Trigger für `volts_ledger` nach dem Tabellenneubau wieder an und sichert `inventory` ebenso ab. Der Kontoexport (`schemaVersion` 2) enthält gekaufte Items und Operator-Gutschriften; die Kontolöschung entfernt das Inventar.

## Testplan (`docs/10-testing.md`)

| AK      | Ebene          | Datei                                                                                                  |
| ------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| AK1     | Unit           | `packages/shared/src/api/shop.test.ts`                                                                 |
| AK2     | Unit, Mutation | `packages/rules/src/shop.test.ts`                                                                      |
| AK3–AK6 | Integration    | `apps/server/src/inventory/*.test.ts` (SQLite, Supertest)                                              |
| AK7     | Integration    | `apps/server/src/economy/economy.grant.test.ts`, Migrationstest, Admin                                 |
| AK8     | Unit           | `apps/web/src/sync/garageShop.test.ts`, `ui/garage/purchaseOffer.test.ts`, `e2e/garage-shop.spec.ts`   |
| AK9     | Integration    | `apps/server/src/database/ledger-migrations.test.ts`, `accounts/account-data.test.ts`, `admin.test.ts` |

## Nicht-Ziele

Kein dauerhaftes Ausrüsten (#65), keine Level-Prüfung, keine Rückerstattung, keine Echtgeld-Käufe, kein Web-Endpunkt für Gutschriften, keine Saison-Item-Vergabe (Season Pass Phase B).

## Offene Fragen / Risiken

- Mit der Progression muss die Kaufentscheidung das Level des Kontos bekommen; bis dahin sind Level-Items früher kaufbar als vorgesehen.
- Ein Operator-Fehler bei der Gutschrift lässt sich nur durch eine Gegenbuchung korrigieren, nicht durch Löschen.

## Doku-Updates

- [x] Roadmap (Statusabsatz; Checkbox bleibt offen bis #65) · [x] `docs/08-backend.md` · [x] ADR-031
