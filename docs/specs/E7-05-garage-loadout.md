# Spec E7-05 – Besessene Items dauerhaft ausrüsten und in der Fahrt zeigen

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E7, Checkbox „`inventory/` + `POST /v1/shop/purchase` (atomar), Ausrüsten nur besessener Items“
- **Issue:** #65 · Abhängigkeiten: [E7-02](E7-02-server-inventory-shop.md) (Inventar), #133 (Private-API-Routen, gemergt). Showroom, Orbit und Fotomodus sind #122.
- **Status:** In Arbeit
- **Betroffene Module:** `packages/shared`, `packages/rules`, `apps/server/src/inventory`, `apps/web/src/{sync,ui/garage,world,avatar}`. Keine neue Abhängigkeit.

## Ziel

Ein angemeldeter Fahrer rüstet in der Garage besessene Items und Farben aus. Der Server speichert die Ausrüstung pro Konto. Sie erscheint am Fahrer in der laufenden Fahrt, nach Reload und auf einem zweiten Browser gleich. Gäste behalten die reine Vorschau.

## Entscheidungen

- **Start gegen `main` trotz offener Refactors (Auftraggeber, 25.11.2026).** #134 (Konto-Scope) und #124 (Render-Worker) sind offen und berühren dieselben Dateien. Konflikte werden beim Merge gelöst, nicht durch Warten.
- **Eigener Branch `claude/garage-loadout-65`** (Auftraggeber, 25.11.2026), damit PR #126 nicht um dieses Feature wächst.
- **Farben gehören zum Katalog.** Die Vorschau-Paletten ziehen von `apps/web/src/ui/garage/palettes.ts` nach `packages/rules`, damit Server und Garage dieselben Farben prüfen. `barTapeColor` hat keine Palette und wird von der Garage nicht angeboten; eine Ausrüstung mit `barTapeColor` wird abgewiesen.
- **Migrationsnummer.** Diese Spec legt die nächste freie Migration auf `main` an. Wird PR #126 (Migration `0013_volts_grant_operators`) vorher gemergt, wird die Loadout-Migration vor dem Merge neu generiert.

## Abnahmekriterien

- [ ] AK1 – Shared-Verträge sind strikt: `LoadoutResponseSchema` `{ loadout, updatedAt: string | null }`, `LoadoutUpdateSchema` `{ loadout }`. Unbekannte Felder und ungültige Farbformate werden abgewiesen. Neuer Fehlercode `not_owned`.
- [ ] AK2 – `decideLoadout(config, ownedItemIds)` in `packages/rules` lehnt jedes nicht besessene Item in jedem der sieben Slots ab (`not_owned` mit Item-IDs) und jede Farbe außerhalb der Slot-Palette (`invalid_colors`). Property-Test: Eine Konfiguration aus Katalogfarben ist genau dann gültig, wenn sie nur besessene Items enthält. Mutation in `packages/rules` bleibt grün.
- [ ] AK3 – `PUT /v1/me/loadout` mit nicht besessenem Item ergibt `409 not_owned` ohne Schreibzugriff, mit fremder Farbe `422`. Fehlende Session und falscher Origin werden abgewiesen. Ein gekauftes Item lässt sich direkt danach ausrüsten.
- [ ] AK4 – Ohne gespeicherte Ausrüstung liefert `GET /v1/me/loadout` `DEFAULT_AVATAR_CONFIG` mit `updatedAt: null`. Die Migration lässt bestehende Konten, Inventar und Volts unverändert (Migrationstest).
- [ ] AK5 – Der Kontoexport enthält die Ausrüstung (`schemaVersion` 4). Die Kontolöschung entfernt sie. Späte Schreibversuche nach der Löschung scheitern an den Triggern.
- [ ] AK6 – Die Garage zeigt pro Item _ausgerüstet_, _besessen_ („Ausrüsten“), _käuflich_ (Kauf mit Bestätigung, sobald #126 gemergt ist; sonst wie bisher) oder _gesperrt_ (Grund aus `itemUnlockText`). Farbwechsel an einem besessenen Item sind Vorschau bis „Ausrüsten“; „Vorschau verwerfen“ kehrt zur Ausrüstung zurück. Gäste senden keinen Loadout-Request.
- [ ] AK7 – E2E angemeldet (Server gemockt): kaufen, ausrüsten, Reload, Ausrüstung bleibt. Ein zweiter Browser-Kontext mit derselben Session zeigt dieselbe Ausrüstung. Ein abgelehnter Speicherversuch zeigt den Serverstand.
- [ ] AK8 – E2E in der Fahrt: Nach dem Ausrüsten trägt der Fahrer die neue Ausrüstung. Nachweis über den Diagnosewert `data-look` (Item-IDs und Farben) im Debug-Overlay. Die Distanz läuft dabei weiter.
- [ ] AK9 – Ohne WebGL bleibt die Garage bedienbar, und das Ausrüsten funktioniert ohne Vorschau.

## Testplan (`docs/10-testing.md`)

| AK   | Ebene                       | Datei                                                                                                |
| ---- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1    | Contract                    | `packages/shared/src/api/shop.test.ts`                                                               |
| 2    | Unit, Property, Mutation    | `packages/rules/src/loadout.test.ts`, `loadout.property.test.ts`                                     |
| 3–5  | Nest-Integration, Migration | `apps/server/src/inventory/inventory.loadout.test.ts`, `accounts/account-data.test.ts`, `database/*` |
| 6    | Unit                        | `apps/web/src/ui/garage/*.test.ts`, `apps/web/src/sync/garageShop.test.ts`                           |
| 7, 9 | E2E                         | `apps/web/e2e/garage-loadout.spec.ts`                                                                |
| 8    | E2E, Unit                   | `apps/web/e2e/garage-loadout.spec.ts`, `apps/web/src/world/render-link.test.ts`                      |

## Nicht-Ziele

Kein Showroom, keine Orbit-Kamera, kein Fotomodus (#122). Keine Blender-Slot-Assets (#63). Keine Level-, Badge- oder Strecken-Freischaltung: Solche Items bleiben ohne Progression gesperrt. Keine Physikwirkung von Rahmen oder Laufrädern (offene Frage P1, v1 kosmetisch).

## Risiken

- `render.look` vor `render.ready` darf nicht verloren gehen; der Link puffert den letzten Look.
- Konflikte mit #134 und #124 beim Merge.
- Geschützte Dateien unter `fixtures/api/` nur ergänzen, nicht ändern.
