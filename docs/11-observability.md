# 11 – Observability: Metriken, Traces, Logs

Voltonaut nutzt den **bereits laufenden Observability-Stack** auf Henrys Hetzner-VPS (Financensor-Compose, hinter Traefik): Prometheus, Grafana, Loki + Promtail, Tempo, Grafana Alloy, Node Exporter. Es wird kein zweiter Stack aufgesetzt. Entscheidung: ADR-010. **E0 selbst ändert sich nicht**; die Grundverdrahtung gehört zu **E0-opt** (erstes VPS-Deploy).

## 1. Prinzipien

- Eine Telemetrie-API auf dem Server: **OpenTelemetry** für Traces und Metriken.
- Logs strukturiert als JSON nach stdout, korreliert über `trace_id`/`span_id`.
- **Niedrige Kardinalität** bei Prometheus-Labels. Keine User-IDs, E-Mails, Fahrt-IDs, Raumcodes oder IPs als Labels.
- `/metrics` nur im internen Docker-Netz, nie über Traefik öffentlich.
- Lokal und in Tests: Telemetrie **aus** (No-Op). Tests und Sim-Modus hängen nicht am Stack.
- Client-Telemetrie datensparsam, ohne Third-Party-Tracker, und erst in einer späteren Etappe.

## 2. Server

### Traces

OpenTelemetry-SDK für Node/NestJS, typischerweise `@opentelemetry/sdk-node` plus Auto-Instrumentation (`http`, `nestjs-core`, `pino`, ausgehend `undici`). Export per **OTLP/HTTP** (Port typischerweise 4318) über das Docker-Netz an das vorhandene **Grafana Alloy**. Fallback: OTLP direkt an Tempo, falls Alloy für Voltonaut nicht erreichbar ist.

**TODO (beim Deploy aus der Financensor-Compose ablesen):** Alloy- bzw. Tempo-Dienstname, OTLP-Port (4317/gRPC oder 4318/HTTP), Docker-Netzname. Diese Werte gehören in die Compose-Env, nicht ins Repo als geratene Hostnamen.

### Metriken

Gleiche OTel-API, Export über den **OpenTelemetry Prometheus Exporter** (`@opentelemetry/exporter-prometheus`, Begründung in ADR-010). Endpunkt `GET /metrics` auf einem **eigenen Port** (üblich 9464), nur an das interne Docker-Netz gebunden. Prometheus scrapt den Server-Container direkt. Der Port wird nicht per Traefik geroutet und nicht auf den Host published.

Zusätzlich tritt das Voltonaut-Compose-Projekt dem Observability-/Prometheus-Netz der Financensor-Compose bei (Name ebenfalls **TODO** beim Deploy).

### Logs

**pino** über **nestjs-pino**: eine JSON-Zeile pro Log-Ereignis auf stdout (Level, Zeit, msg, Request-Route-Template, Statusklasse, `trace_id`, `span_id`). Keine Access-Log-Flut auf Debug in Produktion (Default `info`). Promtail oder Alloy sammelt die Docker-Logs und schreibt sie nach Loki. Personenbezogene Werte (E-Mail, Token) nicht loggen bzw. redaktieren.

### Label-Regeln

| Erlaubt als Label                                                                    | Nicht als Label (ggf. Log-Body, datensparsam) |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| `method`, `route` (Template, nicht raw URL), `status_class` (`2xx`/`4xx`/`5xx`)      | User-ID, E-Mail, Session-Token                |
| `result` (`accepted` / `flagged` / `rejected`), `provider` (`cloudflare` / `resend`) | `rideId`, Raumcode, Roh-IP                    |
| `job` / `service` = `voltonaut-server`                                               | beliebige High-Cardinality-IDs                |

## 3. Domänen-Metriken

Namen mit Präfix `voltonaut_`. Grundlegende HTTP-Latenz und Prozess-Metriken kommen bereits mit der E0-opt-Verdrahtung (OTel-HTTP-Instrumentation, Exporter). Fachmetriken wachsen mit der jeweiligen Etappe.

| Metrik                                                   | Typ                      | Labels                               | Etappe                                                                | Bedeutung                                                                                              |
| -------------------------------------------------------- | ------------------------ | ------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `http.server.duration` bzw. Histogram der Request-Latenz | Histogram                | `method`, `route`, `status_class`    | E0-opt                                                                | Alle HTTP-Requests                                                                                     |
| `voltonaut_sqlite_up`                                    | Gauge (0/1)              | –                                    | E0-opt, vertieft E5                                                   | SQLite erreichbar / WAL gesund                                                                         |
| `voltonaut_litestream_lag_seconds`                       | Gauge                    | –                                    | E5 (Backup aktiv)                                                     | Rückstand der Replikation; Quelle: Litestream-Sidecar oder dessen Metriken                             |
| `voltonaut_mail_sent_total`                              | Counter                  | `result` (ok/failed), `provider`     | E5                                                                    | Magic-Link-Mails                                                                                       |
| `voltonaut_ride_uploads_total`                           | Counter                  | `result` (accepted/flagged/rejected) | E5                                                                    | Ausgang der Plausibilitätsprüfung                                                                      |
| `voltonaut_volts_ledger_entries_total`                   | Counter                  | `reason` (ride/purchase/bonus/admin) | E6                                                                    | Anzahl Ledger-Buchungen                                                                                |
| `voltonaut_volts_ledger_sum`                             | Counter (Einheit: Volts) | `reason`                             | E6                                                                    | Summe der gebuchten Volts (positiv vergeben, negativ ausgegeben – oder zwei Counter `awarded`/`spent`) |
| `voltonaut_active_rides`                                 | Gauge                    | –                                    | E9 (vertieft; Vorstufe E5 nur falls der Server offene Sessions kennt) | Gerade laufende, dem Server bekannte Fahrten                                                           |
| `voltonaut_ws_connections`                               | Gauge                    | –                                    | E9                                                                    | Offene WebSocket-Verbindungen                                                                          |
| `voltonaut_group_ride_rooms`                             | Gauge                    | –                                    | E9                                                                    | Aktive Live-Räume                                                                                      |

Tageswerte (z. B. Volts pro Kalendertag) nicht als wachsende Label-Menge (`date=…`) modellieren, sondern in Grafana per `increase(…[1d])` bzw. Recording Rule aus den Countern ableiten.

## 4. Anbindung an den vorhandenen Stack

```
apps/server  --OTLP traces-->  Alloy (TODO: Host/Port)  --> Tempo
apps/server  --:9464/metrics-->  Prometheus (Scrape, internes Netz)
apps/server  --stdout JSON-->  Promtail / Alloy  --> Loki
Litestream-Sidecar            --> ggf. eigene Metriken / Lag
Grafana  <-- Prometheus, Loki, Tempo
```

Compose (Ergänzung zu `08-backend.md`): derselbe Stack wie das API-Deploy, zusätzlich Mitglied im Observability-Netz, Metrics-Port ohne Traefik-Label. Open-Questions zum Hostnamen bleiben ein Deploy-TODO, kein geratener Wert im Repo.

## 5. Web-Client (spätere Etappe, frühestens nach E4)

Leicht und datensparsam, **kein** Sentry, Analytics oder anderes Drittanbieter-Skript.

- Optionales Fehler-Reporting (aggregierte Stack-Signaturen, nie Tokens oder GPS).
- Kennzahlen: FPS, Framezeit (p50/p95 über ein Zeitfenster), Zahl der BLE-Trennungen – als **Aggregation**, nicht als Event-Strom jedes Frames.
- Versand an einen eigenen Server-Endpunkt (z. B. `POST /v1/telemetry`), serverseitig in Metriken/Logs überführen, Rate-Limit, nur eingeloggte oder zumindest origin-geprüfte Clients.
- Aus im Sim-Modus und solange die Option nicht aktiv ist. Roadmap: E10.

## 6. Grafana und Alarme (spätere Liefergegenstände)

Dashboard-JSON und Alert-Regeln liegen im Repo unter **`ops/grafana/`** (Provisioning, nachvollziehbar in PRs). Nicht in E0 anlegen; unmittelbar nach dem ersten erfolgreichen Deploy nachziehen. Mindestens:

- Übersicht: Request-Rate, Latenz (p50/p95), Fehlerrate, WS-Verbindungen, Räume, Uploads nach Ergebnis, Mails, Volts-Tageszuwachs.
- Alarme: Server nicht erreichbar (`/healthz` oder Scrape down), Fehlerrate über Schwelle, Litestream-Backup-Lag über Schwelle, optional Disk/RAM über Node Exporter.

## 7. Lokal und Tests

- Default: SDK aus bzw. No-Op-Exporter (`OTEL_SDK_DISABLED=true` oder gleichwertige App-Env, z. B. `VOLTONAUT_TELEMETRY=0`). `mise run dev:server` und `?sim=1` brauchen keinen Observability-Stack.
- Tests instanziieren keinen echten Exporter, machen keine Netz-Calls zu Alloy/Prometheus und asserten kein Telemetrie-Backend. Einheitentests der Metrik-Helfer höchstens gegen einen In-Memory-Reader.
- Produktion (VPS): Telemetrie an, Endpunkte aus der Env (TODO-Werte aus der Financensor-Compose).

## 8. Abhängigkeiten (vorgeschlagen, ADR-010)

In `apps/server`, exakt pinnen beim Einbau (E0-opt): `@opentelemetry/sdk-node`, `@opentelemetry/api`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-prometheus`, `nestjs-pino`, `pino`, `pino-http`. Siehe `docs/dependencies.md`.

## 9. Zuordnung zur Roadmap

- **E0:** unverändert (gerade in Umsetzung).
- **E0-opt:** Logs (pino/JSON), `/metrics` intern, Trace-Export an Alloy/Tempo, No-Op-Default, Netz/Endpunkte aus der Financensor-Compose eintragen.
- **E5:** Mails, Fahrt-Uploads, SQLite/Litestream-Gesundheit.
- **E6:** Volts-Ledger (Anzahl und Summe).
- **E9:** aktive Fahrten, WS-Verbindungen, Gruppenräume.
- **E10:** optionale Client-Telemetrie. `ops/grafana/` nach dem ersten Deploy.
