# Spec E0-09 – Private API als Routentabelle hinter schmalen Ports

- **Roadmap-Bezug:** Architekturpflege ohne eigene Roadmap-Checkbox. Betrifft die tokenfreien Leases aus [E5-09](E5-09-account-bound-sync.md).
- **Status:** Review
- **Betroffene Module:** `apps/web/src/sync`, `apps/web/src/ui/accountDeliveryFailures.ts`, `packages/shared/src/api/auth.ts`

## Ziel

Jeder Aufruf der API ist als Daten beschrieben: Pfadbauer, Methode, Body-Bauer mit Zod-Schema, Antwortschema und Cookie-Regel. Ein einziger Fetch-, Parse- und Fehlerpfad verarbeitet alle Routen. Jeder Konsument erhält nur die Ports, die er aufruft. Tests stubben deshalb keine fremden Fähigkeiten mehr.

## Ausgangslage

- `AccountLease` hatte rund 15 eigene Mitglieder sowie die Unterleases Strava, Progress, Identitäten und Shop. Tests füllten deshalb alles mit `unusedStravaLease` und `unexpectedAccountParts`.
- Die HTTP-Methode wurde aus dem Pfad geraten (`body === undefined ? GET : … PUT : … PATCH : POST`). `credentials` war ein positionales viertes Argument.
- `identityLease.ts` und `shopLease.ts` definierten Pfad- und Schematypen erneut, um unter `max-lines` zu bleiben.
- `AccountLease extends ProfileWriteLease`: Ein Speichertyp war die Basis der Netzwerkfähigkeit.
- `authTransport.ts` war ein zweiter Fetch-Adapter zum selben Origin. Er warf `Error`, akzeptierte jedes `response.ok` und prüfte weder Content-Type noch `redirect: "error"`.

## Entscheidung zu `authTransport.ts`

`authTransport.ts` spricht denselben Origin an und hat verträgliche Semantik: JSON-Antworten, Zod-Schemas und Statusabbildung. Deshalb laufen auch Konfiguration, Austausch, `/v1/me` und Logout über `sendRoute`. Bewusst getrennt bleibt nur, was vor einer Lease gilt:

- `RouteTarget.current` ist `() => true`. Die Generationsprüfung besitzt weiterhin `ApplicationSession`. Eine Lease existiert zu diesem Zeitpunkt noch nicht.
- Kein Bearer für Konfiguration und Austausch. Für `/v1/me` und Logout gilt der zu prüfende oder zu widerrufende Token.
- `Content-Type` nur mit Body (`declareJson: "with-body"`). Der öffentliche Konfigurationsabruf bleibt eine einfache Anfrage ohne Preflight.
- Cookies: Nur der einmalige Austausch sendet `include` (browsergebundene Übergabe aus E5-06). Die anderen Sitzungsrouten behalten die Fetch-Voreinstellung `same-origin`.

## Abnahmekriterien

- [x] AK1 – Alle 25 privaten Routen und vier Sitzungsrouten sind als `ApiRoute` beschrieben (`accountPorts.ts`, `identityPort.ts`, `progressPort.ts`, `shopPort.ts`, `stravaPort.ts`, `authTransport.ts`). Die Methode ist Teil der Route und wird nicht aus dem Pfad abgeleitet.
- [x] AK2 – `sendRoute` in `apiRoute.ts` ist der einzige `fetch`-Aufruf von `sync/` zur API. Er prüft `current()` vor dem Fetch, nach dem Fetch und nach dem Parsen. Er setzt `no-store`, `redirect: "error"` und ein 8-s-Timeout zusätzlich zum Lease-Signal. Er bildet 401/403/404/409/429/5xx unverändert ab, verlangt `application/json` bei 200 und erlaubt eine leere Antwort nur als 204.
- [x] AK3 – Pfad- und Body-Bauer validieren mit den Schemas aus `packages/shared`. Sie werfen synchron vor Gate und Netz: Fahrt-ID, Cursor, Provider-ID, Codes, Bestellung, Consent und Profil.
- [x] AK4 – Cookies (`credentials: "include"`) sendet die private API nur bei Strava (ADR-017/018) und den beiden OIDC-Link-Schreibvorgängen. Alle anderen privaten Routen senden `omit`. Ein Contract-Test gegen echten `node:http` belegt Methode, Pfad, Credentials, `redirect`, `cache` und Header pro Route.
- [x] AK5 – Jeder Konsument deklariert nur seine Ports: `AccountSync` (Profil, Fahrten, Daten, Identitäten sowie Mitgliedschaft und Shop zum Binden), `DeliveryLease` (`profile.save`, `rides.upload`), `MembershipLease`, `ShopLease`, `StravaLease`, `ProgressLease` und `IdentityLinksLease`. `ApplicationSession<Lease>` übergibt die Lease des Ausstellers ohne Erweiterung.
- [x] AK6 – `unusedStravaLease.ts` ist gelöscht. Konsumententests bauen kleine In-Memory-Ports. Nur der `AccountSync`-Fixture erhält für die mitgebundenen Bereiche `offlinePorts.ts`. Diese Ports antworten wie ein nicht erreichbarer Server.
- [x] AK7 – `ProfileWriteLease` ist kein Basistyp der Netzwerkfähigkeit mehr. Die Speicherseite behält ihren strukturellen Schreibzaun (`signal`, `current`). `LeaseBinding` aus `apiRoute.ts` erfüllt ihn ohne Vererbung.
- [x] AK8 – Tokenfreie Leases bleiben origin- und generationsgebunden (E5-09). Admin-Schreibvorgänge werden weiterhin nicht wiederholt (ADR-021). Bestehende Tests zu Abbruch, Supersede, Kontowechsel und Strava-Generationen bleiben unverändert grün.

## Bewusste Verhaltensänderungen

- Sitzungsrouten haben jetzt `redirect: "error"` und die gemeinsame Content-Type-Prüfung. Sie akzeptieren nur 200 oder 204 statt jedes `2xx`. Fehler sind `PrivateRequestError` statt `Error`. `ApplicationSession` fängt beide gleich ab, die Texte bleiben gleich.
- Eine 200-Antwort mit JSON-`null` gilt als `contract`. Eine Löschung oder ein Logout gilt nur mit einem leeren 204 als bestätigt. Vorher hätte `AccountDeletionResponseSchema` (`z.null()`) auch `200 null` angenommen.
- `LogoutResponseSchema` in `packages/shared` beschreibt die leere 204-Antwort des Logouts.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene                      | Datei                                                                                                    |
| -------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| AK1, AK4 | Contract gegen `node:http` | `apps/web/src/sync/apiRoutes.test.ts` (29 Fälle)                                                         |
| AK2      | Contract gegen `node:http` | `apps/web/src/sync/privateAuthTransport.test.ts`, `applicationAbort.test.ts`                             |
| AK3      | Unit                       | `identityPort.test.ts`, `shopPort.test.ts`, `privateAuthTransport.test.ts`                               |
| AK5, AK6 | Unit mit In-Memory-Ports   | `accountDelivery.test.ts`, `garageShop.test.ts`, `identityLinks.test.ts`, Strava-Fixtures                |
| AK7      | Unit                       | `profileWrite.test.ts`, `applicationLease.test.ts`                                                       |
| AK8      | Integration                | `progressSync.test.ts`, `accountAdministration.test.ts`, `stravaSync.test.ts`, `stravaDelivery*.test.ts` |
| alle     | E2E (Sim, gemockte API)    | `apps/web/e2e/account-data.spec.ts`, `account-links.spec.ts`                                             |

## Nicht-Ziele

- Keine neue Route, keine Änderung an Server-Controllern oder Statuscodes.
- Kein Umbau der Kontoabgrenzung in `AccountSync` (Kandidat 5, `refactor/account-scope`, baut auf diesem Branch auf).

## Offene Fragen / Risiken

- Sitzungsrouten mit `redirect: "error"`: Ein Proxy, der `/v1/auth/config` umleitet, führt jetzt zu „Anmeldeserver nicht erreichbar“ statt zu einem stillen Folgen. Das ist beabsichtigt, aber nur gegen gemockte APIs geprüft.
- An echter Hardware getestet: nein. Kein Hardwarepfad betroffen.

## Doku-Updates (Pflicht beim Abschluss)

- [x] `docs/01-architecture.md` (Abschnitt zu E5-09) · [x] `docs/specs/E5-11-multiple-oidc-providers.md` (Testdateiname) · [ ] ADR (nicht nötig: keine neue Leitplanke, keine Abhängigkeit)
