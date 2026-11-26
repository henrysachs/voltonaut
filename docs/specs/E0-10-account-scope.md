# Spec E0-10 – Ein Kontobereich statt fünf Veraltungsregeln

- **Roadmap-Bezug:** Architekturpflege ohne eigene Roadmap-Checkbox. Baut auf [E0-09](E0-09-private-api-routes.md) und den tokenfreien Leases aus [E5-09](E5-09-account-bound-sync.md) auf.
- **Status:** Review
- **Betroffene Module:** `apps/web/src/sync`, `apps/web/src/ui/stravaPanel*.ts`, Composition Root (`browserAccount*.ts`, `browserStrava.ts`, `main.ts`)

## Ziel

Ein Modul besitzt die Bindung aller Kontofunktionen an die aktuelle Session. Es stellt beobachtbaren Zustand bereit und entscheidet, ob ein asynchroner Schritt noch gilt. Die Kontofunktionen beschreiben nur noch ihren Zustand und ihre Aktionen. Die Oberfläche vergleicht keine Generationen mehr.

## Ausgangslage

Jeder Store implementierte `#listeners`, `subscribe`, `publish` und „patch, falls noch aktuell“ selbst. Dafür nutzte jeder einen eigenen Zähler:

- `#generation` in `ApplicationSession` und `IdentityLinks`. Nur `IdentityLinks` entfernte doppelte Generationen.
- `#revision` in `AccountAdministration` und `GarageShop`.
- `#selection` in `StravaSync`.
- `#epoch` in `ProgressSync`.
- `#sending` und `#pending`, nach `lease.generation` geschlüsselt, im Outbox-Retry von `AccountSync`.

Auch die Bindung war uneinheitlich. `StravaSync`, `IdentityLinks` und `ProgressSync` abonnierten die Session selbst. `AccountSync` reichte die Lease von Hand an `administration.bind()` und `shop.bind()` weiter. `stravaPanelText.accountAction` verglich `userId` und `generation`. `stravaPanel` prüfte zusätzlich, ob Kontospiegel und Strava-Ansicht zum selben Nutzer gehörten.

## Entscheidung

- **`accountScope.ts`** besitzt die Bindung. Jede authentifizierte Session-Generation wird genau eine Bindung `signedIn` mit eigener Lease. Logout, Kontowechsel und Kontolöschung beenden die Bindung. Ihre Lease meldet dann `current() === false`, ihr Signal wird abgebrochen. Eine wiederholte Anmeldung derselben Generation behält die Bindung. `signedOut` behält die Sessionansicht, damit `ProgressSync` frühe Checkpoints nur während einer Wiederherstellung puffert.
- **Gleichzeitige Übergänge:** `deliver` stellt Veröffentlichungen während eines Bindungswechsels zurück. Erst danach sieht ein Listener die Änderung. Kein Listener sieht so einen Store beim neuen und einen anderen beim alten Konto.
- **`accountState.ts`** ist der beobachtbare Zustand einer Kontofunktion. `enter` leitet die Ansicht für eine neue Bindung ab, `start` stößt erste Lesevorgänge an. `update(lease, …)` veröffentlicht nur, solange die Lease gilt. `guard(action)` bindet eine gerenderte Aktion an die Bindung, für die sie gerendert wurde.
- **`accountLane.ts`** ordnet konkurrierende Schritte innerhalb einer Bindung: Nur der neueste Durchgang gilt. Das ersetzt `#revision` und `#selection`.
- **Schmale Ports aus E0-09:** Der Bereich ist über die Lease typisiert. Jeder Store folgt ihm mit genau seinen Ports (`AccountSyncLease`, `MembershipLease`, `ShopLease`, `StravaLease`, `ProgressLease`, `IdentityLinksLease`). Der Composition Root erzeugt einen einzigen `sessionAccountScope(session)`.
- **`AccountAdministration` und `GarageShop`** hängen nicht mehr an `AccountSync`. Sie folgen dem Bereich selbst und werden im Composition Root erzeugt. `AccountSyncLease` enthält deshalb weder Mitgliedschaft noch Shop.

## Bewusst eigene Semantik

- **Outbox-Zustellung (`accountOutboxRun.ts`):** Die Zustellung bleibt eine eigene Regel. Pro Bindung läuft höchstens ein Durchgang. Anfragen während eines Durchgangs werden zu einem Folgedurchgang zusammengefasst, eine manuelle Anfrage schlägt eine Wiederaufnahme. Ein `reauth` sperrt weitere Durchgänge bis zur nächsten Bindung. Das ersetzt die nach Generation geschlüsselten `#sending`- und `#pending`-Mengen. Eine neue Bindung erhält einen neuen Durchgangszustand. Ein alter Durchgang kann deshalb keinen neuen blockieren oder fortsetzen. Weiterhin gibt es genau eine IndexedDB-Outbox mit ausdrücklicher Zuordnung und keinen automatischen Upload (ADR-005/018).
- **`ProgressSync`:** Der Store folgt dem Bereich und veröffentlicht über `deliver`. Seine Journal-, Zustimmungs- und Lieferzustände (`#epoch`, Schreibzäune) bleiben unverändert. Sie hängen zusätzlich an Zustimmungsversion und Journal und lassen sich nicht auf eine Bindung reduzieren.
- **`ApplicationSession`** behält ihre Generation. Sie ist die Quelle der Bindung, kein Konsument.
- **`GarageShop`** behält offene Request-IDs bei erneuter Anmeldung desselben Kontos (ADR-031 §3). Nur ein anderes Konto verwirft sie.

## Abnahmekriterien

- [x] AK1 – `accountScope.ts` besitzt die Session-zu-Lease-Bindung. Kein Feature-Store abonniert `ApplicationSession` oder ruft `authorize()` auf. Der Composition Root erzeugt genau einen Bereich.
- [x] AK2 – Supersede, Logout und Kontolöschung sind einmal am Bereich getestet: Alte Lease nicht mehr aktuell, Signal abgebrochen, wiederholte Anmeldung derselben Generation ignoriert.
- [x] AK3 – `AccountSync`, `AccountAdministration`, `GarageShop`, `StravaSync`, `IdentityLinks` und `ProgressSync` nutzen `AccountState` beziehungsweise `deliver` statt eigener Listener-Mengen. `#revision` und `#selection` sind durch `AccountLane` ersetzt.
- [x] AK4 – `stravaPanelText.accountAction` und der `userId`-Abgleich in `stravaPanel` sind entfernt. `StravaView` enthält keine Generation mehr. Gerenderte Aktionen nutzen `StravaSync.guard`.
- [x] AK5 – Nach jedem Bindungswechsel sehen Listener alle Stores beim selben Konto (Test am Bereich).
- [x] AK6 – Feature-Tests nutzen einen In-Memory-Bereich (`testdata/scopeDriver.ts`) statt handgebauter Session-Fakes. Betroffen sind `SyncFixture`, Strava-, Shop-, Identitäts- und Progress-Fixtures. `accountAdministration.test.ts` behält die echte `ApplicationSession` hinter `sessionAccountScope`.
- [x] AK7 – Beobachtbares Verhalten unverändert: Alle bestehenden Tests zu Supersede, Logout, Löschung, Retry, Strava-Generationen und Admin-Schreibbesitz bestehen ohne geänderte Erwartung. Tokenfreie Leases, keine Tokens im Strava-Kindfenster, kein automatischer Re-POST (ADR-017/018), keine Admin-Outbox und kein automatischer Admin-Retry (ADR-021).

## Testplan (`docs/10-testing.md`)

| AK       | Ebene                      | Datei                                                                                                            |
| -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| AK1, AK2 | Unit und echte Session     | `apps/web/src/sync/accountScope.test.ts`                                                                         |
| AK3, AK5 | Unit                       | `accountScope.test.ts`, `accountOutboxRun.test.ts`                                                               |
| AK4      | Unit                       | `stravaSync.test.ts` („invalidates already-rendered actions …“)                                                  |
| AK6, AK7 | Integration mit Bereich    | `accountSync*.test.ts`, `garageShop.test.ts`, `identityLinks.test.ts`, `strava*.test.ts`, `progressSync.test.ts` |
| AK7      | Integration, echte Session | `accountAdministration.test.ts`                                                                                  |
| alle     | E2E (Sim, gemockte API)    | `apps/web/e2e/account-data.spec.ts`, `account-links.spec.ts`, `game-menu.spec.ts`                                |

## Nicht-Ziele

- Keine Änderung an Transport, Routentabelle oder `apiRoute.ts` (E0-09).
- Kein Umbau der Journal- und Zustimmungslogik in `ProgressSync`.
- Keine neue Route, keine Serveränderung.

## Offene Fragen / Risiken

- Der Shop existiert jetzt ab dem Start statt erst nach dem lokalen Profil. Die Garage erhält ihn sofort. Das ändert nur den Zeitpunkt, nicht den angezeigten Serverstand.
- An echter Hardware getestet: nein (nicht hardwarerelevant).

## Doku-Updates (Pflicht beim Abschluss)

- [x] `docs/01-architecture.md` (Kontobereich, Admin ohne `AccountSync`) · [x] `GLOSSARY.md` („Kontobereich“) · [ ] ADR nicht nötig (keine neue Leitplanke, keine Abhängigkeit)
