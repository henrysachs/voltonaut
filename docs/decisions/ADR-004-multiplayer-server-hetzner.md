# ADR-004 – Backend-Server: Node.js + WebSocket auf Hetzner-VPS

**Status:** Angenommen (2026-11-19). Umfang erweitert am selben Tag: Der Server hostet neben Live-Räumen auch Accounts, Inventar, Ökonomie und Fahrthistorie (ADR-005). Umsetzung: Backend-Grundlage E5, Live-Räume E8.

## Kontext
Gruppenfahrten (gemeinsam auf einer Strecke fahren, andere Avatare sehen) und Accounts mit Inventar/Währung brauchen einen Server. Der Client ist eine statische Seite (ADR-002) und braucht dafür einen Echtzeit-Relay-Dienst mit kleinem Zustand (Räume, letzte Positionen). Henry hat bereits einen Hetzner-VPS.

## Entscheidung
Ein eigener **Node.js-Server mit WebSocket (`ws`)** läuft auf Henrys **vorhandenem Hetzner-VPS**, hinter einem Reverse Proxy mit TLS (`wss://`). Code im selben Repo unter `server/`, Protokolltypen in `shared/net-protocol.ts`. Live-Räume sind flüchtiger In-Memory-State; Accounts und Spielfortschritt liegen in SQLite auf dem VPS (ADR-005). Stack-Details: `docs/08-backend.md` (Fastify, TypeBox, `@fastify/websocket`, SQLite + Kysely, Litestream, Caddy).

## Konsequenzen
- + Keine Zusatzkosten, volle Kontrolle, kein Vendor-Lock-in; gleiche Sprache (TS) wie der Client, Typen geteilt.
- + Einfaches Modell: ein Prozess, Räume als Maps; leicht lokal testbar (`npm run server:dev`).
- − Betrieb liegt bei uns: Updates, TLS-Erneuerung, Monitoring, Neustarts (systemd), Firewall.
- − Ein Standort (Hetzner-Rechenzentrum), keine automatische Skalierung – für Freundeskreis-Größe unkritisch.
- − Deploy braucht SSH-Zugang aus CI → Secret-Verwaltung; erst nach Henrys Freigabe einrichten.

## Betrachtete Alternative
- **Cloudflare Durable Objects** (WebSocket-Hibernation, ein Objekt pro Raum, global verteilt, kein Serverbetrieb): technisch passend, aber zusätzliche Plattform/Kosten-Modell und Workers-spezifische Laufzeit. Nicht gewählt, weil der Hetzner-VPS bereits vorhanden ist und Henry dort die Kontrolle behalten will. Bleibt Option, falls Betriebsaufwand oder Reichweite später zum Problem werden.
