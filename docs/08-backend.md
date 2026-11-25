# 08 – Backend: Accounts, Ökonomie, Fahrten, Gruppenfahrten

Server auf Henrys **vorhandenem Hetzner-VPS** (ADR-004). Er ist **autoritativ** für Accounts, Inventar, XP/Level, Volts und Fahrthistorie (ADR-005) und betreibt die Live-Räume für Gruppenfahrten. Der Client bleibt eine statische Seite (**Cloudflare Pages**, ADR-009) und ist **offline-first**: Solo-Fahren funktioniert immer, auch ohne Server (Gastmodus / Offline-Cache).

## Stack (entschieden)

Für den aktuellen Produktionsauftrag gilt [ADR-020](decisions/ADR-020-explicit-production-provisioning.md): persistentes SQLite ohne Backup. Die Litestream-Angaben beschreiben die weiterhin optionale Variante, keine aktive Sicherung.

Auth-Ziel seit Henrys Entscheidung vom 20.11.2026 ist [Cloudflare Access als OIDC-Broker](decisions/ADR-013-cloudflare-access-oidc.md). Die Account- und Sessiongrundlage ist auf `main`. [E5-06](specs/E5-06-oidc-server-login.md) implementiert den Server-Codeflow mit `openid-client` und einem lokalen signierenden Testprovider. [E5-08](specs/E5-08-browser-oidc-session.md) ergänzt das Browserkonto mit lokalem Browsernachweis. Die externe Pilot-App ist getrennt eingerichtet. Identitätsverwaltung, echter Anbieterlogin und Produktionsbetrieb sind damit nicht nachgewiesen. Die übrigen Tabellen und API-Skizzen beschreiben den Zielstand.

App und begrenzte Pilot-Policy sind nach Freigabe eingerichtet, siehe [E5-04](specs/E5-04-access-oidc-pilot-setup.md). Die Cloudflare-Account-API meldet `Teams Free Base`, aber keine bestätigten freien Seats.

| Baustein       | Wahl                                                                                                                                                                                                                                                                     | Begründung                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sprache        | **TypeScript** (nicht Go)                                                                                                                                                                                                                                                | Physik, Gangmodell, Level-/Volts-Regeln und Protokoll-Schemas liegen in `packages/*` und werden **identisch** im Browser und für die serverseitige Fahrt-Validierung genutzt; eine zweite Implementierung in Go würde auseinanderlaufen.                                                                                                                                             |
| Runtime        | **Node.js LTS** (exakt per mise gepinnt)                                                                                                                                                                                                                                 |                                                                                                                                                                                                                                                                                                                                                                                      |
| Framework      | **NestJS** (`@nestjs/core`, HTTP-Adapter Express)                                                                                                                                                                                                                        | klare Modul-/Provider-Struktur, DI erleichtert Tests ohne Modul-Mocking (passt zu anti-slop `no-module-mocking`), Guards/Pipes/Interceptors für Auth, Validierung, Rate-Limits; vielen Agenten vertraut.                                                                                                                                                                             |
| WebSocket      | **`@nestjs/websockets` + `@nestjs/platform-ws`** (`WsAdapter`, rohe WebSockets, kein socket.io)                                                                                                                                                                          | Browser-natives `WebSocket` im Client, kein zusätzliches Protokoll; Gateway nutzt dieselben Guards.                                                                                                                                                                                                                                                                                  |
| Validierung    | **Zod**-Schemas in `packages/shared` + `nestjs-zod` (`ZodValidationPipe`)                                                                                                                                                                                                | eine Definition für Client, Server und WS-Nachrichten; ersetzt `class-validator`-DTOs (Doppelpflege).                                                                                                                                                                                                                                                                                |
| Datenbank      | **SQLite** (`better-sqlite3`, WAL)                                                                                                                                                                                                                                       | ein VPS, kleiner Nutzerkreis, kein DB-Server; atomare Transaktionen für Käufe.                                                                                                                                                                                                                                                                                                       |
| ORM / Query    | **Drizzle ORM** + `drizzle-kit` (Migrationen)                                                                                                                                                                                                                            | Schema in TypeScript = Typen ohne Codegen-Schritt; dünne SQL-nahe API, synchroner `better-sqlite3`-Treiber, später Postgres-Dialekt möglich. Kysely wäre gleichwertig typsicher, aber Schema/Migrationen getrennt; Prisma braucht Codegen + eigene Engine/Schema-Sprache und passt schlechter zu „Typen aus `packages/*`". Einbindung in Nest als eigener `DatabaseModule`-Provider. |
| Backups        | **Litestream** → S3-kompatibel / Hetzner Storage Box, alternativ nächtliches `sqlite3 .backup`                                                                                                                                                                           |                                                                                                                                                                                                                                                                                                                                                                                      |
| Auth-Ziel      | **Cloudflare Access OIDC → lokale opake Bearer-Session**, Nest-`AuthGuard`                                                                                                                                                                                               | Authorization Code + PKCE `S256`, serverseitige Login-Transaktion, gepflegte OIDC-Bibliothek; keine Access-Proxy-Sperre vor Webseite oder API (ADR-013)                                                                                                                                                                                                                              |
| Login-Methoden | Im Broker nach Aktivierung prüfen                                                                                                                                                                                                                                        | Keine zusätzliche direkte Passkey-Implementierung als Teil dieses Entscheids                                                                                                                                                                                                                                                                                                         |
| Rate-Limits    | `@nestjs/throttler`                                                                                                                                                                                                                                                      | besonders `/auth/*`                                                                                                                                                                                                                                                                                                                                                                  |
| Health         | `GET /healthz` (eigener `HealthModule`, optional `@nestjs/terminus`)                                                                                                                                                                                                     | ab E0                                                                                                                                                                                                                                                                                                                                                                                |
| Reverse Proxy  | vorhandener **Traefik v3** (Container `financensor-traefik-1` auf Henrys Hetzner-VPS)                                                                                                                                                                                    | `https://`/`wss://` über Traefik-Labels; Netzwerk- und Certresolver-Namen beim Deploy aus der Financensor-Compose ablesen (**TODO**)                                                                                                                                                                                                                                                 |
| Prozess        | **Docker Compose** (eigenes Projekt), Image z. B. `ghcr.io/henrysachs/voltonaut-server`                                                                                                                                                                                  | Neustart und Logs über Compose; SQLite auf named Volume oder Bind-Mount; Litestream als Sidecar                                                                                                                                                                                                                                                                                      |
| Tests          | Vitest + `@nestjs/testing` (`Test.createTestingModule`, `overrideProvider`) + Supertest; echte WS-Verbindungen; SQLite in-memory; Server-Controller injizieren über **explizite `@Inject(Token)`**, deshalb laufen die Tests ohne Decorator-Metadaten auf Vitest/esbuild | `unplugin-swc` bleibt für den Produktions-Build (Vite), damit Nest auch ohne explizite Tokens funktioniert                                                                                                                                                                                                                                                                           |

**Domains, CORS, Token:** Web unter `voltonaut.stammkneipe.dev` (Cloudflare Pages, Custom Domain), API/WebSocket unter `api.voltonaut.stammkneipe.dev` (A-Record auf Henrys Hetzner-VPS). Web und API haben verschiedene Origins, aber dieselbe Site. OIDC verwendet genau `CLIENT_ORIGIN` als CORS-Origin mit Credentials. Der Browser tauscht die Übergabe mit dem hostgebundenen HttpOnly-Cookie `SameSite=Lax` aus. Danach verwendet er die opake Bearer-Session. `*.pages.dev`-Previews verlinken zur kanonischen Web-Seite, statt Cross-Site-Cookies zu verlangen. Staging braucht eine eigene passende Web-/API-Konfiguration.
API-DNS: **unproxieder** A-Record auf den VPS (graue Wolke) – Traefiks `letsencrypt`-Certresolver muss den Host direkt per ACME erreichen, das Zertifikat kommt wie bei Financensor vom vorhandenen Traefik, nicht von Cloudflare (ADR-004). Kein Cloudflare-Proxy für diesen Record; sollte er später doch proxied werden, muss der SSL-Modus **Full (strict)** sein.

## Mailanbieter (historische Recherche, optional)

Die folgende Recherche vom 19.11.2026 gehört zum früheren Magic-Link-Plan, nicht zur aktuellen Standardarchitektur. Angaben zu Preisen und Limits sind historische Befunde. Keine Buchung ist beschlossen. Mailversand bleibt optional für Transaktionsmails oder ausdrücklich gewählten Legacy-/Entwicklungsbetrieb. Seit E5-06 verlangen OIDC und Disabled beim Serverstart keine Mailanbieter-Zugangsdaten. Die Produktionspflicht gilt nur noch für expliziten Magic-Link-Betrieb und ist getestet. Nach dem Cutover wird Magic Link deaktiviert oder entfernt, nicht als zweiter Standard weiterbetrieben.

| Option                                                | Status (geprüft 2026-11-19)                                                                                                 | Kosten / Limits                                                                                                                                                                                                                                                                                                                                                                              | Einschätzung                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Cloudflare Email Service – Email Sending** (primär) | **Public Beta** seit 16.04.2026; Versand per REST-API, Workers-Binding oder **authentifiziertem SMTP** → aus NestJS nutzbar | Beliebige Empfänger **nur mit Workers Paid** (≈ 5 $/Monat Mindestbetrag, 3 000 Mails/Monat inkl., danach 0,35 $/1 000). Auf Workers Free nur an **verifizierte Zieladressen** im eigenen Account (kostenlos) – reicht für Henrys eigenen Login in der Entwicklung, nicht für Freunde. Neue Accounts starten mit konservativem Tageslimit. Absenderdomain muss bei Cloudflare onboarded sein. | Passt, wenn Henry Workers Paid hat oder bucht; Beta = Risiko |
| **Resend** (Fallback)                                 | GA                                                                                                                          | **Free: 3 000 Mails/Monat, max. 100/Tag** (UTC-Tag; eingehende Mails zählen mit), 3 Domains, keine Überziehung (Mail 101 → HTTP 429). Pro ab 20 $/Monat.                                                                                                                                                                                                                                     | Für den Freundeskreis ausreichend und kostenlos              |

Früherer Umsetzungsplan, bei künftigem Mailbedarf erneut prüfen: `MailModule` mit Interface `MailSender` und zwei Implementierungen (`CloudflareEmailSender` via REST/SMTP, `ResendSender`), Auswahl per Env-Variable; Tests mit In-Memory-Fake (DI, kein Modul-Mocking). SPF/DKIM/DMARC für die Absenderdomain. Quellen: https://developers.cloudflare.com/email-service/platform/pricing/ · https://developers.cloudflare.com/email-service/platform/limits/ · https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/ · https://resend.com/pricing · https://resend.com/docs/knowledge-base/resend-email-quota

## Nest-Module (`apps/server/src/`)

| Modul                                                                                                                                                                                                                                                   | Verantwortung                                                                       | Besitzt (Tabellen)                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `health/`                                                                                                                                                                                                                                               | `/healthz` (DB erreichbar, Version, Uptime) – **E0**                                | –                                                                                                       |
| `database/`                                                                                                                                                                                                                                             | Drizzle-Instanz als Provider, Migrationen beim Start                                | –                                                                                                       |
| `mail/`                                                                                                                                                                                                                                                 | Optionaler `MailSender` für Transaktionsmails oder Legacy-/Entwicklungsbetrieb      | –                                                                                                       |
| `auth/`                                                                                                                                                                                                                                                 | OIDC-Transaktionen, explizite Identitätsverknüpfung, lokale Sessions, `AuthGuard`   | `users`, `auth_identities`, `sessions`, Login-Transaktionen; `login_tokens` nur bis zur Legacy-Ablösung |
| `accounts/`                                                                                                                                                                                                                                             | Rider-Profil, Anzeigename, Avatar-Config, Export/Löschung (DSGVO)                   | `profiles`                                                                                              |
| `inventory/`                                                                                                                                                                                                                                            | freigeschaltete Items, Ausrüsten-Validierung                                        | `inventory`                                                                                             |
| `economy/` (Volts)                                                                                                                                                                                                                                      | Volts-Ledger, Shop, Käufe (Transaktion)                                             | `volts_ledger`                                                                                          |
| `progress/`                                                                                                                                                                                                                                             | Consent, Journalbindung, Checkpoint-Annahme, Highwater                              | `progress_consents`, `ride_progress_journals`, `ride_progress_ranges`                                   |
| `progression/`                                                                                                                                                                                                                                          | XP, Level, Badges, PBs aus akzeptierten Fahrten (nutzt `@voltonaut/rules`)          | `progression`, `badges`, `personal_bests`                                                               |
| `rides/`                                                                                                                                                                                                                                                | Upload, Plausibilitätsprüfung (nutzt `@voltonaut/engine` zur Nachrechnung), Vergabe | `rides`, `ride_samples`                                                                                 |
| `live/`                                                                                                                                                                                                                                                 | `LiveGateway` (`@WebSocketGateway`, `WsAdapter`), Räume In-Memory                   | –                                                                                                       |
| `catalog/`                                                                                                                                                                                                                                              | Item-Katalog, Level-Tabelle aus `@voltonaut/rules`                                  | read-only                                                                                               |
| Regel: ein Modul besitzt seine Tabellen (Drizzle-Schema-Datei liegt im Modul); andere Module nutzen dessen exportierten Service, nie fremde Tabellen direkt (per dependency-cruiser: `apps/server/src/<a>/**/*.schema.ts` nur aus `<a>/` importierbar). |

## Mitgliedschaft und Verwaltung

[E5-10](specs/E5-10-membership-admin.md) und [ADR-021](decisions/ADR-021-membership-and-administration.md) trennen Normal/Premium/Pro, das zusätzliche VIP-Kennzeichen und die Rolle `user` oder `admin`. `accounts` besitzt alle drei Angaben in `account_status`. Eine fehlende Zeile bedeutet Normal, nicht VIP und nicht Admin. Stufen und VIP verändern vorerst weder Preise noch Spielrechte oder Strava-Freigaben.

`GET /v1/me/account-status` liefert den eigenen Status. `GET /v1/admin/users` listet höchstens 50 aktive Konten mit opakem ID-Cursor. `PATCH /v1/admin/users/:userId/membership` akzeptiert ausschließlich `tier` und `vip`, verlangt den exakten Origin und prüft Actor sowie Ziel innerhalb einer unmittelbaren Schreibtransaktion erneut. Mitgliedschaftsänderungen überschreiben keine Rollen. Antworten einschließlich Fehlern sind `no-store`. Auth-Session, Profil- und Aufnahmeverträge bleiben unverändert.

Nur der Operatorbefehl `node dist/main.js admin grant <bestehendeUserId>` vergibt die Rolle. `admin list [cursor]` zeigt die begrenzte Kontoliste, `admin revoke <bestehendeUserId>` entzieht die Rolle. Der Befehl startet weder HTTP-Server noch Strava-Scheduler. E-Mail dient der Anzeige, niemals der automatischen Zuordnung. Der erste Login erhält keine Adminrechte. Henrys tatsächliches bestehendes Konto muss vor dem ersten Produktionsgrant bestätigt werden.

Die Oberfläche bleibt im Konto-Overlay. Ein generationsgebundener Schreibbesitzer unter `AccountSync` hält die Operation bis zum autoritativen Nachlesen gesperrt. Gehaltene Refresh-, Next- und Save-Aktionen dürfen diese Bestätigung nicht überholen. Ein verlorener Schreibbeleg bleibt unbestätigt, ohne automatischen Retry. Die gebaute Gesamtprüfung und unabhängige Gegenproben bestehen lokal. Bereitstellung und persönlicher Erstzugang sind noch offen.

## Datenexport und Kontolöschung

[E5-11](specs/E5-11-account-data-export-deletion.md) liefert `GET /v1/me/export` und `DELETE /v1/me`. Beide Pfade haben keinen Kontoparameter; maßgeblich ist ausschließlich `SessionPrincipal.userId`. Der Export enthält Profil, Mitgliedschaft, verknüpfte Identitäten mit Issuer/Subject, alle eigenen Aufnahmen mit Rohjournal, Beleg, Bewertung, servereigener Zusammenfassung und vorhandenem TCX, den abgeleiteten Volts-Kontostand und das vollständige Volts-Journal sowie Strava-Status und Aufträge. Economy bleibt Besitzer des Ledgers und stellt dafür schmale `exportOwn`/`deleteOwn`-Ports. Sessions, Tokens, Zugangsdaten und Chiffrate werden nicht exportiert. Seit E7-02 (`schemaVersion` 2) enthält der Export die gekauften Inventar-Items; Standard-Items gehören jedem Konto und erscheinen nicht. Die Löschung entfernt das Inventar über den `deleteOwn`-Port des Inventory-Moduls. Das Volts-Journal exportiert auch Operator-Gutschriften. Fehlen TCX-Metadaten oder stimmt der gespeicherte TCX-Hash nicht, schlägt der Export kontrolliert fehl, statt die Fahrt still unvollständig auszugeben.

Die Löschung verlangt Bearer-Session, exakten `CLIENT_ORIGIN` und die Eingabe der E-Mail dieser Session. `AccountDataService` koordiniert eine unmittelbare SQLite-Transaktion über die Besitzer-Services. Gelöscht werden Profil, Mitgliedschaft, Fahrten, Volts-Journal, Strava-Transaktionen/Verbindung/Aufträge, Identitätszuordnungen, offene Link-Transaktionen, Handoffs, Sessions und offene Magic-Link-Token. `users` bleibt als Tombstein; E-Mail wird durch eine unkenntliche Adresse ersetzt und zusammen mit externen Identitäten nur noch durch serverseitig gekeyete HMAC-SHA-256-Tombstones gesperrt. Sessions und Login-Tokens behalten ungesalzene SHA-256-Hashes ihrer zufälligen opaque Werte. Trigger verhindern INSERT/UPDATE auf jeder Tabelle mit `user_id`-Fremdschlüssel auf `users` und jede Wiederbelebung des Tombstones. Die Neuanlage desselben Magic-Link-Kontos oder derselben OIDC-Identität und späte Link-Callbacks schlagen kontrolliert fehl.

Die Löschung wartet nicht auf Strava. Bereits an Strava übertragene Aktivitäten und der Anbieterzugriff werden nicht gelöscht; die Oberfläche erklärt das getrennt. Eine lokal bereits bestätigte Löschung entfernt im Browser nur Outbox-Einträge des exakten API-Origin/Kontos. Ein transaktionaler Löschmarker verhindert späte Neuanlage auch aus anderen Tabs. Lokale Fahrtarchive und das gemeinsame Gastprofil bleiben erhalten. Schlägt die lokale Bereinigung fehl, wird ein Aufräumauftrag für den nächsten Start vermerkt; ist auch localStorage gesperrt, meldet die Oberfläche ausdrücklich unbestätigte Bereinigung.

Migration `0010_common_jack_flag.sql` ergänzt E-Mail-Tombstones, Identitätstombstones und die Trigger einschließlich `volts_ledger` additiv auf `0009_volts_ledger.sql`. `0011_volts_operator_grant.sql` (E7-02) baut `volts_ledger` neu und legt dessen Trigger wieder an; `inventory` bekommt dieselben Trigger. Ein neuer Tabellenneubau muss das ebenfalls tun, sonst schlägt `account-deletion-guards.test.ts` an. Die Löschung ist eine logische Datenbanklöschung; SQLite-WAL-Dateien können gelöschte Bytes bis zur physikalischen Kompaktierung enthalten. Backup/Restore muss Löschtombstones erhalten bzw. erneut anwenden. Der unbegrenzte synchrone Export ist ein bewusster Tradeoff für den kleinen Nutzerkreis; der private Client bricht nach acht Sekunden ab.

## Datenmodell (Skizze)

### Eigene Profile und Fahrtenannahme

[E5-07](specs/E5-07-owned-profile-rides.md) liefert eigene Profile und historische V1-Aufnahmen. Die API-Einheit aus [E10-04](specs/E10-04-complete-ride-delivery.md) ergänzt die Journalannahme. Die folgenden SQL- und API-Skizzen bleiben der weitergehende Zielstand.

- `GET /v1/me/profile` liefert `missing` oder `present` mit Profil und UTC-Änderungszeit. `PUT` validiert Profil und Fahrrad strikt.
- `POST /v2/rides` akzeptiert das rohe `RideRecording`: Journalversion 2 oder historische Version 1, ohne Archivwrapper. `/v1/rides` entfällt ohne Weiterleitung. Unkomprimiertes JSON bleibt auf 8 MiB begrenzt. Schemafehler liefern 422, ungültiges JSON 400, zu große Bodies 413 und komprimierte Bodies 415. Fehlermeldungen enthalten keine rohe Nutzlast.
- Historische V1-Aufnahmen behalten `assessment: {status:'unverified',reason:'legacy_missing_replay'}` und ihre ursprünglichen Belege. Vollständige bekannte Journale werden ab Initialisierung nachgerechnet. Unvollständige Journale und unbekannte Revisionen bleiben `unverified`; abweichende Beobachtungen ergeben `rejected/observation_mismatch`. Keine dieser Bewertungen vergibt Belohnungen.
- Quellenqualität gilt nur am Fensterstart und innerhalb des Fensters. Der Server erhält Bereitschaft und rohe Kanalfrische aus dem gesamten Präfix. Frische Daten nach einer Lücke heilen die Lücke nicht. Alte Vorlauffehler blockieren ein wieder gesundes Fenster nicht.
- Nutzlast, Hash, Bewertung, Beleg, Zusammenfassung und TCX samt Hash und `tcx-1` werden atomar gespeichert. Nachrechnung und Projektion laufen vor der kurzen Schreibtransaktion. Identische eigene Wiederholungen lesen den gespeicherten Beleg vor einer erneuten Nachrechnung. Nicht nachgerechnete Fahrten erhalten keinen TCX-Export auf dem Server.
- Eine strukturell gültige, aber nicht sicher projizierbare Beobachtung liefert 422 statt 500. Das betrifft etwa fallende virtuelle Distanz oder Werte außerhalb der Trackgrenzen. Ein projizierbarer Beobachtungswiderspruch kann dagegen als `rejected` gespeichert werden. Die Grenzen für sechs Stunden und 8 MiB bleiben unverändert; ein vollständiges Sechs-Stunden-Journal passt nicht zwangsläufig in das Bytebudget.
- Globale UUID-Eindeutigkeit, kanonische geparste Nutzlast, SHA-256 und ursprünglicher Beleg liegen in derselben SQLite-Transaktion. Erstupload und identische Wiederholung liefern HTTP 200 mit demselben gespeicherten Beleg. Eine abweichende Nutzlast liefert 409 `ride_id_conflict`. Eine fremde UUID liefert auch beim Upload 404.
- Das gemeinsame `RideIdSchema` normalisiert UUIDs beim API-Upload, Detailpfad und Cursor auf Kleinschreibung, vor Hash und Speicherung. Lokale V1-Dateien und Auth-Identifikatoren werden nicht umgeschrieben. Ein Route-Guard prüft den Medientyp vor der Zod-Bodyvalidierung. `text/plain` liefert 415, gültiges JSON mit Charset bleibt erlaubt.
- `GET /v2/rides/:rideId` liefert eigene Aufnahme und gespeicherte Bewertung. `GET /v2/rides` enthält keine Samples, ist auf 20 Einträge voreingestellt und auf 50 begrenzt. Cursor und Sortierung verwenden aufsteigende UUIDs, nicht die Aufnahmezeit.
- Jeder Zugriff ist an `SessionPrincipal.userId` gebunden. `GET /v1/me` bleibt Auth-Verantwortung. Es gibt keine automatische Löschung. Uploads sind pro Account auf 30 Anfragen pro Minute begrenzt, auch bei Wiederholungen.

Die Module definieren `createAccountsTables(userIdColumn: SQLiteColumn)`, `createRidesTables(userIdColumn: SQLiteColumn)` und `createEconomyTables(userIdColumn: SQLiteColumn)` mit echten `.references()`-Fremdschlüsseln. Nur der Composition Root `src/schema.ts` importiert `users` und diese Fabriken. Er exportiert konkrete Tabellen für Drizzle Kit. `AppModule` übergibt die Tabellen an die jeweiligen `register`-Fabriken. Services injizieren `DRIZZLE` und ausschließlich eigene Tabellen. Ein Schema-Registry oder Import fremder Modul-Schemas ist dafür nicht nötig.

[E6-05](specs/E6-05-volts-ledger.md) lässt `economy/` die additive Tabelle `volts_ledger` besitzen. Der Kontostand ist die Summe ihrer Deltas; eine mutable Wallet-Spalte existiert nicht. Idempotenzschlüssel und Auftragshash verhindern doppelte oder abweichende Wiederholungen. Fahrtbereiche speichern kumulative Volts-Komponenten und buchen nur die Differenz zum vorherigen Bereich; Lücken, Überlappungen und fremde Journals werden abgewiesen. Belohnungen und Abbuchungen laufen in unmittelbaren SQLite-Transaktionen; das schmale `EconomyService.transaction`-Port erlaubt später eine atomare Kombination mit Inventar. `GET /v1/me/volts` liefert den eigenen Kontostand mit `no-store`. Belohnungs-POSTs folgen erst mit Checkpoint-Freigabe.

[E7-02](specs/E7-02-server-inventory-shop.md) und [ADR-031](decisions/ADR-031-server-inventory-and-operator-grant.md) lassen `inventory/` die additive Tabelle `inventory` besitzen. Gespeichert werden nur gekaufte Items; Standard-Items gelten ohne Zeile als besessen. `POST /v1/shop/purchase` prüft Katalog, Shop-Freischaltung, erwarteten Preis und Besitz über `decidePurchase` aus `@voltonaut/rules` und bucht Abbuchung und Inventareintrag in derselben unmittelbaren Transaktion von `EconomyService.transaction`. Die `requestId` des Clients macht Wiederholungen idempotent. Das Mindestlevel wird bis zur Progression nicht geprüft (Übergang). Der Operatorbefehl `node dist/main.js admin credit <userId> <volts> <reference>` schreibt eine idempotente Gutschrift mit Grund `operator_grant`; einen Web-Endpunkt dafür gibt es nicht.

[E7-05](specs/E7-05-garage-loadout.md) speichert die Ausrüstung pro Konto in `avatar_loadouts(user_id PK, loadout_json, updated_at)` mit Lösch-Triggern wie die übrigen Kontotabellen. `GET /v1/me/loadout` liefert die gespeicherte Ausrüstung oder `DEFAULT_AVATAR_CONFIG` mit `updatedAt: null`. `PUT /v1/me/loadout` verlangt den exakten Client-Origin und prüft in einer unmittelbaren Transaktion mit `decideLoadout` aus `@voltonaut/rules` Katalog, Slot, Palette und Besitz: nicht besessen ergibt `409 not_owned`, fremde Farben oder Items `422 validation_failed`. Der Kontoexport (`schemaVersion` 4) enthält die Ausrüstung unter `inventory.loadout`; die Kontolöschung entfernt sie.

Die gemeinsame Datenmigration ist `0002_owned_profiles_rides.sql`. `0003` ergänzt Strava-Verbindungen. Die additive `0004_replayed_ride_exports.sql` ergänzt Zusammenfassung und Exportspalten, ohne bestehende Nutzlasten, Hashes oder Belege umzuschreiben. Die Migrationen `0000` bis `0003` bleiben unverändert. Der Browser verwendet die Fahrtendpunkte seit [E5-09](specs/E5-09-account-bound-sync.md) nach ausdrücklicher Zuordnung lokaler Fahrtkopien.

`RidesService.loadOwnStravaSource(userId, rideId)` liest synchron eigene gespeicherte Exportbytes. `RIDE_SOURCE_POLICY` ist standardmäßig `disabled`. Nur die ausdrückliche Einstellung `declared_ble_v1` erlaubt ein nachgerechnetes, kontinuierliches, als BLE deklariertes Fenster. Sim, Skalierung und Qualitätsfehler bleiben gesperrt. Die Antwort bezeichnet die Quelle als `client_declared`, nicht als Hardwareattest. Eine vollständig erfundene konsistente BLE-Selbstauskunft ist damit nicht erkennbar. Reale Aktivierung bleibt gesondert offen. Das Lesen der Quelle führt weder einen weiteren Physiklauf noch einen Anbieteraufruf aus.

```sql
users(id TEXT PK, email TEXT /* Contact attribute, not an identity key */, created_at, deleted_at, deleted_email_hash)
auth_identities(user_id REFERENCES users(id), issuer TEXT, subject TEXT, UNIQUE(issuer,subject))
sessions(token_hash TEXT PK, user_id, created_at, last_seen_at, expires_at, user_agent)
-- Server-owned login transactions: state, nonce, PKCE verifier, browser binding, expiry, one-time consumption.
-- login_tokens from PR #6 remain only for explicitly selected legacy operation until cutover.
profiles(user_id PK, display_name, mass_kg, height_cm, ftp_w, max_hr, bike_json, avatar_json, updated_at)
inventory(user_id, item_id, source TEXT /* shop; default items are implicit */, purchase_request_id, acquired_at,
          PK(user_id,item_id), UNIQUE(user_id,purchase_request_id))
volts_ledger(id PK, user_id, delta_volts INT, reason TEXT /* ride_reward|purchase|operator_grant */, ref_id,
             idempotency_key, payload_hash, reward_day, start_tick, end_tick, candidate_volts,
             cumulative_work_volts, cumulative_climb_volts, cumulative_facts_json, created_at,
             UNIQUE(user_id,idempotency_key),
             UNIQUE(ref_id,start_tick) WHERE reason='ride_reward',
             UNIQUE(ref_id,end_tick) WHERE reason='ride_reward')
progress_consents(user_id PK, version, enabled, session_hash, session_generation, updated_at)
ride_progress_journals(journal_id PK, user_id, session_hash, session_generation, consent_version,
                       source, clock_scale, physics_revision, route_id, route_revision, physics_json,
                       started_at_ms, last_sequence, last_end_tick, last_ended_at_ms, last_reward_day,
                       cumulative_facts_json, created_at)
ride_progress_ranges(id PK, journal_id, user_id, start_tick, end_tick, payload_hash, payload_json,
                     cumulative_facts_json, receipt_json, created_at,
                     UNIQUE(journal_id,start_tick), UNIQUE(journal_id,end_tick))
progression(user_id PK, xp INT, level INT, total_distance_m, total_elev_m, total_ride_s, updated_at)
badges(user_id, badge_id, earned_at, ride_id, PK(user_id,badge_id))
personal_bests(user_id, segment_id, time_s REAL, avg_power_w, ride_id, at, PK(user_id,segment_id))
rides(id TEXT PK /* client-UUID, idempotent */, user_id, route_id, started_at, duration_s, distance_m, elev_m,
      energy_kj, avg_power_w, max_power_w, avg_hr, status TEXT /* accepted|flagged|rejected */, flags_json,
      xp_awarded, volts_awarded, client_version, uploaded_at)
ride_samples(ride_id PK, samples_blob /* 1 Hz, gzip: t, power, cadence, hr, distance, gear */)  -- Aufbewahrung 90 Tage ❓
```

## API-Skizze (REST, JSON, Präfix `/v1`)

```
# OIDC login start → Access; server callback → verified identity → one-time browser-bound SPA handoff.
GET  /v1/auth/config                                              → { mode, providers?: [{ id, displayName }] }
GET  /v1/auth/oidc/:provider/start                                 → 302 Anbieter, Browserbindungscookie
GET  /v1/auth/oidc/:provider/callback                              → 302 CLIENT_ORIGIN/auth/finish?code=|link=|error=
POST /v1/auth/oidc/exchange      { code }                           → { sessionToken, user }
POST /v1/auth/oidc/:provider/link  (Bearer)                         → { location }, Browserbindungscookie
POST /v1/auth/identities           (Bearer) { code }                → { identities }   (Link abschließen)
GET  /v1/auth/identities           (Bearer)                         → { identities: [{ providerId, displayName }] }
# Exchange requires original browser cookie and exact CLIENT_ORIGIN header.
# No bearer, access, or refresh tokens in redirect URLs.
POST /v1/auth/logout                                              → 204
GET  /v1/me                                                       → { user, profile, progression, voltsBalance, inventory[], badges[], pbs{} }
GET  /v1/me/volts                                                 → { voltsBalance } (E6-05, autoritativ aus dem Ledger)
GET  /v1/me/progress-consent                                      → { version, enabled, rewardsAvailable, sessionGeneration }
PUT  /v1/me/progress-consent                                      → { enabled, sessionGeneration } (exakter Origin, versioniert)
POST /v1/progress/checkpoints                                    → { range } (E6-10, authentifiziert, idempotent, bucht Volts)
PUT  /v1/me/profile             RiderProfile                      → profile          (Validierung: Bereiche wie 03 §2a)
GET  /v1/catalog                                                  → { items[], levels[], version }   (öffentlich, cachebar)
GET  /v1/me/loadout                                               → { loadout: AvatarConfig, updatedAt: string|null } (E7-05, no-store)
PUT  /v1/me/loadout              { loadout: AvatarConfig }          → 200 { loadout, updatedAt } | 409 not_owned | 422 validation_failed
GET  /v1/me/inventory                                             → { items: [{ itemId, source, acquiredAt }] } (E7-02, no-store)
POST /v1/shop/purchase          { requestId, itemId, expectedPriceVolts } → 200 { voltsBalance, item } | 404 not_found
                                | 409 insufficient_volts | already_owned | item_not_for_sale | price_changed | ledger_conflict
POST /v2/rides                  RideRecording (JSON)              → { rideId, storage:'stored', assessment }
                                (idempotent: gleiche rideId → gleiche Antwort)
GET  /v2/rides?cursor=…                                           → { rides: RideSummary[], nextCursor }
GET  /v1/me/export                                                → JSON aller eigenen Daten (no-store)
DELETE /v1/me                              { confirmation: email }   → 204 (atomare Löschung, exakter Origin)
WS   /v1/live                   erster Frame { t:'auth', sessionToken } → Räume (s. u.)
```

Der aktuelle `GET /v1/me` liefert ausschließlich `{user}`. Profil und Spieldaten sind Folgeeinheiten. Die Sessionantwort bleibt die bestehende `SessionResponse` aus `packages/shared`. Der Webclient muss die Übergabe mit `credentials: "include"` austauschen und den Code sofort aus der Adresszeile entfernen. Vorher darf die Abschlussseite keine fremden Ressourcen laden.

Das Browserkonto aus E5-08 verwendet `VITE_API_ORIGIN` als validierte Origin ohne Pfad, Query, Fragment oder Zugangsdaten. Lokal ist der Standard derselbe Loopback-Hostname auf Port 3000, produktiv `https://api.voltonaut.stammkneipe.dev`. Ohne gespeicherte Session und ohne Übergabe startet kein Auth-Request. Ein gespeicherter Token wird optional über `/v1/me` geprüft, ohne Fahrtbeginn abzuwarten. Die Persistenz verwendet ausschließlich `voltonaut.application-session:<API-Origin>`. Bei verweigertem Speicher bleibt die Session im Tab. Abmelden räumt lokal auch bei Serverfehler auf und benennt einen unbestätigten Widerruf. Aktive oder ungesicherte abgeschlossene Aufnahmen schützen ihre Navigation mit der Browserbestätigung.

### Auth-Konfiguration aus E5-06

`AUTH_MODE` ist in Produktion Pflicht. Erlaubt sind `disabled`, `oidc`, `magic-link`. Nur Entwicklung und Test verwenden ohne Angabe weiter den bisherigen Magic Link. OIDC und Disabled erstellen keinen Mailtransport; beide lehnen Legacy-Loginendpunkte ab. Expliziter Legacy-Produktionsbetrieb verlangt weiterhin einen echten Mailprovider und dessen Zugangsdaten. Alle Modi verlangen in Produktion zusätzlich `AUTH_TOMBSTONE_HMAC_KEY` aus `/srv/voltonaut/auth.env` mit 64 kleingeschriebenen Hexzeichen (32 Zufallsbytes, z. B. über `openssl rand -hex 32`). Der geheime Schlüssel muss über Backups und Restarts stabil bleiben; Rotation ohne Mehrschlüsselstrategie würde die Erkennung alter Löschtombstones verhindern. Entwicklung und Test verwenden einen ausdrücklich nicht produktiven festen Schlüssel. Kein Schlüsselwert wird geloggt oder ins Repo geschrieben.

OIDC benötigt `OIDC_PROVIDERS` (Liste der Provider-IDs, ADR-026), je Provider `OIDC_<ID>_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI` sowie den festen `CLIENT_ORIGIN`. Optional je Provider: `_DISPLAY_NAME`, `_SCOPES` (Standard `openid email`), `_REQUIRE_EMAIL_VERIFIED` (Standard `true`), `_ID_TOKEN_ALG` (Standard `RS256`). Der Callbackpfad ist `/v1/auth/oidc/<id>/callback`, ohne Query oder Fragment, pro Provider exakt registriert. Produktion verlangt HTTPS. HTTP ist nur in Entwicklung und Test für Loopback zulässig, auch bei entdeckten Anbieterendpunkten. Ein fehlerhafter Providereintrag lässt den Start scheitern. Keine Zugangsdatenwerte im Repo. Die Anwendung liest die Konfiguration, nicht GitHub-Secrets direkt.

Ohne bestätigte E-Mail (`email_verified !== true`) legt ein Provider mit `requireEmailVerified` kein neues Konto an; der Browser landet auf `/auth/finish?error=email_not_verified`. Das gilt ebenso für `identity_conflict`. Bereits bekannte oder verknüpfte Identitäten melden sich unabhängig von der E-Mail an.

Ein angemeldetes Konto kann weitere Provider verbinden (ADR-026 Punkt 7): Die Transaktion bindet Zielkonto und Sitzung, der Callback erzeugt nur einen einmaligen Link-Code, und erst dieselbe Sitzung im selben Browser schließt mit `POST /v1/auth/identities` ab. Eine Identität eines anderen Kontos wird nie übernommen (`identity_in_use`), es gibt kein E-Mail-Linking und kein Zusammenführen. Trennen ist nicht vorgesehen.

#### authentik einrichten

1. In authentik einen **OAuth2/OpenID-Provider** samt Anwendung anlegen. Client-Typ _confidential_; Client-ID und Secret notieren.
2. **Redirect-URI** exakt eintragen (Modus _Strict_, keine Wildcards): `https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/authentik/callback`.
3. **Signing Key** setzen, z. B. das Self-signed Certificate. Ohne Schlüssel signiert authentik mit HS256, der Server erwartet RS256 (oder per `_ID_TOKEN_ALG` ES256/PS256/EdDSA).
4. **Subject-Modus:** gehashte Benutzer-ID oder UUID. Nicht Benutzername oder E-Mail, sonst verliert ein Nutzer bei Umbenennung sein Konto.
5. **`email_verified`:** Seit authentik 2025.10 ist der Standardwert `false`. Ein eigenes Scope-Mapping für `email` mit `email_verified: True` anlegen (nur wenn authentik die Adressen wirklich prüft) und dem Provider zuordnen; sonst lehnt Voltonaut die Konto-Anlage über authentik ab. Das ausdrückliche Verbinden mit einem bestehenden Konto bleibt möglich.
6. **Issuer** exakt kopieren, mit Slash am Ende: `https://<host>/application/o/<slug>/`. Der Issuer-Check vergleicht zeichengenau.
7. Wer sich anmelden darf, steuert die Policy der authentik-Anwendung (Gruppen werden von Voltonaut nicht ausgewertet).

Im OIDC-Modus enthält `CORS_ORIGINS` genau `CLIENT_ORIGIN`. CORS erlaubt Credentials. Web und API müssen dieselbe Site verwenden; lokal wird derselbe Loopback-Hostname verwendet. Das hostgebundene HttpOnly-Cookie hat `SameSite=Lax`, in Produktion zusätzlich `Secure` und den Namen `__Host-voltonaut-oidc`. Es enthält keine Anwendungssession.

Logintransaktionen gelten fünf Minuten, Übergaben 60 Sekunden. Callback-Beanspruchung geschieht atomar vor dem Anbieteraufruf über `claimed_at`. Die beanspruchte Zeile bleibt während des Aufrufs als Kapazitätsreservierung bestehen. Der erfolgreiche Callback ersetzt sie atomar durch eine Übergabe; ein Fehler benötigt einen neuen Loginstart. Datenbankfehler beim lokalen Sessioneinschub rollen dagegen die Übergabeverwendung zurück. Transaktionen einschließlich laufender Reservierungen und Übergaben sind zusammen auf 1000 begrenzt. Bereinigung löscht je Tabelle höchstens 100 abgelaufene Einträge pro Start oder erfolgreichem Callback. Beim Start bleiben diese Löschungen auch dann bestehen, wenn die anschließende Kapazitätsprüfung HTTP 429 liefert. Start, Callback und Exchange verwenden das vorhandene IP-Limit `THROTTLER_SESSION_IP_PER_MIN` mit Standard 10 pro Minute. Discovery und Anbieteraufrufe besitzen jeweils zwei Sekunden Timeout. Bei Ausfall bleiben Health und öffentliche Nutzung verfügbar.

Die additive Migration ergänzt `auth_identities`, `oidc_transactions` und `oidc_handoffs`. Vorhandene `users.id`, Login-Token und Bearer-Sessions bleiben erhalten. E-Mail-Gleichheit erzeugt HTTP 409 `identity_conflict`, keine Verknüpfung. Bei bekannter Identität bleibt der lokale Kontakt unverändert, auch wenn der Broker eine andere E-Mail liefert. Verknüpfen und Entfernen weiterer Identitäten bleiben offen.

Vor einem echten Deploy müssen Proxy- und Zugriffslogs Callback-Queries auslassen. Der Server loggt keine Anbieterantworten oder Callbackwerte. Der lokale Testprovider beweist weder Cloudflares Allow-Policy noch Subjectstabilität beim echten Login. Backup, Restore, Pilot und Produktionsfreigabe bleiben getrennte Betriebsschritte.

`users.id` bleibt der Eigentümer von Fahrten, Inventar und Progression. Nur `(issuer, subject)` identifiziert einen externen Login. E-Mail-Gleichheit verknüpft keine Accounts. Bei einer Kollision ist der bestehende Account nachzuweisen. Zusätzliche Identitäten verlangen eine angemeldete Session, frische Reauthentifizierung und beide Besitznachweise; die letzte Login-Methode darf nicht entfernt werden. Issuer-/Subject-Stabilität wird im Pilot geprüft. Strava-OAuth erteilt separat Uploadrechte, niemals durch den Broker-Login.

### Strava-Verbindung und ausdrückliche Auslieferung

[E10-03](specs/E10-03-strava-connection.md) liefert die Verbindung. [E10-04](specs/E10-04-complete-ride-delivery.md) ergänzt Browserbedienung und dauerhafte Uploadaufträge. `STRAVA_MODE` ist standardmäßig `disabled`. `enabled` verlangt `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI`, `STRAVA_TOKEN_KEY` und den privaten `STRAVA_WEBHOOK_VERIFY_TOKEN` mit 64 Hexzeichen. Der OAuth-Callback ist die kanonische API-Adresse mit Pfad `/v1/strava/callback`. Produktion verlangt HTTPS. Der Verschlüsselungsschlüssel enthält genau 32 Byte, kodiert als 64 kleingeschriebene Hexzeichen oder kanonisches Base64. Werte bleiben privat auf dem Server. Ohne bestätigte `STRAVA_WEBHOOK_SUBSCRIPTION_ID` meldet eine fehlende Verbindung `registration_required`. Der Verbindungsstart bleibt gesperrt.

| Route                           | Vertrag                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/strava/connection`     | Eigener Status mit gültigem Bearer, ohne Zugangsdaten.                                                             |
| `POST /v1/strava/connect-start` | Bearer, exakter `CLIENT_ORIGIN` und `{action:'connect',channel:<UUID>}` starten eine browsergebundene Transaktion. |
| `GET /v1/strava/callback`       | Öffentlicher Callback prüft einmaligen State und Browsercookie vor dem Anbieteraufruf.                             |
| `POST /v1/strava/confirm`       | Derselbe Eigentümer bestätigt `{code}` mit frischem Bearer, passendem Browsercookie und exaktem Origin.            |
| `POST /v1/strava/disconnect`    | Bearer, exakter Origin und `{action:'disconnect'}` sperren lokal und fordern den Anbieterwiderruf an.              |
| `GET /v1/strava/rides/:rideId`  | Eigene Fahrt liefert Sperrgrund, vollständiges Einwilligungsangebot oder vorhandenen Auftrag.                      |
| `POST /v1/strava/rides/:rideId` | Bearer, exakter Origin und `{action:'upload',consent}` erzeugen höchstens einen Auftrag je Fahrt.                  |

Transaktionen gelten fünf Minuten, Übergaben 60 Sekunden. Der Callback speichert Zugangsdaten zunächst unbestätigt. Erst die Bestätigung aktiviert die Verbindung. Ein anderes Konto verbraucht die Übergabe nicht. Ein Strava-Athlet gehört höchstens einem Voltonaut-Account. Es gibt keinen automatischen Transfer.

`strava/` besitzt Transaktionen, Verbindungen und AES-256-GCM-Chiffrate aus Migration `0003`. Eigentümer, Athlet und Schlüsselversion sind authentifiziert gebunden. Status und Antworten enthalten keine Tokens. Trennen setzt vor dem Netzwerkaufruf dauerhaft `revocation_pending`. Beim bloßen Trennen entfernt nur bestätigtes HTTP 200 des Widerrufs das Chiffrat. Fehler oder Timeout erhalten die Sperre und erlauben einen erneuten ausdrücklichen Widerruf. Ausnahme: Die bestätigte Kontolöschung nach E5-11 entfernt Verbindung und Chiffrat atomar ohne Anbieterantwort; der externe Widerruf und bereits übertragene Aktivitäten bleiben davon unberührt.

Die additive Migration `0005_strava_delivery` erhält vorhandene verschlüsselte Verbindungen und ergänzt eindeutige Verbindungsgenerationen, Tokenrevisionen und koordinierte Credentialarbeit. `strava_deliveries` speichert Auftrag, Einwilligung, Versandzustand und bekannte Anbieterbelege. `strava_rate_budget` koordiniert das appweite Budget auch über Prozessneustarts. Die historischen Migrationen `0000` bis `0004` bleiben unverändert.

Eine Einwilligung bindet Fahrt, Nutzlast- und Exporthash, `tcx-1`, Zielathlet, Verbindungsgeneration, Quellenrichtlinie und Hinweisrevision. `StravaDeliveryStep` prüft diese Bindungen unmittelbar vor dem einmaligen Dispatchcommit. `preparing` darf nach Ablauf übernommen werden. Nach dem Dispatchcommit bleibt ein verlorenes POST-Ergebnis dagegen `submission_unknown` und wird nicht erneut versendet. Eine bekannte Upload-ID bleibt bei Pollfehlern, Trennen und Neustart erhalten. Eine unklare Tokenrotation sperrt weitere Credentialarbeit, statt einen alten Refresh-Token erneut zu verwenden.

`StravaDeliveryStep` führt je Aufruf genau einen fälligen Schritt vollständig aus: Upload, Verarbeitungspoll oder Hinweisprüfung. Der Schritt übernimmt Credential-Lease, Refresh, Budgetreservierung und -abrechnung, Dispatchcommit, Anbieteraufruf, Ergebnisvermerk und Freigabe ([E0-06](specs/E0-06-strava-delivery-step.md)). `StravaScheduler` enthält nur Takt, Widerrufsschleife und Abbau. `StravaProvider.submit` verlangt einen festgeschriebenen Strava-Versuch. Nur `StravaDeliveryStore.dispatch` erzeugt diesen nominalen Wert; Literale und Spread-Kopien typprüfen nicht. Ein POST ohne vorherigen Dispatchcommit wird damit vom Typsystem abgelehnt. Dass ein Versuch nur einmal gesendet wird, sichert weiterhin der einzige Aufrufer im Schritt. Eine Reservierung ohne gesendete Anfrage gibt der Schritt an das dauerhafte Budget zurück. Vor der Tokenentschlüsselung setzt die Hinweisprüfung die 60-s-Sperrfrist, damit eine fehlerhafte Verbindung andere Hinweise nicht blockiert.

Der Anbieter erhält ausschließlich gespeicherte servereigene TCX-Bytes mit `sport_type=VirtualRide`, `trainer=1`, stabiler `external_id` und `visibility=only_me`. Erst ein bestätigter Verarbeitungspoll mit Activity-ID bedeutet Erfolg. Die Sichtbarkeitsanforderung ist kein Nachweis der tatsächlichen Sichtbarkeit beim echten Anbieter. HTTP 201 allein bleibt Verarbeitung. Sim und beschleunigte Quellen erzeugen kein Versandangebot.

Die Browseroberfläche öffnet nach Nutzerklick eine speicherfreie Bridge mit nativem BroadcastChannel. Das Elternfenster hält den ursprünglichen Bearer auch ohne Sessionpersistenz. Callback und Bestätigung verlangen weiterhin das ursprüngliche HttpOnly-Cookie. Kontowechsel widerruft die lokale Fähigkeit. Die gebaute Finishseite entfernt Querywerte inline vor der ersten Skriptanforderung. Popup und Finishseite haben keinen nativen Opener.

`GET /v1/strava/webhook` beantwortet eine eindeutige Subscription-Challenge mit konstantzeitlich geprüftem privatem Token. Dieser Endpunkt funktioniert vor der Registrierung. Öffentliche JSON-POSTs sind vor dem Parsing auf 8 KiB begrenzt, auch bei anderen vom Framework akzeptierten Request-Targets. Maßgeblich ist der von Express erkannte Pfad, nicht die rohe URL. Die allgemeine 8-MiB-Grenze bleibt bestehen. Nur passende Athleten-Deautorisierungshinweise zur konfigurierten Subscription erhöhen die dauerhafte Hinweisrevision. Ereignisse sind keine Autorität für Löschung oder Widerruf. Nach Uploads und bekannten Verarbeitungspolls lässt der Scheduler `StravaDeliveryStep` höchstens einen fälligen Hinweis prüfen. Er verwendet bestehende Credential-Leases, Generationen, Tokenrevisionen und appweite Read-Budgets. Neue Hinweise setzen die Rückhaltefrist nicht zurück. Eine gültige Antwort von `/api/v3/athlete` bestätigt nur die zuvor erfasste Hinweisrevision.

Das dauerhafte Budget unterscheidet Uploads, bekannte Polls und ungeprüfte Autorisierungshinweise. Hinweise dürfen höchstens die abgerundete Hälfte jeder tatsächlichen Gesamt- und Read-Grenze im kurzen und täglichen Fenster verwenden. Bekannte Arbeit behält die vollständige Kapazität. Offene Reservierungen bleiben berücksichtigt. Die unbekannte Startkapazität von 1 bleibt konservativ und erlaubt keinen Hinweis-GET. Später gelernte Header ziehen bereits zurückgestellte Hinweise nicht vor. Das ist eine interne Kapazitätsschutzpolitik ohne garantierte sofortige Prüfung, keine Erhöhung der Anbieterquote.

Ein 401 allein beweist keine Deautorisierung. Abgelaufene oder abgewiesene Access-Tokens führen über den bestehenden koordinierten Refresh. Für einen spezifischen ungültigen Refresh-Token fehlt noch ein dokumentierter oder realer Wire-Beleg. Generische 400/401-Antworten bleiben deshalb unklare Rotation, nicht bestätigter Widerruf. Aufnahmen, Chiffrate und bekannte Upload-IDs bleiben erhalten. Verspätete Ergebnisse stoppen keine neue Verbindungsgeneration.

`STRAVA_TEST_PROVIDER_ORIGIN` ist ausschließlich für Loopback-Protokollanbieter in Entwicklung und Test erlaubt. Produktion lehnt diese Einstellung ab. `mise exec -- node scripts/ride-delivery-integration/verify.mjs` prüft die gebaute Gesamtstrecke mit tatsächlicher Aufnahme, kompiliertem Server und lokalen Anbietern. `mise exec -- node serververification.mjs` bleibt der ergänzende Servernachweis. Den getrennten Operatorbetrieb beschreibt [Strava aktivieren](../deploy/STRAVA.md). Echte Zustimmung, Callbackfreigabe, Proxylogs, Schlüsselbetrieb, Sichtbarkeit und Datenschutz bleiben getrennte Abnahmen.

```ts
// packages/shared/src/api/rides.ts (Zod-Schema, Typ per z.infer)
interface RideUpload {
  rideId: string;
  routeId: string;
  clientVersion: string;
  startedAt: string;
  profileAtStart: Pick<RiderProfile, "massKg" | "heightCm"> & { bikeMassKg: number };
  devices: {
    trainer: string;
    trainerSource: "ftms" | "cps" | "sim";
    hr?: string;
    controller?: string;
  };
  samples: Array<{ t: number; p: number; c: number; hr?: number; d: number; g: number }>; // 1 Hz
  claimed: {
    distanceM: number;
    elevM: number;
    energyKj: number;
    pickups: string[];
    segments: Array<{ id: string; timeS: number }>;
  };
}
```

## Plausibilitätsprüfung / Anti-Cheat-Grundlagen

[E10-02](specs/E10-02-replay-consistency.md) implementiert eine reine V2-Nachrechnung mit vollständigem Initialisierungsjournal. `assessRecordingV2` liefert ausschließlich `unverified`, `rejected` oder `replayed`. E10-04 verwendet diese Nachrechnung im kanonischen `/v2/rides`-Pfad. Konsistenz und Quellenrichtlinie bleiben getrennt. Die folgenden 3-Prozent- und Annahmeregeln sind weiterhin Zielskizzen, nicht die V2-Prüfung. V2 vergleicht diskrete Werte und Enginezeiten exakt und übrige Messwerte mit enger numerischer Toleranz.

Der Server **rechnet nach**, statt Client-Werten zu vertrauen:

1. **Struktur:** Zeitstempel monoton, 1-Hz-Raster ± Toleranz, Dauer ≤ Wanduhr zwischen `startedAt` und Upload, max. 6 h, `rideId` nicht doppelt.
2. **Physik-Rekonstruktion:** Distanz, Höhenmeter und Segmentzeiten aus Leistungs-Samples + Route + `profileAtStart` mit `@voltonaut/engine` (derselbe Code wie im Browser) neu berechnen; Abweichung > 3 % → `flagged`.
3. **Grenzen:** Spitzenleistung ≤ 2 000 W; 20-min-Leistung ≤ 6,5 W/kg; 1-min ≤ 12 W/kg; Kadenz ≤ 200 rpm; Leistung > 0 bei Kadenz 0 über > 10 s → verdächtig.
4. **Quelle:** `trainerSource = 'sim'` → `accepted`, aber 0 XP / 0 Volts.
5. **Pickups:** nur Blitze anerkennen, deren Distanzmarke laut rekonstruierter Distanz überfahren wurde.
6. **Limits:** Volts-Tageslimit (3 000), max. 4 Fahrten/Tag mit Vergabe.
   `flagged` → Fahrt gespeichert, aber keine Vergabe bis manuelle Freigabe (Admin-CLI). Ehrlich: Das hält nur Gelegenheits-Schummeln auf; manipulierte Clients mit plausiblen Fake-Daten sind ohne Hardware-Signatur nicht erkennbar. Für einen Freundeskreis reicht das.

## Offline-first-Sync (Client `sync/`)

[E10-01](specs/E10-01-local-ride-recording-tcx.md) speichert abgeschlossene Aufnahmen separat und erlaubt TCX-Downloads. [E5-09](specs/E5-09-account-bound-sync.md) ergänzt manuelle Kontoaktionen. Das Archiv bleibt unverändert und besitzt keinen Aufnahme-Eigentümer. Erst die bestätigte Zuordnung speichert eine vollständige Kopie in `voltonaut-account-outbox`. API-Origin und kanonische Fahrt-ID bilden den atomaren Schlüssel. Der validierte Account bleibt unveränderlicher Eigentümer dieser lokalen Zuordnung. Datenbankversion 2 ergänzt `deleted-owners`: `purgeOwner` löscht nur Einträge eines exakten API-Origin/Kontos und setzt den Löschmarker in derselben Transaktion. `claim`, `update` und `list` respektieren diesen Marker.

Das Panel liest das eigene Serverprofil und zusammengefasste Serverfahrten. Ein Profil-Push verwendet nur den zuletzt gespeicherten lokalen Stand. Ein Profil-Pull verändert lokale Einstellungen erst nach Bestätigung und erfolgreichem Speichern. Laufende Fahrtparameter bleiben eingefroren. Ausstehende lokale Profile werden nicht durch GET überschrieben. Logout entfernt den Kontospiegel sofort und widerruft laufende Fähigkeiten. Schon serverseitig angenommene Requests können dennoch abschließen. Ihre ausstehenden Snapshots bleiben bis zur idempotenten Wiederholung durch denselben Account erhalten.

Die Outbox enthält höchstens 20 Einträge einschließlich Profilaufträgen. Netzwerkfehler und Serverfehler erhalten Backoff und höchstens fünf Versuche je Budget. Es gibt keine Retry-Schleife. Bereits bestätigte Aufträge werden nach erneuter validierter Anmeldung oder einem Online-Ereignis versucht. Ein ausgeschöpftes Budget beginnt nur nach ausdrücklichem Retry und Rückhaltefrist neu. HTTP 401 verlangt erneute Anmeldung. Andere Zugriffs-, Konflikt- und Vertragsfehler bleiben blockiert. Ohne bestätigten dauerhaften Snapshot startet kein Upload. Speicherfehler blockieren weder Aufnahme noch TCX. Die folgenden Punkte zu Belohnungen, Käufen und Konfliktauflösung beschreiben weiterhin den Zielstand.

- Beim Start: Cache aus IndexedDB optional laden; Storagefehler blockieren keine Fahrt. Nur mit vorhandener Session optional `GET /v1/me` im Hintergrund. Kein automatischer Login; Gast und Sim starten ohne Authentifizierung, Storage oder Netzwerk.
- Nach der Fahrt: `RideUpload` in **Outbox** (IndexedDB) → Upload mit Retry/Backoff; UI zeigt XP/Volts als „vorläufig" bis Server-Antwort.
- Käufe und Ausrüstungsänderungen nur **online** (Kauf ist Server-Transaktion); Ausrüstung offline nur aus dem gecachten Inventar.
- Automatische Progress-Checkpoints nutzen eine eigene IndexedDB `voltonaut-progress-outbox`. Sie werden nur nach ausdrücklicher Zustimmung und nur für BLE gespeichert, maximal 1200 Batches pro Konto/Origin, ohne stille Eviction. Lokale Batches haben höchstens 120 Facts/6 Sekunden; Serverbereiche höchstens 1200 Facts/1200 Checkpoints/60 Sekunden. Sim erreicht weder IDB noch Server. Bestätigte Batches werden erst nach serverseitiger Quittung gelöscht; Widerruf blockiert neue Uploads, löscht aber keine bestätigten Bereiche. Nur eine bestätigte Kontolöschung entfernt alle Progress-Zeilen dieses Kontos und API-Origins, lokal wie serverseitig; der Kontoexport enthält Consent, Journale und Bereiche ohne Session-Hashes. Consent meldet `rewardsAvailable`; deaktivierte Quellenpolitik blockiert Aktivierung. Checkpoint-Zeiten sind auf Serverzukunft plus fünf Minuten und Offline-Alter von sieben Tagen begrenzt.

`GET` und `PUT /v1/me/progress-consent` sowie `POST /v1/progress/checkpoints` sind authentifizierte `no-store`-Endpunkte. Konto und `sessionTokenHash` kommen ausschließlich aus `SessionPrincipal`. `POST /v1/progress/checkpoints` akzeptiert genau `{consentVersion, sessionGeneration, checkpoints}` und antwortet mit `{range}`. Die Schreibtransaktion prüft die aktive Session, die aktuelle Consent-Zeile, Journalbindung, Tick- und Sequenzfolge sowie die Physikbeiträge. `RIDE_SOURCE_POLICY=disabled` lehnt jede Annahme ab. Nur `declared_ble_v1` erlaubt `source: "ble"`. Der Belohnungstag ist das UTC-Datum des letzten `endedAtMs`; ein Tagesrückschritt wird abgewiesen. Journal-Highwater und Volts-Beleg committen gemeinsam. Ein identischer Präfix eines größeren oder kleineren Retry-Batchings liefert denselben Beleg. Lücken, Überlappungen und geänderte Nutzlasten liefern 409 ohne Buchung. Progress erzeugt keine `rides` und keine XP-/Level-Buchung.

- Konflikte: Server gewinnt; Profil-Änderungen per `updated_at` (last-write-wins).

## Live-Gruppenfahrten (WebSocket)

- Raum = `routeId` + optional privater Raumcode. Anzeige der anderen Fahrer (Name, Avatar-Config, Distanz, W/kg optional).
- Kein Windschatten, keine Rennen in v1.

```ts
type ClientMsg =
  | { t: "auth"; sessionToken: string }
  | { t: "join"; v: 1; room: string }
  | {
      t: "state";
      seq: number;
      distanceM: number;
      lap: number;
      speedMps: number;
      powerW: number;
      cadenceRpm: number;
    } // 2–4 Hz
  | { t: "leave" };
type ServerMsg =
  | { t: "welcome"; serverTimeMs: number; riders: RemoteRiderInfo[] }
  | { t: "joined"; rider: RemoteRiderInfo }
  | { t: "left"; userId: string }
  | {
      t: "snapshot";
      serverTimeMs: number;
      riders: Array<{ id: string; d: number; lap: number; v: number; p: number; c: number }>;
    } // 4 Hz
  | {
      t: "error";
      code: "unauthorized" | "room_full" | "bad_version" | "rate_limited";
      msg: string;
    };
```

Client interpoliert Remote-Fahrer ~250 ms in der Vergangenheit; Positionen nur als Distanz entlang der Route. Limits: 50 Fahrer/Raum, 10 Nachrichten/s, 1 KB/Nachricht.

## Deployment auf den Hetzner-VPS (in E0 dokumentiert; echtes Deploy = optionale Aufgabe E0-opt)

### Prozessende und offene Verbindungen

Der Bootstrap aktiviert Nests `forceCloseConnections` und Shutdown-Hooks. Bei SIGTERM schließt der Express-Adapter alle erfassten TCP-Verbindungen, auch aktive Requests. Damit blockieren Verbindungen ohne HTTP-Bytes keinen Neustart. Das ist kein Drain laufender HTTP-Antworten. Eine Antwort kann nach einem erfolgreichen Datenbankcommit verloren gehen. Wiederholungen derselben Fahrt lesen weiterhin den unveränderlichen gespeicherten Beleg.

Nest führt die Modulabbau-Hooks vor dem HTTP-Adapterabbau aus. Der Strava-Scheduler signalisiert dabei den Abbruch und wartet auf seine laufende Arbeit. Dauerhafte Versandzustände bleiben maßgeblich. Ein unbekanntes POST-Ergebnis erlaubt keinen erneuten Versand. Bekannte Upload-IDs bleiben für spätere Polls erhalten. Der Prozessregressionstest startet den tatsächlichen kompilierten Bootstrap mit lokaler OIDC-Konfiguration und hält beim SIGTERM eine TCP-Verbindung ohne Nutzdaten offen.

### Bereitstellung

Geprüft am 19.11.2026 (nur lesend): Ubuntu 24.04, 2 vCPU, 4 GB RAM, rund 18 GB frei. Auf dem VPS läuft bereits Financensor (Docker Compose); `financensor-traefik-1` (`traefik:v3.6`) belegt Ports 80/443. Deshalb kein Caddy und kein systemd – der Server kommt als Container hinter diesen Traefik (ADR-004). SSH-Deploy-Zugang ist eingerichtet: DNS-A-Record `api.voltonaut.stammkneipe.dev` → VPS-IP, **unproxied** (damit Traefiks `letsencrypt`-Resolver das Zertifikat direkt zieht), Deploy-Secrets und `DEPLOY_USER` im GitHub-Environment `production`.

Am 21.11.2026 genehmigt Henry den Produktionsdeploy und einen einmaligen Provisionierungs-Workflow für die bestehenden OIDC-Secrets. Er entscheidet ausdrücklich gegen ein Backup. [ADR-020](decisions/ADR-020-explicit-production-provisioning.md) ersetzt die bisherige verpflichtende S3-Startvoraussetzung durch ein optionales Overlay. Persistentes SQLite bleibt bestehen. Ohne Backup gibt es keinen zugesagten Offhost-Restore. Den tatsächlichen Release- und Prüfstand hält [E0-04](specs/E0-04-production-rollout.md) fest.

Web und API sind produktiv. Das erste Release `916edbb` und der Folgestand `5bcec67` sind getrennt in [E0-04](specs/E0-04-production-rollout.md) belegt. Für den geprüften Folgestand sind der tatsächliche native AMD64-Container, UID-1000-SQLite, sieben Migrationen, öffentliche Health mit gültigem TLS, Credential-CORS und der reale OIDC-Einstieg bestätigt. Henry hat die Produktionsjobs manuell freigegeben. Sein persönlicher Login-Pilot bleibt offen. Seit seinem Auftrag vom 23.11.2026 bleiben `SERVER_DEPLOY_ENABLED=true` und die Pages-Produktionseinstellungen dauerhaft aktiviert. Dem GitHub-Pages-Job fehlt noch sein dediziertes Deploytoken. API-Releases behalten ihre menschliche Produktionsfreigabe.

Die API auf `a504e35` besitzt inzwischen acht Migrationen und serverseitig aktiviertes Strava mit bestätigter Anwendungssubscription. Private OIDC-, Schlüssel- und Registrierungsdateien bleiben über den kontrollierten Reload desselben Images und Volumes erhalten. [E10-06](specs/E10-06-real-strava-activation.md) trennt diese Betriebsnachweise von persönlichem OAuth, realem Fahrtpilot und Anbieterbedingungen. Der Queryplan-Fix `61ca9c0` besteht den unveränderten nativen Budgettest in fünf vollständigen Gates. Der öffentlich geprüfte Webclient verwendet bereits diesen Stand; die kompatible API erhält den privaten SQL-Fix nach ihrer eigenen Produktionsfreigabe. HTTP-Verträge bleiben zwischen beiden Ständen gleich.

1. CI (`deploy-server.yml`, nur nach grünem `mise run check` auf `main`, Grep `vars.SERVER_DEPLOY_ENABLED`): Docker-Image lokal bauen (`docker build -f deploy/Dockerfile`, Tag = Git-SHA, Node-Pin 24.22.3 im Image) und per SSH über die Pipe übertragen (`docker save | ssh "gunzip | docker load"`) – **kein** Registry-Push, daher wird auch kein GHCR-Token gebraucht; ein späterer Wechsel auf `ghcr.io/henrysachs/voltonaut-server` bleibt möglich (dann `docker compose pull` im Skript).
2. Per SSH `deploy/` nach `/srv/voltonaut` übertragen und `deploy.sh deploy <tag>` ausführen: `docker compose up -d` mit neuem Tag, danach `curl -f https://api.voltonaut.stammkneipe.dev/healthz`; bei Fehler automatischer Rollback auf das in `state/previous-tag` gemerkte vorherige Image-Tag.
3. Umsetzung (im Repo unter `deploy/`; Netz `financensor_default` und Certresolver `letsencrypt` sind bereits aus der Financensor-Compose ablesbar und eingetragen):
   - `Dockerfile`: Multi-Stage-Build, `pnpm --filter @voltonaut/server deploy --prod` erzeugt das Standalone-Bundle (dist + prod-Node-Modules).
   - `compose.yaml`: Dienst `server` (lokales Image `voltonaut-server:<tag>`, Host-Env `0.0.0.0`, SQLite-Volume, Traefik-Labels: Host-Rule `api.voltonaut.stammkneipe.dev`, Entrypoint `websecure`, Certresolver `letsencrypt`, Service-Port 3000, Healthcheck per Node-fetch auf `/healthz`).
   - Dienst `litestream`: ausschließlich über `compose.backup.yaml` und `VOLTONAUT_BACKUP_FILE` ausdrücklich wählbar. Im aktuellen Produktionsauftrag nicht aktiv. Der optionale Modus verlangt weiterhin echte Ziel- und Zugangsdaten sowie erfolgreiche Replikations-Healthchecks.
   - Kein eigener Proxy, keine Bindung an Port 80/443.
   - Zusätzliches Observability-/Prometheus-Netz bleibt **E0-opt** (ADR-010, `11-observability.md`); OTLP-Traces und interne `/metrics` sind bewusst noch nicht verdrahtet.
4. Node läuft im Image (dieselbe per mise gepinnte Version), nicht als Host-Paket. Caddy-Config und systemd-Unit sind aus dem Repo entfernt.
5. Secrets: `DEPLOY_SSH_KEY`, `DEPLOY_HOST` als GitHub-Secrets (Environment `production` mit manueller Freigabe), `DEPLOY_USER` als Environment-Variable, Mail-API-Keys und Litestream-Zugang nur in der Env-Datei auf dem VPS – nie im Repo. DNS-Record und Deploy-Secrets stehen (19.11.2026); der Deploy-Workflow bleibt trotzdem inaktiv, bis Henry die Repository-Variable `SERVER_DEPLOY_ENABLED` auf `true` setzt (`if: vars.SERVER_DEPLOY_ENABLED == 'true'`).

## Betrieb & Sicherheit

- CORS im OIDC-Modus: exakt der konfigurierte `CLIENT_ORIGIN`, mit Credentials und gleicher Site für Web und API. Lokal derselbe Loopback-Hostname. Kein produktiver Login von Pages-Aliasen. Rate-Limits pro IP und Account (`@nestjs/throttler`), besonders auf `/auth/*`.
- Anwendungssession-Token nur gehasht speichern (SHA-256). Anwendungssessions gelten standardmäßig 30 Tage gleitend, OIDC-Transaktionen fünf Minuten und SPA-Übergaben 60 Sekunden (E5-06). Transaktionen und Übergaben sind einmalig und browsergebunden. Protokollprüfung durch die OIDC-Bibliothek, keine Token oder Secrets in URL, Logs oder Frontend-Bundle (ADR-013).
- OIDC-Client-Secret nur serverseitig. Henrys konkrete Freigabe vom 21.11.2026 erlaubt die einmalige sichere Übergabe der bestehenden GitHub-Produktionssecrets per Workflow nach ADR-020. Das erlaubt weder Secret-Ausgabe noch blinde Rotation oder Überschreiben vorhandener Konfiguration. Keine Tokens im Chat anfordern.
- Secrets (Mail-API-Keys, Deploy-SSH-Key, Cloudflare-Token) nie im Repo; Deploy-Workflow erst nach Henrys Freigabe.
- Datenschutz: E-Mail + Fahrtdaten = personenbezogen → Export/Löschung von Anfang an, Datenschutzhinweis im Client.
- Monitoring: `/healthz` öffentlich; strukturierte Logs, interne `/metrics` und OTel-Traces laut `11-observability.md` (ADR-010). `/metrics` nie über Traefik.
