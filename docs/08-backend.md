# 08 – Backend: Accounts, Ökonomie, Fahrten, Gruppenfahrten

Server auf Henrys **vorhandenem Hetzner-VPS** (ADR-004). Er ist **autoritativ** für Accounts, Inventar, XP/Level, Volts und Fahrthistorie (ADR-005) und betreibt die Live-Räume für Gruppenfahrten. Der Client bleibt eine statische Seite (**Cloudflare Pages**, ADR-009) und ist **offline-first**: Solo-Fahren funktioniert immer, auch ohne Server (Gastmodus / Offline-Cache).

## Stack (entschieden)

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
| `progression/`                                                                                                                                                                                                                                          | XP, Level, Badges, PBs aus akzeptierten Fahrten (nutzt `@voltonaut/rules`)          | `progression`, `badges`, `personal_bests`                                                               |
| `rides/`                                                                                                                                                                                                                                                | Upload, Plausibilitätsprüfung (nutzt `@voltonaut/engine` zur Nachrechnung), Vergabe | `rides`, `ride_samples`                                                                                 |
| `live/`                                                                                                                                                                                                                                                 | `LiveGateway` (`@WebSocketGateway`, `WsAdapter`), Räume In-Memory                   | –                                                                                                       |
| `catalog/`                                                                                                                                                                                                                                              | Item-Katalog, Level-Tabelle aus `@voltonaut/rules`                                  | read-only                                                                                               |
| Regel: ein Modul besitzt seine Tabellen (Drizzle-Schema-Datei liegt im Modul); andere Module nutzen dessen exportierten Service, nie fremde Tabellen direkt (per dependency-cruiser: `apps/server/src/<a>/**/*.schema.ts` nur aus `<a>/` importierbar). |

## Datenmodell (Skizze)

### Implementierter Teilschritt E5-07

[E5-07](specs/E5-07-owned-profile-rides.md) implementiert ausschließlich das eigene Fahrerprofil und dauerhafte lokale V1-Aufnahmen. Die folgenden SQL- und API-Skizzen bleiben der weitergehende Zielstand.

- `GET /v1/me/profile` liefert `missing` oder `present` mit Profil und UTC-Änderungszeit. `PUT` validiert Profil und Fahrrad strikt.
- `POST /v1/rides` akzeptiert `CompletedLocalRideSchema` als unkomprimiertes JSON bis 8 MiB. Schemafehler liefern 422, ungültiges JSON weiterhin 400, zu große Bodies 413. Komprimierte Bodies werden mit 415 abgelehnt. Fehlermeldungen enthalten keine rohe Nutzlast.
- Alle gespeicherten V1-Aufnahmen haben ausschließlich `assessment: {status:'unverified',reason:'legacy_missing_replay'}`. Ohne vollständigen Physik-Anfangszustand und Ereignisse gibt es keine Replay-Prüfung, Belohnung oder Annahme als geprüfte Fahrt.
- Globale UUID-Eindeutigkeit, kanonische geparste Nutzlast, SHA-256 und ursprünglicher Beleg liegen in derselben SQLite-Transaktion. Erstupload und identische Wiederholung liefern HTTP 200 mit demselben gespeicherten Beleg. Eine abweichende Nutzlast liefert 409 `ride_id_conflict`. Eine fremde UUID liefert auch beim Upload 404.
- Das gemeinsame `RideIdSchema` normalisiert UUIDs beim API-Upload, Detailpfad und Cursor auf Kleinschreibung, vor Hash und Speicherung. Lokale V1-Dateien und Auth-Identifikatoren werden nicht umgeschrieben. Ein Route-Guard prüft den Medientyp vor der Zod-Bodyvalidierung. `text/plain` liefert 415, gültiges JSON mit Charset bleibt erlaubt.
- `GET /v1/rides/:rideId` liefert eigene Aufnahme und aktuelle Bewertung. Die Liste enthält keine Samples, ist auf 20 Einträge voreingestellt und auf 50 begrenzt. Cursor und Sortierung verwenden aufsteigende UUIDs, nicht die Aufnahmezeit.
- Jeder Zugriff ist an `SessionPrincipal.userId` gebunden. `GET /v1/me` bleibt Auth-Verantwortung. Es gibt keine automatische Löschung. Uploads sind pro Account auf 30 Anfragen pro Minute begrenzt, auch bei Wiederholungen.

Die Module definieren `createAccountsTables(userIdColumn: SQLiteColumn)` und `createRidesTables(userIdColumn: SQLiteColumn)` mit echten `.references()`-Fremdschlüsseln. Nur der Composition Root `src/schema.ts` importiert `users` und beide Fabriken. Er exportiert konkrete Tabellen für Drizzle Kit. `AppModule` übergibt die Tabellen an `AccountsModule.register` und `RidesModule.register`. Services injizieren `DRIZZLE` und ausschließlich eigene Tabellen. Ein Schema-Registry oder Import fremder Modul-Schemas ist dafür nicht nötig.

Die Datenmigration in diesem Teilschritt ist vorläufig. Nach Integration der getrennten Auth-Migration erzeugt der Parent die endgültige Reihenfolge und den Snapshot neu. `0000` bleibt unverändert. Der Browser lädt diese Daten noch nicht hoch.

```sql
users(id TEXT PK, email TEXT /* Contact attribute, not an identity key */, created_at, deleted_at)
auth_identities(user_id REFERENCES users(id), issuer TEXT, subject TEXT, UNIQUE(issuer,subject))
sessions(token_hash TEXT PK, user_id, created_at, last_seen_at, expires_at, user_agent)
-- Server-owned login transactions: state, nonce, PKCE verifier, browser binding, expiry, one-time consumption.
-- login_tokens from PR #6 remain only for explicitly selected legacy operation until cutover.
profiles(user_id PK, display_name, mass_kg, height_cm, ftp_w, max_hr, bike_json, avatar_json, updated_at)
inventory(user_id, item_id, source TEXT /* default|level|badge|shop|distance */, acquired_at, PK(user_id,item_id))
volts_ledger(id PK, user_id, delta INT, reason TEXT /* ride|purchase|bonus|admin */, ref_id, created_at)
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
GET  /v1/auth/config                                              → { mode: disabled|oidc|magic-link }
GET  /v1/auth/oidc/start                                           → 302 Anbieter, Browserbindungscookie
GET  /v1/auth/oidc/callback                                        → 302 CLIENT_ORIGIN/auth/finish?code=<Übergabe>
POST /v1/auth/oidc/exchange      { code }                           → { sessionToken, user }
# Exchange requires original browser cookie and exact CLIENT_ORIGIN header.
# No bearer, access, or refresh tokens in redirect URLs.
POST /v1/auth/logout                                              → 204
GET  /v1/me                                                       → { user, profile, progression, voltsBalance, inventory[], badges[], pbs{} }
PUT  /v1/me/profile             RiderProfile                      → profile          (Validierung: Bereiche wie 03 §2a)
PUT  /v1/me/avatar              AvatarConfig                      → avatar           (nur Items aus dem Inventar)
GET  /v1/catalog                                                  → { items[], levels[], version }   (öffentlich, cachebar)
POST /v1/shop/purchase          { itemId, expectedPriceVolts }    → { voltsBalance, inventoryItem } | 409 insufficient_volts | 409 already_owned
POST /v1/rides                  RideUpload (gzip)                 → { status, xpAwarded, voltsAwarded, newBadges[], newPbs[], levelUp? }
                                (idempotent: gleiche rideId → gleiche Antwort)
GET  /v1/rides?cursor=…                                           → { rides: RideSummary[], nextCursor }
GET  /v1/me/export                                                → JSON aller eigenen Daten
DELETE /v1/me                                                     → 202 (Account-Löschung)
WS   /v1/live                   erster Frame { t:'auth', sessionToken } → Räume (s. u.)
```

Der aktuelle `GET /v1/me` liefert ausschließlich `{user}`. Profil und Spieldaten sind Folgeeinheiten. Die Sessionantwort bleibt die bestehende `SessionResponse` aus `packages/shared`. Der Webclient muss die Übergabe mit `credentials: "include"` austauschen und den Code sofort aus der Adresszeile entfernen. Vorher darf die Abschlussseite keine fremden Ressourcen laden.

Das Browserkonto aus E5-08 verwendet `VITE_API_ORIGIN` als validierte Origin ohne Pfad, Query, Fragment oder Zugangsdaten. Lokal ist der Standard derselbe Loopback-Hostname auf Port 3000, produktiv `https://api.voltonaut.stammkneipe.dev`. Ohne gespeicherte Session und ohne Übergabe startet kein Auth-Request. Ein gespeicherter Token wird optional über `/v1/me` geprüft, ohne Fahrtbeginn abzuwarten. Die Persistenz verwendet ausschließlich `voltonaut.application-session:<API-Origin>`. Bei verweigertem Speicher bleibt die Session im Tab. Abmelden räumt lokal auch bei Serverfehler auf und benennt einen unbestätigten Widerruf. Aktive oder ungesicherte abgeschlossene Aufnahmen schützen ihre Navigation mit der Browserbestätigung.

### Auth-Konfiguration aus E5-06

`AUTH_MODE` ist in Produktion Pflicht. Erlaubt sind `disabled`, `oidc`, `magic-link`. Nur Entwicklung und Test verwenden ohne Angabe weiter den bisherigen Magic Link. OIDC und Disabled erstellen keinen Mailtransport; beide lehnen Legacy-Loginendpunkte ab. Expliziter Legacy-Produktionsbetrieb verlangt weiterhin einen echten Mailprovider und dessen Zugangsdaten.

OIDC benötigt `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` und den festen `CLIENT_ORIGIN`. Der Callbackpfad ist `/v1/auth/oidc/callback`, ohne Query oder Fragment. Produktion verlangt HTTPS. HTTP ist nur in Entwicklung und Test für Loopback zulässig, auch bei entdeckten Anbieterendpunkten. Keine Zugangsdatenwerte im Repo. Die Anwendung liest die Konfiguration, nicht GitHub-Secrets direkt.

Im OIDC-Modus enthält `CORS_ORIGINS` genau `CLIENT_ORIGIN`. CORS erlaubt Credentials. Web und API müssen dieselbe Site verwenden; lokal wird derselbe Loopback-Hostname verwendet. Das hostgebundene HttpOnly-Cookie hat `SameSite=Lax`, in Produktion zusätzlich `Secure` und den Namen `__Host-voltonaut-oidc`. Es enthält keine Anwendungssession.

Logintransaktionen gelten fünf Minuten, Übergaben 60 Sekunden. Callback-Beanspruchung geschieht atomar vor dem Anbieteraufruf über `claimed_at`. Die beanspruchte Zeile bleibt während des Aufrufs als Kapazitätsreservierung bestehen. Der erfolgreiche Callback ersetzt sie atomar durch eine Übergabe; ein Fehler benötigt einen neuen Loginstart. Datenbankfehler beim lokalen Sessioneinschub rollen dagegen die Übergabeverwendung zurück. Transaktionen einschließlich laufender Reservierungen und Übergaben sind zusammen auf 1000 begrenzt. Bereinigung löscht je Tabelle höchstens 100 abgelaufene Einträge pro Start oder erfolgreichem Callback. Beim Start bleiben diese Löschungen auch dann bestehen, wenn die anschließende Kapazitätsprüfung HTTP 429 liefert. Start, Callback und Exchange verwenden das vorhandene IP-Limit `THROTTLER_SESSION_IP_PER_MIN` mit Standard 10 pro Minute. Discovery und Anbieteraufrufe besitzen jeweils zwei Sekunden Timeout. Bei Ausfall bleiben Health und öffentliche Nutzung verfügbar.

Die additive Migration ergänzt `auth_identities`, `oidc_transactions` und `oidc_handoffs`. Vorhandene `users.id`, Login-Token und Bearer-Sessions bleiben erhalten. E-Mail-Gleichheit erzeugt HTTP 409 `identity_conflict`, keine Verknüpfung. Bei bekannter Identität bleibt der lokale Kontakt unverändert, auch wenn der Broker eine andere E-Mail liefert. Verknüpfen und Entfernen weiterer Identitäten bleiben offen.

Vor einem echten Deploy müssen Proxy- und Zugriffslogs Callback-Queries auslassen. Der Server loggt keine Anbieterantworten oder Callbackwerte. Der lokale Testprovider beweist weder Cloudflares Allow-Policy noch Subjectstabilität beim echten Login. Backup, Restore, Pilot und Produktionsfreigabe bleiben getrennte Betriebsschritte.

`users.id` bleibt der Eigentümer von Fahrten, Inventar und Progression. Nur `(issuer, subject)` identifiziert einen externen Login. E-Mail-Gleichheit verknüpft keine Accounts. Bei einer Kollision ist der bestehende Account nachzuweisen. Zusätzliche Identitäten verlangen eine angemeldete Session, frische Reauthentifizierung und beide Besitznachweise; die letzte Login-Methode darf nicht entfernt werden. Issuer-/Subject-Stabilität wird im Pilot geprüft. Strava-OAuth erteilt separat Uploadrechte, niemals durch den Broker-Login.

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

[E10-02](specs/E10-02-replay-consistency.md) implementiert separat eine reine V2-Nachrechnung mit vollständigem Initialisierungsjournal. `assessRecordingV2` liefert ausschließlich `unverified`, `rejected` oder `replayed`. Das Ergebnis vergibt weder Belohnungen noch Exportrechte. Die V1-API bleibt unverändert. Die folgenden 3-Prozent- und Annahmeregeln sind weiterhin Zielskizzen, nicht die V2-Prüfung. V2 vergleicht diskrete Werte und Enginezeiten exakt und übrige Messwerte mit enger numerischer Toleranz.

Der Server **rechnet nach**, statt Client-Werten zu vertrauen:

1. **Struktur:** Zeitstempel monoton, 1-Hz-Raster ± Toleranz, Dauer ≤ Wanduhr zwischen `startedAt` und Upload, max. 6 h, `rideId` nicht doppelt.
2. **Physik-Rekonstruktion:** Distanz, Höhenmeter und Segmentzeiten aus Leistungs-Samples + Route + `profileAtStart` mit `@voltonaut/engine` (derselbe Code wie im Browser) neu berechnen; Abweichung > 3 % → `flagged`.
3. **Grenzen:** Spitzenleistung ≤ 2 000 W; 20-min-Leistung ≤ 6,5 W/kg; 1-min ≤ 12 W/kg; Kadenz ≤ 200 rpm; Leistung > 0 bei Kadenz 0 über > 10 s → verdächtig.
4. **Quelle:** `trainerSource = 'sim'` → `accepted`, aber 0 XP / 0 Volts.
5. **Pickups:** nur Blitze anerkennen, deren Distanzmarke laut rekonstruierter Distanz überfahren wurde.
6. **Limits:** Volts-Tageslimit (3 000), max. 4 Fahrten/Tag mit Vergabe.
   `flagged` → Fahrt gespeichert, aber keine Vergabe bis manuelle Freigabe (Admin-CLI). Ehrlich: Das hält nur Gelegenheits-Schummeln auf; manipulierte Clients mit plausiblen Fake-Daten sind ohne Hardware-Signatur nicht erkennbar. Für einen Freundeskreis reicht das.

## Offline-first-Sync (Client `sync/`)

Aktueller lokaler Teilschritt ist [E10-01](specs/E10-01-local-ride-recording-tcx.md). Abgeschlossene Aufnahmen bleiben in einer separaten IndexedDB und können manuell als TCX heruntergeladen werden. Sie haben keinen Serverstatus, keine Belohnung und keinen Upload. Die folgende Outbox und die Serverhistorie bleiben Zielstand.

- Beim Start: Cache aus IndexedDB optional laden; Storagefehler blockieren keine Fahrt. Nur mit vorhandener Session optional `GET /v1/me` im Hintergrund. Kein automatischer Login; Gast und Sim starten ohne Authentifizierung, Storage oder Netzwerk.
- Nach der Fahrt: `RideUpload` in **Outbox** (IndexedDB) → Upload mit Retry/Backoff; UI zeigt XP/Volts als „vorläufig" bis Server-Antwort.
- Käufe und Ausrüstungsänderungen nur **online** (Kauf ist Server-Transaktion); Ausrüstung offline nur aus dem gecachten Inventar.
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

Geprüft am 19.11.2026 (nur lesend): Ubuntu 24.04, 2 vCPU, 4 GB RAM, rund 18 GB frei. Auf dem VPS läuft bereits Financensor (Docker Compose); `financensor-traefik-1` (`traefik:v3.6`) belegt Ports 80/443. Deshalb kein Caddy und kein systemd – der Server kommt als Container hinter diesen Traefik (ADR-004). SSH-Deploy-Zugang ist eingerichtet: DNS-A-Record `api.voltonaut.stammkneipe.dev` → VPS-IP, **unproxied** (damit Traefiks `letsencrypt`-Resolver das Zertifikat direkt zieht), Deploy-Secrets und `DEPLOY_USER` im GitHub-Environment `production`.

Stand 20.11.2026 ist keine Voltonaut-API bereitgestellt; `/srv/voltonaut` existiert noch nicht. `SERVER_DEPLOY_ENABLED=false` bleibt bestehen. Vor einer Freigabe fehlen die Übergabe der Auth-Produktionskonfiguration an den Container, ein eingerichtetes externes Backup-Ziel und ein Restore-Nachweis. Die folgenden Schritte beschreiben den vorbereiteten Deploy, keinen laufenden Dienst.

1. CI (`deploy-server.yml`, nur nach grünem `mise run check` auf `main`, Grep `vars.SERVER_DEPLOY_ENABLED`): Docker-Image lokal bauen (`docker build -f deploy/Dockerfile`, Tag = Git-SHA, Node-Pin 24.22.3 im Image) und per SSH über die Pipe übertragen (`docker save | ssh "gunzip | docker load"`) – **kein** Registry-Push, daher wird auch kein GHCR-Token gebraucht; ein späterer Wechsel auf `ghcr.io/henrysachs/voltonaut-server` bleibt möglich (dann `docker compose pull` im Skript).
2. Per SSH `deploy/` nach `/srv/voltonaut` übertragen und `deploy.sh deploy <tag>` ausführen: `docker compose up -d` mit neuem Tag, danach `curl -f https://api.voltonaut.stammkneipe.dev/healthz`; bei Fehler automatischer Rollback auf das in `state/previous-tag` gemerkte vorherige Image-Tag.
3. Umsetzung (im Repo unter `deploy/`; Netz `financensor_default` und Certresolver `letsencrypt` sind bereits aus der Financensor-Compose ablesbar und eingetragen):
   - `Dockerfile`: Multi-Stage-Build, `pnpm --filter @voltonaut/server deploy --prod` erzeugt das Standalone-Bundle (dist + prod-Node-Modules).
   - `compose.yaml`: Dienst `server` (lokales Image `voltonaut-server:<tag>`, Host-Env `0.0.0.0`, SQLite-Volume, Traefik-Labels: Host-Rule `api.voltonaut.stammkneipe.dev`, Entrypoint `websecure`, Certresolver `letsencrypt`, Service-Port 3000, Healthcheck per Node-fetch auf `/healthz`).
   - Dienst `litestream`: vorbereitetes Sidecar (`litestream/litestream:0.5.18`, exakt gepinnt), teilt das SQLite-Volume. Ein externes Replikationsziel und Zugangsdaten aus `deploy.env` sind noch einzurichten (nie im Repo).
   - Kein eigener Proxy, keine Bindung an Port 80/443.
   - Zusätzliches Observability-/Prometheus-Netz bleibt **E0-opt** (ADR-010, `11-observability.md`); OTLP-Traces und interne `/metrics` sind bewusst noch nicht verdrahtet.
4. Node läuft im Image (dieselbe per mise gepinnte Version), nicht als Host-Paket. Caddy-Config und systemd-Unit sind aus dem Repo entfernt.
5. Secrets: `DEPLOY_SSH_KEY`, `DEPLOY_HOST` als GitHub-Secrets (Environment `production` mit manueller Freigabe), `DEPLOY_USER` als Environment-Variable, Mail-API-Keys und Litestream-Zugang nur in der Env-Datei auf dem VPS – nie im Repo. DNS-Record und Deploy-Secrets stehen (19.11.2026); der Deploy-Workflow bleibt trotzdem inaktiv, bis Henry die Repository-Variable `SERVER_DEPLOY_ENABLED` auf `true` setzt (`if: vars.SERVER_DEPLOY_ENABLED == 'true'`).

## Betrieb & Sicherheit

- CORS im OIDC-Modus: exakt der konfigurierte `CLIENT_ORIGIN`, mit Credentials und gleicher Site für Web und API. Lokal derselbe Loopback-Hostname. Kein produktiver Login von Pages-Aliasen. Rate-Limits pro IP und Account (`@nestjs/throttler`), besonders auf `/auth/*`.
- Anwendungssession-Token nur gehasht speichern (SHA-256). Anwendungssessions gelten standardmäßig 30 Tage gleitend, OIDC-Transaktionen fünf Minuten und SPA-Übergaben 60 Sekunden (E5-06). Transaktionen und Übergaben sind einmalig und browsergebunden. Protokollprüfung durch die OIDC-Bibliothek, keine Token oder Secrets in URL, Logs oder Frontend-Bundle (ADR-013).
- OIDC-Client-Secret nur serverseitig nach gesonderter enger Freigabe oder Henrys eigener Einrichtung. Die bestehende Freigabe für Deploy-Secrets erlaubt keinen Zugriff auf bestehende OIDC-Secrets. Keine Tokens im Chat anfordern.
- Secrets (Mail-API-Keys, Deploy-SSH-Key, Cloudflare-Token) nie im Repo; Deploy-Workflow erst nach Henrys Freigabe.
- Datenschutz: E-Mail + Fahrtdaten = personenbezogen → Export/Löschung von Anfang an, Datenschutzhinweis im Client.
- Monitoring: `/healthz` öffentlich; strukturierte Logs, interne `/metrics` und OTel-Traces laut `11-observability.md` (ADR-010). `/metrics` nie über Traefik.
