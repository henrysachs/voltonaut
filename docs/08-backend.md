# 08 – Backend: Accounts, Ökonomie, Fahrten, Gruppenfahrten

Server auf Henrys **vorhandenem Hetzner-VPS** (ADR-004). Er ist **autoritativ** für Accounts, Inventar, XP/Level, Volts und Fahrthistorie (ADR-005) und betreibt die Live-Räume für Gruppenfahrten. Der Client bleibt eine statische Seite (GitHub Pages) und ist **offline-first**: Solo-Fahren funktioniert immer, auch ohne Server (Gastmodus / Offline-Cache).

## Empfohlener Stack
| Baustein | Wahl | Begründung |
|---|---|---|
| Runtime | **Node.js 22 LTS + TypeScript** | gleiche Sprache wie Client; `shared/` (Typen, Badge-Prädikate, Physik, Level-Daten) direkt wiederverwendbar |
| HTTP | **Fastify 5** | ausgereift, schnell, JSON-Schema-Validierung eingebaut, gutes Plugin-Ökosystem (CORS, Rate-Limit). Hono wäre ebenfalls passend (leichter, portabel zu Cloudflare), Fastify gewinnt bei Node-Betrieb und Plugins. |
| Schema/Validierung | **TypeBox** | eine Definition → TS-Typ + JSON-Schema für Fastify; Typen in `shared/api/` |
| WebSocket | **`@fastify/websocket`** (basiert auf `ws`) | Live-Räume im selben Prozess, gleiche Auth |
| Datenbank | **SQLite** (`better-sqlite3`, WAL-Modus) + **Kysely** (typsichere Queries, Migrationen) | ein Nutzerkreis von Freunden, ein VPS: kein DB-Server zu betreiben, Transaktionen für Käufe trivial. Wechsel auf Postgres bei Bedarf über Kysely-Dialekt. |
| Backups | **Litestream** → Hetzner Storage Box / S3-kompatibel, alternativ nächtliches `sqlite3 .backup` | Point-in-Time-Restore ohne DB-Server |
| Auth v1 | **E-Mail-Magic-Link → opakes Session-Token (Bearer)** | keine Passwörter speichern, einfach für Freunde; Token in IndexedDB, Header `Authorization: Bearer …`, WS-Auth im ersten Frame |
| Auth v2 | **Passkeys (WebAuthn, `@simplewebauthn/server`)** zusätzlich | phishing-sicher, bequem am Laptop; Magic Link bleibt Recovery |
| Mail-Versand | SMTP-Anbieter ❓ (z. B. vorhandenes Postfach, Brevo, Postmark) | nötig für Magic Links (open-questions P6) |
| Reverse Proxy | **Caddy** (automatisches TLS) oder vorhandener nginx ❓ | `https://`/`wss://` Pflicht, weil die Seite per HTTPS läuft |
| Prozess | systemd-Unit (oder Docker Compose, falls auf dem VPS üblich ❓) | Neustart bei Absturz, Logs via journald |
| Tests | Vitest + Fastify `inject()` + echte WS-Verbindungen gegen lokalen Server; SQLite in-memory | schnell, kein Mocking der DB |

**Warum Bearer-Token statt Cookie:** Client (`<user>.github.io`) und API (`api.<domain>`) sind unterschiedliche Sites; Session-Cookies wären Third-Party-Cookies (`SameSite=None`) und in Chrome zunehmend unzuverlässig. Alternative: Client ebenfalls vom VPS unter derselben Domain ausliefern → dann httpOnly-Cookie möglich. Entscheidung offen (P7), Bearer funktioniert in beiden Fällen.

## Server-Module (`server/src/`)
| Modul | Verantwortung | Besitzt |
|---|---|---|
| `auth/` | Magic Link anfordern/einlösen, Sessions, (v2) Passkeys | `users`, `sessions`, `login_tokens` |
| `accounts/` | Rider-Profil, Anzeigename, Avatar-Config, Account löschen/exportieren (DSGVO) | `profiles` |
| `inventory/` | freigeschaltete Items, Ausrüsten-Validierung | `inventory` |
| `economy/` | Volts-Ledger, Shop-Katalog, Käufe (atomare Transaktion) | `volts_ledger` |
| `progression/` | XP, Level, Badges, PBs – berechnet aus akzeptierten Fahrten | `progression`, `badges`, `personal_bests` |
| `rides/` | Fahrt-Upload, Plausibilitätsprüfung, Vergabe von XP/Volts | `rides`, `ride_samples` |
| `live/` | WebSocket-Räume für Gruppenfahrten (In-Memory) | – |
| `catalog/` | Item-Katalog, Level-Tabelle, Routen-Metadaten (aus `shared/data/`) | read-only |
Regel wie im Client: ein Besitzer pro Tabelle; andere Module rufen dessen Service-Funktionen, nie direkt SQL auf fremde Tabellen.

## Datenmodell (Skizze)
```sql
users(id TEXT PK, email TEXT UNIQUE, created_at, deleted_at)
sessions(token_hash TEXT PK, user_id, created_at, last_seen_at, expires_at, user_agent)
login_tokens(token_hash PK, email, expires_at, used_at)
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
POST /v1/auth/magic-link        { email }                         → 204 (Mail mit Link https://<client>/#login=<token>)
POST /v1/auth/session           { loginToken }                    → { sessionToken, user }
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
```ts
// shared/api/rides.ts
interface RideUpload {
  rideId: string; routeId: string; clientVersion: string;
  startedAt: string; profileAtStart: Pick<RiderProfile, 'massKg' | 'heightCm'> & { bikeMassKg: number };
  devices: { trainer: string; trainerSource: 'ftms' | 'cps' | 'sim'; hr?: string; controller?: string };
  samples: Array<{ t: number; p: number; c: number; hr?: number; d: number; g: number }>; // 1 Hz
  claimed: { distanceM: number; elevM: number; energyKj: number; pickups: string[]; segments: Array<{ id: string; timeS: number }> };
}
```

## Plausibilitätsprüfung / Anti-Cheat-Grundlagen
Der Server **rechnet nach**, statt Client-Werten zu vertrauen:
1. **Struktur:** Zeitstempel monoton, 1-Hz-Raster ± Toleranz, Dauer ≤ Wanduhr zwischen `startedAt` und Upload, max. 6 h, `rideId` nicht doppelt.
2. **Physik-Rekonstruktion:** Distanz, Höhenmeter und Segmentzeiten aus Leistungs-Samples + Route + `profileAtStart` mit derselben `shared/physics` neu berechnen; Abweichung > 3 % → `flagged`.
3. **Grenzen:** Spitzenleistung ≤ 2 000 W; 20-min-Leistung ≤ 6,5 W/kg; 1-min ≤ 12 W/kg; Kadenz ≤ 200 rpm; Leistung > 0 bei Kadenz 0 über > 10 s → verdächtig.
4. **Quelle:** `trainerSource = 'sim'` → `accepted`, aber 0 XP / 0 Volts.
5. **Pickups:** nur Blitze anerkennen, deren Distanzmarke laut rekonstruierter Distanz überfahren wurde.
6. **Limits:** Volts-Tageslimit (3 000), max. 4 Fahrten/Tag mit Vergabe.
`flagged` → Fahrt gespeichert, aber keine Vergabe bis manuelle Freigabe (Admin-CLI). Ehrlich: Das hält nur Gelegenheits-Schummeln auf; manipulierte Clients mit plausiblen Fake-Daten sind ohne Hardware-Signatur nicht erkennbar. Für einen Freundeskreis reicht das.

## Offline-first-Sync (Client `sync/`)
- Beim Start: Cache aus IndexedDB laden → sofort fahrbereit; im Hintergrund `GET /v1/me` → Cache aktualisieren.
- Nach der Fahrt: `RideUpload` in **Outbox** (IndexedDB) → Upload mit Retry/Backoff; UI zeigt XP/Volts als „vorläufig" bis Server-Antwort.
- Käufe und Ausrüstungsänderungen nur **online** (Kauf ist Server-Transaktion); Ausrüstung offline nur aus dem gecachten Inventar.
- Konflikte: Server gewinnt; Profil-Änderungen per `updated_at` (last-write-wins).

## Live-Gruppenfahrten (WebSocket)
- Raum = `routeId` + optional privater Raumcode. Anzeige der anderen Fahrer (Name, Avatar-Config, Distanz, W/kg optional).
- Kein Windschatten, keine Rennen in v1.
```ts
type ClientMsg =
  | { t: 'auth'; sessionToken: string }
  | { t: 'join'; v: 1; room: string }
  | { t: 'state'; seq: number; distanceM: number; lap: number; speedMps: number; powerW: number; cadenceRpm: number }   // 2–4 Hz
  | { t: 'leave' };
type ServerMsg =
  | { t: 'welcome'; serverTimeMs: number; riders: RemoteRiderInfo[] }
  | { t: 'joined'; rider: RemoteRiderInfo } | { t: 'left'; userId: string }
  | { t: 'snapshot'; serverTimeMs: number; riders: Array<{ id: string; d: number; lap: number; v: number; p: number; c: number }> }  // 4 Hz
  | { t: 'error'; code: 'unauthorized' | 'room_full' | 'bad_version' | 'rate_limited'; msg: string };
```
Client interpoliert Remote-Fahrer ~250 ms in der Vergangenheit; Positionen nur als Distanz entlang der Route. Limits: 50 Fahrer/Raum, 10 Nachrichten/s, 1 KB/Nachricht.

## Betrieb & Sicherheit
- CORS: nur Pages-Origin + `http://localhost:5173`. Rate-Limits pro IP und Account (`@fastify/rate-limit`), besonders auf `/auth/*`.
- Tokens nur gehasht speichern (SHA-256); Magic Links 15 min gültig, einmalig.
- Secrets (SMTP, Deploy-SSH-Key) nie im Repo; Deploy-Workflow erst nach Henrys Freigabe.
- Datenschutz: E-Mail + Fahrtdaten = personenbezogen → Export/Löschung von Anfang an, Datenschutzhinweis im Client.
- Monitoring: `/healthz`, journald-Logs, einfacher Uptime-Check.
