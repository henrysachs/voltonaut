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

### Umstellung auf Provider-Liste (ADR-026)

Der Server kennt nur noch `OIDC_PROVIDERS` und `OIDC_<ID>_*` (siehe `deploy.env.example`). `provision_env.py` liest weiterhin die Environment-Secrets `OIDC_ISSUER`, `OIDC_CLIENT_ID` und `OIDC_CLIENT_SECRET`, schreibt daraus aber `OIDC_PROVIDERS=cloudflare` und `OIDC_CLOUDFLARE_*`. Der Workflow bleibt unverändert, neue Secrets sind nicht nötig.

**Absicherung in `deploy.sh`:**

- **Sperre:** `deploy` (und `rollback` ohne gespeicherte Konfiguration) bricht vor jedem Compose-, Pull- oder Startschritt ab, wenn `deploy.env` noch `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` oder `OIDC_REDIRECT_URI` enthält oder bei `AUTH_MODE=oidc` `OIDC_PROVIDERS` fehlt. Geprüft werden nur Schlüsselnamen, Werte werden nicht ausgegeben. Ein automatischer Main-Deploy vor der Umstellung schlägt sichtbar fehl, der laufende Release bleibt aktiv.
- **Validierung vor dem Wechsel:** Vor `up` prüft das neue Image seine Konfiguration in einem Einmal-Container (`compose run --rm --no-deps -T --label traefik.enable=false server node dist/main.js check-config`). Der laufende Container wird dabei nicht angefasst; die Ausgabe wird verworfen.
- **Konfiguration je Release:** Nach jedem gesunden Release sichert `deploy.sh` die verwendete `compose.yaml` und `deploy.env` unter `state/config/<tag>/` (Verzeichnis `700`, Dateien `600`), nur für aktuellen und vorigen Release. Die automatische Wiederherstellung nach einem fehlgeschlagenen Start und `rollback` starten den Ziel-Release mit dieser gespeicherten Konfiguration, relative Pfade (`strava.env`, Backup-Overlay) weiterhin aus dem Deploy-Verzeichnis. Ohne Snapshot wird wie bisher die aktuelle Konfiguration verwendet und das gemeldet.

**Einmalige Umstellung auf dem VPS (vor dem ersten Release mit ADR-026, gesonderte Freigabe):**

1. In der Cloudflare-Access-Anwendung zusätzlich `https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/cloudflare/callback` als Redirect-URI eintragen. Die alte URI bleibt bis zum bestätigten Login eingetragen.
2. `deploy.sh` und `provision_env.py` des freigegebenen Commits als Deploy-Nutzer übertragen (SSH mit dem geprüften Hostschlüssel, siehe oben):

   ```bash
   scp deploy/deploy.sh <deploy-user>@<deploy-host>:/srv/voltonaut/.migrate-deploy.sh
   ```

   ```bash
   scp deploy/provision_env.py <deploy-user>@<deploy-host>:/srv/voltonaut/.migrate-provision_env.py
   ```

3. Zuerst die laufende Alt-Konfiguration für den aktuellen Release sichern, dann `deploy.env` umstellen:

   ```bash
   ssh <deploy-user>@<deploy-host> 'cd /srv/voltonaut && bash .migrate-deploy.sh snapshot && python3 .migrate-provision_env.py migrate; status=$?; rm -f .migrate-deploy.sh .migrate-provision_env.py; exit $status'
   ```

   `snapshot` legt `state/config/<laufender-tag>/` mit der bisherigen `compose.yaml` und `deploy.env` an. `migrate` gibt `migrated` oder bei Wiederholung `unchanged` aus. Akzeptiert wird nur genau die vom Provisionierer geschriebene Alt-Datei (gleiche Schlüssel, alte Callback-URI, Eigentümer Deploy-Nutzer, Modus `600`). Alles andere, etwa zusätzliche Backup-Werte, wird unverändert abgelehnt (`provisioning failed`) und ist von Hand umzustellen. Die Werte bleiben gleich, nur die Redirect-URI wechselt. Die alte Datei bleibt zusätzlich als `deploy.env.legacy` (Modus `600`) erhalten; ein vorhandenes Backup wird nie ersetzt.
4. Den Release deployen. Scheitert Validierung oder Start, läuft bzw. startet der bisherige Release mit seiner gesicherten Alt-Konfiguration. Danach einen echten Login über Cloudflare bestätigen.
5. Erst danach die alte Redirect-URI entfernen und `deploy.env.legacy` löschen. Der Snapshot des alten Releases entfällt automatisch mit dem übernächsten Release.

**Rückweg:** `bash deploy.sh rollback` startet den vorigen Release mit seiner gespeicherten Konfiguration; die aktuelle `deploy.env` bleibt unverändert. Ohne Snapshot (Schritt 3 ausgelassen) startet ein Release vor ADR-026 mit der neuen Datei nicht; dann `deploy.env.legacy` und die `deploy/`-Dateien jenes Commits zurückspielen. Secrets für authentik nur nach gesonderter Freigabe.

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
