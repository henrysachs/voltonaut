# ADR-004 – Backend-Server: TypeScript/NestJS auf Hetzner-VPS

**Status:** Angenommen (2026-11-19). Umfang erweitert am selben Tag: Der Server hostet neben Live-Räumen auch Accounts, Inventar, Ökonomie und Fahrthistorie (ADR-005). Aktualisiert 2026-11-19: Framework **NestJS** statt Fastify, ORM **Drizzle** statt Kysely, Validierung **Zod**. Umsetzung: Server-Gerüst E0 (lokal + CI; echtes VPS-Deploy als optionale Aufgabe, sobald SSH-Key und Subdomain da sind), Accounts E5, Live-Räume E9.

## Kontext
Gruppenfahrten (gemeinsam auf einer Strecke fahren, andere Avatare sehen) und Accounts mit Inventar/Währung brauchen einen Server. Der Client ist eine statische Seite (ADR-002) und braucht dafür einen Echtzeit-Relay-Dienst mit kleinem Zustand (Räume, letzte Positionen). Henry hat bereits einen Hetzner-VPS.

## Entscheidung
- Ein eigener **TypeScript-Server mit NestJS** läuft auf Henrys **vorhandenem Hetzner-VPS** (systemd), hinter **Caddy** mit TLS (`https://`, `wss://`). Code: `apps/server` im pnpm-Monorepo (ADR-006).
- **TypeScript statt Go**, weil Physik, Gangmodell, Belohnungsregeln und Protokoll-Schemas (`packages/engine`, `packages/rules`, `packages/shared`) im Browser **und** zur serverseitigen Fahrt-Validierung identisch laufen müssen.
- Nest-Module: `health`, `database`, `auth`, `accounts`, `inventory`, `economy` (Volts), `progression`, `rides`, `live` (`@nestjs/websockets` + `@nestjs/platform-ws`, rohe WebSockets), `catalog`.
- Persistenz: **SQLite** (`better-sqlite3`, WAL) mit **Drizzle ORM** + `drizzle-kit`-Migrationen; Backups per Litestream. Live-Räume sind flüchtiger In-Memory-State. Validierung über **Zod**-Schemas aus `packages/shared` (`nestjs-zod`).
- Details: `docs/08-backend.md`.

## Konsequenzen
- + Keine Zusatzkosten, volle Kontrolle, kein Vendor-Lock-in; gleiche Sprache (TS) wie der Client, Typen, Physik und Regeln geteilt.
- + NestJS-DI erlaubt Tests mit echten Providern bzw. `overrideProvider` statt Modul-Mocking.
- − NestJS braucht `experimentalDecorators`/`emitDecoratorMetadata` und SWC in Vitest; schwerer als Fastify/Hono.
- − Drizzle ist jünger als Prisma; Migrationen müssen im Review gelesen werden.
- + Einfaches Modell: ein Prozess, Räume als Maps; leicht lokal testbar (`mise run dev:server`).
- − Betrieb liegt bei uns: Updates, TLS-Erneuerung, Monitoring, Neustarts (systemd), Firewall.
- − Ein Standort (Hetzner-Rechenzentrum), keine automatische Skalierung – für Freundeskreis-Größe unkritisch.
- − Deploy braucht SSH-Zugang aus CI → Secret-Verwaltung; erst nach Henrys Freigabe einrichten.

## Betrachtete Alternativen
- **Go** (schnell, ein Binary): verworfen, Logik müsste doppelt gepflegt werden.
- **Fastify/Hono** (leichter): verworfen zugunsten der stärkeren Struktur von NestJS für viele Agenten.
- **Prisma / Kysely** statt Drizzle: siehe `08-backend.md`.
- **Cloudflare Durable Objects** (WebSocket-Hibernation, ein Objekt pro Raum, global verteilt, kein Serverbetrieb): technisch passend, aber zusätzliche Plattform/Kosten-Modell und Workers-spezifische Laufzeit. Nicht gewählt, weil der Hetzner-VPS bereits vorhanden ist und Henry dort die Kontrolle behalten will. Bleibt Option, falls Betriebsaufwand oder Reichweite später zum Problem werden.
