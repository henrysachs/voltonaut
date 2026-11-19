# ADR-010 – Observability: OpenTelemetry, strukturierte Logs, vorhandener Grafana-Stack

**Status:** Angenommen (2026-11-19). Details: `docs/11-observability.md`.

## Kontext
Metriken, Traces und Logs sollen von Anfang an mitbedacht sein, nicht nachträglich „drübergestülpt" werden. Auf Henrys Hetzner-VPS läuft im Financensor-Compose-Stack bereits **Prometheus**, **Grafana**, **Loki + Promtail**, **Tempo**, **Grafana Alloy** und **Node Exporter**, hinter dem gemeinsamen Traefik. Voltonaut soll diesen Stack mitnutzen und keinen zweiten Observability-Stack aufsetzen. Etappe **E0 wird gerade implementiert und bleibt unverändert**; die Verdrahtung gehört zu **E0-opt** (erstes VPS-Deploy).

## Entscheidung
1. **Server-Telemetrie mit dem OpenTelemetry-SDK** für Node/NestJS (Traces und Metriken). Traces gehen per **OTLP** über das Docker-Netz an das vorhandene **Grafana Alloy** (Fallback: direkt an Tempo). Die exakten OTLP-Endpunkte und Netzwerknamen werden zum Deploy-Zeitpunkt aus der Financensor-Compose gelesen (**TODO**).
2. **Metriken per Prometheus-Scrape** von `/metrics`. Wahl: **OpenTelemetry Prometheus Exporter** (`@opentelemetry/exporter-prometheus`), nicht `prom-client`. Begründung: eine API (OTel) für Traces und Metriken; HTTP/NestJS-Auto-Instrumentation liefert Request-Latenz-Histogramme ohne zweite Metrik-Bibliothek; der Endpunkt bleibt ein normales Prometheus-Textformat, das der vorhandene Prometheus scrapen kann. `prom-client` wäre etabliert, würde aber eine parallele Metrik-API erzwingen oder OTel-Metriken ungenutzt lassen. Reines OTLP-Metrics an Alloy (ohne `/metrics`) wäre möglich, erschwert aber das Debuggen (`curl` aus dem Docker-Netz) und weicht vom bestehenden Scrape-Modell ab.
3. **`/metrics` ist nicht öffentlich.** Der Exporter lauscht auf einem eigenen Port (üblich 9464) nur im internen Docker-Netz. Keine Traefik-Route, kein Publish auf den Host. `GET /healthz` bleibt der öffentliche Health-Check (ADR-004/009).
4. **Strukturierte JSON-Logs** mit **pino** über **nestjs-pino** nach stdout, inklusive `trace_id`/`span_id` (OTel-Pino-Instrumentation). Promtail bzw. Alloy sammelt die Container-Logs in Loki.
5. **Label-Regeln mit niedriger Kardinalität:** erlaubt sind z. B. HTTP-Methode, Route-Template, Statusklasse, Ergebnis (`accepted`/`flagged`/`rejected`), Mail-Provider. **Keine User-IDs, E-Mail-Adressen, Fahrt-IDs, Raumcodes oder IPs als Labels** (solche Werte höchstens im Log-Body, datensparsam).
6. **Domänen-Metriken** wachsen mit den Etappen (E5, E6, E9); die Grundverdrahtung (Logs, `/metrics`, Traces) kommt in E0-opt. Liste in `11-observability.md`.
7. **Web-Client später:** optionales, datensparsammes Fehler-Reporting und aggregierte Kennzahlen (FPS, Framezeit, BLE-Trennungen) an einen eigenen Server-Endpunkt. Keine Third-Party-Tracker (kein Sentry/GA o. Ä.).
8. **Grafana-Dashboard-JSON und Alert-Regeln** liegen später im Repo unter `ops/grafana/` (Server down, Fehlerrate, Litestream-Backup-Lag). Liefergegenstand nach dem ersten erfolgreichen Deploy, nicht Teil von E0.
9. **Lokal und in Tests ist Telemetrie aus:** No-Op-Exporter bzw. SDK deaktiviert (z. B. `OTEL_SDK_DISABLED`). Tests und Sim-Modus dürfen nicht von Alloy/Prometheus/Loki abhängen.
10. Diese ADR gibt die in `docs/dependencies.md` vorgeschlagenen Observability-Pakete frei (exakte Versionen beim Einbau in E0-opt pinnen).

## Konsequenzen
- + Vorhandener Stack wird genutzt, kein zweites Grafana/Prometheus, kein zusätzlicher SaaS-Dienst, keine neuen Betriebskosten.
- + Traces, Metriken und Logs sind korrelierbar (`trace_id` in Loki).
- + Öffentliche Angriffsfläche bleibt klein: `/metrics` nie über Traefik.
- − Der Server-Container muss dem Observability-Netz der Financensor-Compose beitreten; Namen sind erst beim Deploy sicher.
- − OTel-JS und pino sind zusätzliche Laufzeitabhängigkeiten; der Default-Off-Pfad muss in Tests zwingend no-op bleiben, sonst wird CI instabil oder langsam.
- − Dashboard- und Alert-Pflege liegt bei uns (JSON im Repo, nicht nur Klicks in Grafana).

## Alternativen
- **`prom-client`** (ggf. `@willsoto/nestjs-prometheus`): verworfen zugunsten einer einzigen OTel-Metrik-API; bleibt Fallback, falls der OTel-Prometheus-Exporter in der gepinnten Version unzureichend ist (dann ADR-Nachtrag).
- **Nur OTLP-Metrics an Alloy**, ohne `/metrics`: verworfen, weil Scrape und `curl` im Docker-Netz zum vorhandenen Prometheus passen.
- **Sentry, Datadog, Grafana Cloud als SaaS:** verworfen (Datenschutz, Kosten, vorhandener Self-Hosting-Stack).
- **Tempo direkt, ohne Alloy:** möglich als Fallback, aber Alloy ist bereits der Sammelpunkt im Financensor-Stack und bleibt der bevorzugte OTLP-Einstieg.
- **Observability schon in E0 einbauen:** verworfen, weil E0 gerade implementiert wird; die Leitplanken gelten ab E0-opt.
