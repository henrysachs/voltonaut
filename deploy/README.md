# API auf dem vorhandenen VPS bereitstellen

Die API läuft als eigenes Compose-Projekt hinter dem vorhandenen Traefik. Henry genehmigt am 21.11.2026 den Produktionsdeploy, die sichere einmalige OIDC-Provisionierung und ausdrücklich den Betrieb ohne Backup. [ADR-020](../docs/decisions/ADR-020-explicit-production-provisioning.md) hält diese Entscheidung fest. Den tatsächlichen Rolloutstand dokumentiert [E0-04](../docs/specs/E0-04-production-rollout.md).

## Voraussetzungen

- Ein geprüftes Main-Release und ausdrückliche Produktionsfreigabe.
- Der vorhandene Deploy-Nutzer, sein dedizierter SSH-Schlüssel und ein unabhängig geprüfter Hostschlüssel.
- Eine private OIDC-Konfiguration mit kanonischer Client-Origin und exakt registriertem Callback.
- Bestehendes Netzwerk `financensor_default` und Certresolver `letsencrypt`. Keine Änderung an Financensor oder dessen Traefik-Grundkonfiguration.

Ein externes Backup ist für diesen ausdrücklich freigegebenen Betrieb keine Startvoraussetzung. Ohne Sicherung können ein Server- oder Volumeverlust und fehlerhafte Datenänderungen dauerhaft Daten kosten. Ein Image-Rollback stellt keinen alten Datenstand wieder her.

## OIDC einmalig sicher provisionieren

Der manuell gestartete Workflow `provision-server.yml` übernimmt ausschließlich vorhandene Produktionswerte. Er läuft nur auf `main` und behält die Freigabe des GitHub-Environments `production`. Die Prüfung des Provisionierers benötigt keine Produktionssecrets. PR-Läufe dürfen die eigentliche Provisionierung nicht starten.

Benötigt werden die bestehenden Environment-Secrets `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `OIDC_ISSUER`, `OIDC_CLIENT_ID` und `OIDC_CLIENT_SECRET`. `DEPLOY_USER` bezeichnet den vorhandenen Deploy-Nutzer. `DEPLOY_KNOWN_HOSTS` enthält dessen unabhängig geprüften SSH-Hostschlüssel für den Alias `voltonaut-production`. Kein ungeprüftes `ssh-keyscan` und kein deaktivierter Hostschlüsselcheck.

Die Konfiguration entsteht atomar unter `/srv/voltonaut/deploy.env`, mit Eigentümer Deploy-Nutzer und Modus `600`. Eine sichere, byteidentische Datei ist ein idempotenter Erfolg. Eine vorhandene andere oder unsichere Datei wird nicht überschrieben. Credentialrotation ist ein eigener Auftrag.

Secrets bleiben aus Prozessargumenten, Chat, Logs, Repository, Frontend, Image und CI-Artefakten heraus. Die bestehende lokale Cloudflare-Anmeldung wird nicht nach GitHub kopiert. Werte nicht per `source deploy.env`, `. deploy.env` oder `eval` laden. Docker Compose liest die Datei als Konfiguration, nicht als Shellprogramm.

Die Anwendung verwendet ausdrücklich `AUTH_MODE=oidc`, `CLIENT_ORIGIN=https://voltonaut.stammkneipe.dev` und `OIDC_CLOUDFLARE_REDIRECT_URI=https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/cloudflare/callback`. Fehlende OIDC-Werte führen zu einem Fehler, nicht zu Disabled oder einem Speicher-Mailer. Ein vorhandener OIDC-Modus belegt noch keinen erfolgreichen persönlichen Anbieterlogin.

### Umstellung auf Provider-Liste (ADR-025)

Der Server kennt nur noch `OIDC_PROVIDERS` und `OIDC_<ID>_*` (siehe `deploy.env.example`). `provision_env.py` liest weiterhin die Environment-Secrets `OIDC_ISSUER`, `OIDC_CLIENT_ID` und `OIDC_CLIENT_SECRET`, schreibt daraus aber `OIDC_PROVIDERS=cloudflare` und `OIDC_CLOUDFLARE_*`. Der Workflow bleibt unverändert, neue Secrets sind nicht nötig.

**Deploy-Sperre:** `deploy.sh deploy` und `rollback` brechen vor jedem Compose-, Pull- oder Startschritt ab, wenn `deploy.env` noch `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` oder `OIDC_REDIRECT_URI` enthält oder bei `AUTH_MODE=oidc` `OIDC_PROVIDERS` fehlt. Die Prüfung vergleicht nur Schlüsselnamen und gibt keine Werte aus. Ein automatischer Main-Deploy vor der Umstellung schlägt damit sichtbar fehl, und der laufende Release bleibt aktiv.

**Einmalige Umstellung auf dem VPS (vor dem ersten Release mit ADR-025, gesonderte Freigabe):**

1. In der Cloudflare-Access-Anwendung zusätzlich `https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/cloudflare/callback` als Redirect-URI eintragen. Die alte URI bleibt bis zum bestätigten Login eingetragen.
2. Das Skript des freigegebenen Commits als Deploy-Nutzer übertragen und ausführen (SSH mit dem geprüften Hostschlüssel, siehe oben):

   ```bash
   scp deploy/provision_env.py <deploy-user>@<deploy-host>:/srv/voltonaut/.migrate-provision_env.py
   ```

   ```bash
   ssh <deploy-user>@<deploy-host> 'python3 /srv/voltonaut/.migrate-provision_env.py migrate; status=$?; rm -f /srv/voltonaut/.migrate-provision_env.py; exit $status'
   ```

   Ausgabe `migrated` oder bei Wiederholung `unchanged`. Akzeptiert wird nur genau die vom Provisionierer geschriebene Alt-Datei (gleiche Schlüssel, alte Callback-URI, Eigentümer Deploy-Nutzer, Modus `600`). Alles andere, etwa zusätzliche Backup-Werte, wird unverändert abgelehnt (`provisioning failed`) und ist von Hand umzustellen. Die Werte bleiben gleich, nur die Redirect-URI wechselt. Die alte Datei bleibt als `deploy.env.legacy` (Modus `600`) erhalten; ein vorhandenes Backup wird nie ersetzt.
3. Den Release deployen und einen echten Login über Cloudflare bestätigen. Erst danach die alte Redirect-URI entfernen und `deploy.env.legacy` löschen.

**Rückweg:** Ein Rollback auf einen Release vor ADR-025 braucht wieder die alte Datei und die alte `compose.yaml`. Dafür `deploy.env.legacy` zurückkopieren und die `deploy/`-Dateien jenes Commits ausliefern, einschließlich seines `deploy.sh` ohne Sperre. Mit der neuen Datei startet ein alter Release nicht. Secrets für authentik nur nach gesonderter Freigabe.

## Standarddeploy ohne Backup

`compose.yaml` startet nur `server`. Er hat keine öffentliche Host-Portbindung, tritt dem vorhandenen Traefik-Netz bei und verwendet ein persistentes SQLite-Volume. Node läuft als UID/GID `1000:1000`. Die Anwendung erzeugt und migriert ihre eigene Datenbank mit WAL und Fremdschlüsseln. Lokale Fake-Daten werden nicht nach Produktion übernommen.

`Dockerfile` verwendet den gepinnten Node und ein Standalone-Paket aus `pnpm deploy --prod`. `Dockerfile.dockerignore` hält Host-Addons, Build-Ausgaben und private Env-Dateien aus dem Build-Kontext heraus. Der Produktionshost benötigt das passende Linux-Image.

Prüfe die Struktur ohne Ausgabe aufgelöster Werte:

```bash
VOLTONAUT_TAG=<freigegebener-tag> docker compose --env-file deploy.env -f compose.yaml config --quiet
```

Verwende kein unredigiertes `docker compose config`, `docker inspect` oder Shell-Trace mit Produktionswerten. Compose übergibt nur die vorgesehenen Auth- und Mailfelder an den Server. Strava und seine Quellenrichtlinie bleiben standardmäßig deaktiviert.

## Release und Rollback

Die bestehende CI kann das Image nach grünem Gate bauen und per SSH übertragen. `SERVER_DEPLOY_ENABLED` steuert die Aktivierung. Das Environment `production` behält seine manuelle Freigabe. Ein erfolgreicher Check allein ist kein Deploynachweis.

```bash
./deploy.sh deploy <freigegebener-tag>
./deploy.sh status
./deploy.sh rollback
./deploy.sh rollback <tag>
```

Führe Release-Befehle seriell aus. Das Skript wählt das tatsächliche Serverimage über `compose config --images server`. Nach Compose-Health muss auch die öffentliche HTTPS-Healthprüfung bestehen. Erst dann schreibt es `state/current-tag` und `state/previous-tag`.

Ein fehlgeschlagener Release stellt den letzten bestätigten Tag wieder her. Ohne vorherigen Release stoppt das Skript nur den eigenen Server. Fehlversuche verändern keine bestätigten Tags. Scheitert auch die Wiederherstellung, beschreibt die State-Datei nur den letzten bestätigten Release. Datenvolumes und Images werden nicht gelöscht. Es gibt kein `--remove-orphans`, `down` oder `prune` im Releasepfad.

## Backup nur bei ausdrücklicher Auswahl

Für eine spätere genehmigte Sicherung steht `compose.backup.yaml` zusätzlich zur Basis bereit. Dann sind auch `litestream.yml` und gültige externe S3-Werte nötig. Dieser Modus ist kein Bestandteil des aktuellen Produktionsauftrags.

```bash
VOLTONAUT_BACKUP_FILE=compose.backup.yaml ./deploy.sh deploy <freigegebener-tag>
```

Nur das geladene Backup-Overlay verlangt `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`, `LITESTREAM_ACCESS_KEY_ID` und `LITESTREAM_SECRET_ACCESS_KEY`. Ein leeres oder erfundenes Ziel gilt nicht als Sicherung. Litestream bleibt auf `0.5.18` gepinnt, läuft unprivilegiert und wartet auf die tatsächliche Replikation. Ein nur laufender Prozess reicht nicht. Eine spätere Backupfreigabe benötigt einen eigenen Offhost- und Restore-Nachweis.

## Lokale Prüfungen ohne Produktionszugriff

```bash
bash deploy/test-deploy.sh
bash deploy/test-docker.sh
DOCKER_DEFAULT_PLATFORM=linux/amd64 bash deploy/test-docker.sh
python3 -m unittest discover -s deploy -p 'test_provision_env.py'
```

Die Release-Tests verwenden lokale Command-Ports und prüfen jeden Compose-Aufruf gegen die echte Konfiguration. Sie erhalten Tests für fehlgeschlagenen Erstdeploy, Image-Auswahl, Recovery, Rollback und Datenerhalt. Der Standardmodus darf keine S3-Werte verlangen. Ein ausdrücklich ausgewähltes Backup-Overlay muss fehlende Zugangsdaten vor dem Start ablehnen.

Der echte Containerlauf verwendet ausschließlich eigene eindeutige Testprojekte, Netze und Volumes. Er prüft API-only-OIDC, UID-1000-SQLite, Migrationen und Wiederanlauf. Die bisherigen optionalen Replikations-, Nichtüberschreibungs- und Restoreprüfungen bleiben erhalten. Sie verwenden ein lokales Dateisystem und sind kein Produktionsbackup. Belege und Ressourcennamen werden vor der begrenzten Bereinigung festgehalten. Ein emulierter AMD64-Lauf auf ARM ist weder nativer VPS-Test noch Leistungsnachweis.
