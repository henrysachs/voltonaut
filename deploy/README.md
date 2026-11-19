# Server-Betrieb (Hetzner-VPS)

Diese Dateien bereiten den API-Deploy vor. Der produktive Deploy bleibt aus, bis Henry die Subdomain liefert und `SERVER_DEPLOY_ENABLED=true` setzt.

## Voraussetzungen auf dem VPS

1. Lege den Systemnutzer und das Verzeichnis an:
   ```bash
   sudo useradd --system --home /opt/voltonaut --create-home voltonaut
   sudo git clone <repo-url> /opt/voltonaut
   sudo chown -R voltonaut:voltonaut /opt/voltonaut
   ```
2. Installiere mise für den Nutzer `voltonaut` und prüfe die Pins:
   ```bash
   sudo -u voltonaut mise install
   sudo -u voltonaut mise exec -- node --version
   sudo -u voltonaut mise exec -- pnpm --version
   ```
3. Installiere die systemd-Unit:
   ```bash
   sudo cp /opt/voltonaut/deploy/voltonaut-server.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable voltonaut-server
   ```
4. Kopiere `deploy/Caddyfile.template` nach `/etc/caddy/sites/voltonaut.caddy` und ersetze die Beispiel-Subdomain. Lade Caddy danach neu.
5. Erlaube dem Deploy-Nutzer ausschließlich:
   ```text
   voltonaut ALL=(root) NOPASSWD: /usr/bin/systemctl restart voltonaut-server, /usr/bin/systemctl is-active voltonaut-server
   ```

## GitHub-Konfiguration

Der Workflow `.github/workflows/deploy-server.yml` läuft erst, wenn diese repository-Variable gesetzt ist:

- `SERVER_DEPLOY_ENABLED=true`

Er nutzt das GitHub Environment `production` mit manueller Freigabe und diese Werte:

- Secret `DEPLOY_SSH_KEY`: privater SSH-Key des eingeschränkten Deploy-Users. Nie committen.
- Secret `DEPLOY_HOST`: Hostname oder IP des VPS.
- Variable `DEPLOY_USER`: SSH-Nutzer auf dem VPS.

Der Workflow führt zuerst `mise run check` aus. Danach verbindet er sich per SSH und ruft:

```bash
cd /opt/voltonaut
./deploy/deploy.sh deploy <commit-sha>
```

## Release-Ablauf

`deploy.sh deploy <commit-sha>`:

1. Holt den Commit aus `origin/main`.
2. Erstellt ein Worktree-Release unter `releases/<commit-sha>`.
3. Installiert die gepinnten Werkzeuge über mise und baut den Server.
4. Erstellt ein produktives, eigenständiges Verzeichnis mit `pnpm deploy --prod`.
5. Setzt den `current`-Symlink atomar um und startet systemd neu.
6. Prüft `GET /healthz` lokal. Schlägt die Prüfung fehl, stellt das Skript automatisch den vorherigen Release wieder her.

Rollback:

```bash
./deploy/deploy.sh rollback          # vorherigen Release wiederherstellen
./deploy/deploy.sh rollback <sha>   # benannten Release wiederherstellen
./deploy/deploy.sh status            # aktuellen Release und Health anzeigen
```

## Wartung

- Prüfe nach jedem Deploy: `systemctl status voltonaut-server` und `curl -fsS https://api.voltonaut.example.com/healthz`.
- Entferne alte Releases erst nach mindestens einer erfolgreichen Fahrt mit dem neuen Stand.
- Ändere Secrets nur über GitHub. Kopiere keine privaten Schlüssel in dieses Repository.
- Caddy und systemd reload sind manuelle Schritte. Das Skript startet nur den API-Dienst neu.
