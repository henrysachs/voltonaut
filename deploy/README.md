# Server-Betrieb (Hetzner-VPS, Docker + Traefik)

Der Voltonaut-API-Server läuft als **Docker-Compose-Projekt** hinter dem **vorhandenen Financensor-Traefik** (ADR-004, ADR-009). Caddy und systemd werden **nicht** mehr verwendet. Der produktive Deploy bleibt aus, bis Henry `SERVER_DEPLOY_ENABLED=true` setzt.

## Warum Docker hinter dem Financensor-Traefik

Auf dem VPS läuft bereits Financensor (Docker Compose); dessen Traefik v3 (`financensor-traefik-1`) belegt die Ports 80 und 443 und verwaltet TLS über seinen Certresolver `letsencrypt`. Voltonaut baut deshalb **keinen zweiten Proxy** und bindet **keine** Ports auf dem Host. Das Compose-Projekt tritt nur dem externen Netzwerk `financensor_default` bei; Routing und TLS laufen ausschließlich über Traefik-Labels.

## Dateien

| Datei            | Zweck                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`     | Produktiv-Image für `apps/server` mit der gepinnten Node-Version (24.22.3). Bauen vom Repo-Root: `docker build -f deploy/Dockerfile -t voltonaut-server:<tag> .` |
| `compose.yaml`   | Compose-Projekt: Server (Traefik-Labels, Port 3000 im Container, SQLite-Volume) + Litestream-Sidecar (0.5.18, exakt gepinnt)                                     |
| `litestream.yml` | Replikations-Config; Zugangsdaten kommen per Umgebung aus `deploy.env`                                                                                           |
| `deploy.sh`      | `deploy`/`rollback`/`status` mit Health-Check `https://api.voltonaut.stammkneipe.dev/healthz` und automatischem Rollback                                         |

## Einrichtung auf dem VPS (einmalig)

1. Docker Engine mit Compose-Plugin installieren (Ubuntu 24.04: `apt install docker-compose-plugin`).
2. Zielverzeichnis anlegen: `sudo mkdir -p /srv/voltonaut`. Der Deploy-Nutzer braucht dort Schreibrechte.
3. Zugangsdaten für Litestream (Hetzner Storage Box oder S3-kompatibles Ziel) nach `/srv/voltonaut/deploy.env` schreiben – **nie committen**:
   ```bash
   LITESTREAM_ENDPOINT=https://<endpoint>
   LITESTREAM_BUCKET=<bucket>
   LITESTREAM_ACCESS_KEY_ID=<key-id>
   LITESTREAM_SECRET_ACCESS_KEY=<secret>
   ```
   Bis E5 existiert noch keine SQLite-Datei; der Sidecar tailt dann eine leere Datenbank.
4. DNS: A-Record `api.voltonaut.stammkneipe.dev` → VPS-IP, **unproxied** (graue Wolke). Wie bei Financensor muss Traefiks `letsencrypt`-Certresolver den Host direkt per ACME erreichen können; das Zertifikat kommt von Traefik, nicht von Cloudflare. **Keinen** Cloudflare-Proxy für diesen Record aktivieren.
5. Secrets (Mail-API-Keys u. a.) später nur über die Env-Datei bzw. Docker-Umgebung auf dem VPS – nie ins Repo.

Die Compose-Datei und `deploy.sh` werden bei jedem Deploy aus `deploy/` des jeweiligen Commits nach `/srv/voltonaut` übertragen; ein Checkout des ganzen Repos auf dem VPS ist nicht nötig. Einmal angelegte Dinge (Netzwerk, `deploy.env`, `state/`) bleiben dort liegen.

## GitHub-Konfiguration

Der Workflow `.github/workflows/deploy-server.yml` läuft erst, wenn diese Repository-Variable gesetzt ist:

- `SERVER_DEPLOY_ENABLED=true`

Er nutzt das GitHub-Environment `production` mit manueller Freigabe und diese Werte:

- Secret `DEPLOY_SSH_KEY`: privater SSH-Key des eingeschränkten Deploy-Users. Nie committen.
- Secret `DEPLOY_HOST`: Hostname oder IP des VPS.
- Variable `DEPLOY_USER`: SSH-Nutzer auf dem VPS.

Ablauf des Workflows: `mise run check` → Docker-Image lokal bauen (`docker build`, Tag = Git-SHA) → per SSH übertragen (`docker save` über die Pipe, kein Registry-Push, daher kein GHCR-Token nötig) → `deploy/` nach `/srv/voltonaut` kopieren → `./deploy.sh deploy <sha>`.

## Release-Ablauf

`deploy.sh deploy <tag>`:

1. Merkt sich den bisherigen Tag in `state/previous-tag`.
2. Holt das Image (lokal vorhanden nach `docker load`, sonst `docker compose pull`).
3. `docker compose up -d --remove-orphans` mit dem neuen Tag.
4. Prüft wiederholt `https://api.voltonaut.stammkneipe.dev/healthz`.
5. Schlägt die Prüfung fehl, stellt das Skript automatisch den vorherigen Tag wieder her (ohne vorherigen Release: Container gestoppt) und beendet mit Fehler.

Rollback und Status:

```bash
./deploy.sh rollback          # vorherigen Release wiederherstellen
./deploy.sh rollback <tag>    # benannten Release wiederherstellen
./deploy.sh status            # Tags, Health und Container anzeigen
```

## Betrieb

- Health: `curl -fsS https://api.voltonaut.stammkneipe.dev/healthz`
- Logs: `docker compose -f compose.yaml logs -f server`
- Container-Status: `./deploy.sh status`
- Der Traefik-Router heißt `voltonaut-server`; der Loadbalancer-Port ist 3000.
- Observability (`/metrics` intern, OTel-Traces, pino-Logs) ist bewusst **noch nicht** verdrahtet – das kommt mit E0-opt laut ADR-010; Netz- und Endpunktnamen werden dann aus der Financensor-Compose abgelesen.
- Ändere Secrets nur auf dem VPS bzw. über GitHub. Kopiere keine privaten Schlüssel in dieses Repository.
