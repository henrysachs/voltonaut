# ADR-004 – Backend-Server: TypeScript/NestJS auf Hetzner-VPS

**Status:** Angenommen (2026-11-19). Umfang erweitert am selben Tag: Der Server hostet neben Live-Räumen auch Accounts, Inventar, Ökonomie und Fahrthistorie (ADR-005). Aktualisiert 2026-11-19: Framework **NestJS** statt Fastify, ORM **Drizzle** statt Kysely, Validierung **Zod**. Umsetzung: Server-Gerüst E0 (lokal + CI; echtes VPS-Deploy als optionale Aufgabe E0-opt). **Änderung 19.11.2026:** Betrieb nicht mehr über systemd + Caddy, sondern als Docker-Compose-Projekt hinter dem vorhandenen Traefik (Begründung siehe unten).

Die Backupentscheidung wird am 21.11.2026 durch [ADR-020](ADR-020-explicit-production-provisioning.md) präzisiert. Henry wählt persistenten API-Betrieb ohne Backup. Litestream bleibt nur ausdrücklich auswählbar. Die übrige Hostingentscheidung bleibt unverändert.

## Kontext
Gruppenfahrten (gemeinsam auf einer Strecke fahren, andere Avatare sehen) und Accounts mit Inventar/Währung brauchen einen Server. Der Client ist eine statische Seite (ADR-002) und braucht dafür einen Echtzeit-Relay-Dienst mit kleinem Zustand (Räume, letzte Positionen). Henry hat bereits einen Hetzner-VPS.

## Entscheidung
- Ein eigener **TypeScript-Server mit NestJS** läuft auf **Henrys Hetzner-VPS** als **Docker-Image** (z. B. `ghcr.io/henrysachs/voltonaut-server`) in einem **eigenen Docker-Compose-Projekt**. Das Projekt tritt dem vorhandenen Traefik-Docker-Netz bei und wird über **Traefik-Labels** geroutet (Host-Rule, TLS über Traefiks bestehenden Certresolver). Code: `apps/server` im pnpm-Monorepo (ADR-006).
- **TypeScript statt Go**, weil Physik, Gangmodell, Belohnungsregeln und Protokoll-Schemas (`packages/engine`, `packages/rules`, `packages/shared`) im Browser **und** zur serverseitigen Fahrt-Validierung identisch laufen müssen.
- Nest-Module: `health`, `database`, `auth`, `accounts`, `inventory`, `economy` (Volts), `progression`, `rides`, `live` (`@nestjs/websockets` + `@nestjs/platform-ws`, rohe WebSockets), `catalog`.
- Persistenz: **SQLite** (`better-sqlite3`, WAL) mit **Drizzle ORM** + `drizzle-kit`-Migrationen; die Datenbankdatei liegt auf einem named Volume oder Bind-Mount. Backups per **Litestream als Sidecar-Container**. Live-Räume sind flüchtiger In-Memory-State. Validierung über **Zod**-Schemas aus `packages/shared` (`nestjs-zod`).
- Details: `docs/08-backend.md`.

## Änderung 19.11.2026
Der VPS wurde am 19.11.2026 nur lesend geprüft: Ubuntu 24.04, 2 vCPU, 4 GB RAM, rund 18 GB freier Speicher – für Voltonaut ausreichend. Auf dem Rechner läuft bereits Henrys **Financensor**-Stack (Docker Compose); der Container `financensor-traefik-1` (`traefik:v3.6`) belegt die Ports 80 und 443. Der ursprünglich geplante Betrieb mit **Caddy + systemd** würde damit kollidieren und entfällt.

Stattdessen wird der Voltonaut-Server als Container betrieben:
- Image z. B. `ghcr.io/henrysachs/voltonaut-server`, aus CI gebaut und gepusht.
- Eigenes Compose-Projekt, das dem Traefik-Netz von Financensor beitritt (kein zweiter Proxy, keine Bindung an 80/443).
- Routing und TLS ausschließlich über Traefik-Labels. Die **exakten Netzwerk- und Certresolver-Namen** stehen in der Financensor-Compose auf dem VPS und werden dort zum Deploy-Zeitpunkt abgelesen (**TODO**).
- SQLite auf einem named Volume oder Bind-Mount; Litestream als Sidecar, der dasselbe Volume mitliest.
- Node läuft in dem Image (dieselbe per mise gepinnte Version), nicht als Host-Paket.

SSH-Zugang zum VPS ist vorhanden; offen bleiben der DNS-A-Record für `voltonaut-api.stammkneipe.dev` (ADR-009) und das CI-Deploy-Secret. Secrets gehören nicht ins Repo.

## Konsequenzen
- + Keine Zusatzkosten, volle Kontrolle, kein Vendor-Lock-in; gleiche Sprache (TS) wie der Client, Typen, Physik und Regeln geteilt.
- + NestJS-DI erlaubt Tests mit echten Providern bzw. `overrideProvider` statt Modul-Mocking.
- + Anschluss an den bereits laufenden Traefik vermeidet einen Port-Konflikt mit Financensor und nutzt dessen TLS-Erneuerung.
- − NestJS braucht `experimentalDecorators`/`emitDecoratorMetadata` und SWC in Vitest; schwerer als Fastify/Hono.
- − Drizzle ist jünger als Prisma; Migrationen müssen im Review gelesen werden.
- + Einfaches Modell: ein Prozess, Räume als Maps; leicht lokal testbar (`mise run dev:server`). Lokal und in CI ohne Docker; Produktion als Container.
- − Betrieb liegt bei uns: Updates, Monitoring, Container-Neustarts, Firewall. TLS erneuert der vorhandene Traefik.
- − Ein Standort (Hetzner-Rechenzentrum), keine automatische Skalierung – für Freundeskreis-Größe unkritisch.
- − Deploy braucht SSH-Zugang aus CI → Secret-Verwaltung; erst nach Henrys Freigabe und gesetztem DNS-Record einrichten.

## Betrachtete Alternativen
- **Go** (schnell, ein Binary): verworfen, Logik müsste doppelt gepflegt werden.
- **Fastify/Hono** (leichter): verworfen zugunsten der stärkeren Struktur von NestJS für viele Agenten.
- **Prisma / Kysely** statt Drizzle: siehe `08-backend.md`.
- **Caddy + systemd** (ursprünglicher Plan): verworfen am 19.11.2026, weil Traefik auf dem VPS Ports 80/443 bereits belegt.
- **Cloudflare Durable Objects** (WebSocket-Hibernation, ein Objekt pro Raum, global verteilt, kein Serverbetrieb): technisch passend, aber zusätzliche Plattform/Kosten-Modell und Workers-spezifische Laufzeit. Nicht gewählt, weil der Hetzner-VPS bereits vorhanden ist und Henry dort die Kontrolle behalten will. Bleibt Option, falls Betriebsaufwand oder Reichweite später zum Problem werden.
