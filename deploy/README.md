# API-Deploy vorbereiten und lokal prüfen

Die Dateien bereiten den API-Betrieb auf Hetzner hinter dem vorhandenen Traefik vor, gemäß ADR-004/009. Sie belegen keinen laufenden Produktionsserver. `SERVER_DEPLOY_ENABLED` bleibt `false`. Das GitHub-Environment `production` behält seine manuelle Freigabe. Spec und Abnahmekriterien stehen in [E0-03](../docs/specs/E0-03-api-deploy-config.md).

## Voraussetzungen vor einem produktiven Deploy

- Ein genehmigtes externes S3-kompatibles Backup-Ziel mit eigenen Zugangsdaten, nachgewiesener Replikation und erfolgreichem Restore. Der lokale Dateisystemtest unten ersetzt das nicht. Ein solcher Produktionsnachweis steht aus.
- Die sichere Bereitstellung der vorhandenen OIDC-Werte in `/srv/voltonaut/deploy.env`. Vorhandene GitHub-Secrets lassen sich nicht zurücklesen. Diese Anleitung liest oder ersetzt sie nicht.
- Der beim Anbieter exakt registrierte Callback `https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback`.
- Die Prüfung, dass Proxy- und Zugriffslogs keine Callback-Queries speichern. Kein Token oder Secret darf in Logs gelangen.
- Henrys separate Freigabe für Aktivierung und produktiven Deploy nach grünem Gate. Keine neue kostenpflichtige Buchung ist Teil dieser Änderung.

## Private Konfiguration bereitstellen

Führe diese Schritte erst mit gesonderter Produktionsfreigabe aus. Sie sind hier dokumentiert, nicht ausgeführt.

1. Lass einen berechtigten Betreiber die genehmigten Werte über seinen freigegebenen sicheren Zugang auf dem VPS eintragen. Verwende `deploy.env.example` ausschließlich als Vorlage. Ihre `.invalid`-Hosts und Platzhalter sind keine funktionierenden Zugänge.
2. Lege `/srv/voltonaut/deploy.env` mit Eigentümer Deploy-Nutzer und Modus `600` an. Ein restriktives `umask 077` verhindert zwischenzeitlich lesbare Dateien. Trage Secrets nicht als Shellargumente, im Chat oder in CI-Ausgaben ein.
3. Behalte `AUTH_MODE=oidc`, `CLIENT_ORIGIN=https://voltonaut.stammkneipe.dev` und den exakten Callback bei. Trage den freigegebenen Issuer ohne `/.well-known/`, die Client-ID und das Client-Secret ein.
4. Trage das ausdrücklich freigegebene externe Backup-Ziel und dessen Zugangsdaten ein. Eine Hetzner Storage Box ist nicht automatisch ein S3-Endpunkt.
5. Prüfe die Compose-Struktur ohne Ausgabe der aufgelösten Werte:

   ```bash
   cd /srv/voltonaut
   VOLTONAUT_TAG=<freigegebener-tag> docker compose --env-file deploy.env -f compose.yaml config --quiet
   ```

Verwende kein `source deploy.env`, `. deploy.env` oder `eval`. Docker Compose liest die Datei als Konfiguration, nicht als Shellprogramm. Schreibe literale Secretwerte in einfache Anführungszeichen, damit Compose ein enthaltenes `$` nicht interpoliert. Verwende kein unredigiertes `docker compose config`, `docker inspect` oder Shell-Trace mit Produktionswerten.

`deploy.sh` liest standardmäßig `deploy.env`. `VOLTONAUT_ENV_FILE` erlaubt einen anderen privaten Dateipfad. Die bestehende geschützte CI überträgt diese Datei nicht. Der Betreiber provisioniert sie unabhängig von GitHub CI. Der Workflow selbst bleibt unverändert. Änderungen am Workflow brauchen die separate Freigabe für geschützte Dateien.

### Konfigurationsvertrag

Compose verlangt einen expliziten Release-Tag, `AUTH_MODE`, `CLIENT_ORIGIN` und alle vier `LITESTREAM_*`-Felder aus der Beispieldatei. Es gibt keinen `latest`- oder Disabled-Fallback. Der vorhandene Serverparser prüft die Auth-Felder zusätzlich beim Prozessstart.

| Modus        | Verhalten                                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oidc`       | Verlangt `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`. Produktion verlangt HTTPS und den exakten Callbackpfad ohne Query oder Fragment. Kein Mailtransport.    |
| `disabled`   | Nur ausdrücklich auswählen. Health und Gastbetrieb bleiben verfügbar, Login und vorhandene Sessions sind deaktiviert. Kein Mailtransport. Kein Ersatz für funktionierendes Produktions-OIDC. |
| `magic-link` | Nur ausdrücklich gewählter Legacy-Betrieb. Ein echter Mailprovider mit gültiger Konfiguration bleibt Pflicht. `memory` startet in Produktion nicht.                                          |

Compose setzt `CORS_ORIGINS` exakt auf `CLIENT_ORIGIN`. Es übergibt nur Auth-/Mailfelder an den Server und nur Backupfelder an Litestream. Die Anwendung liest keine GitHub-Secrets direkt.

## Images, Netzwerk und SQLite

- `Dockerfile` verwendet weiterhin `node:24.22.3-slim`. Das Image enthält das frische Standalone-Paket aus `pnpm deploy --prod` und läuft als `node`, UID/GID `1000:1000`.
- `Dockerfile.dockerignore` schließt Host-`node_modules`, Build-Ausgaben und private Env-Dateien aus dem Build-Kontext aus. macOS-Addons dürfen nicht ins Linux-Image gelangen.
- Produktion bleibt das Compose-Projekt `voltonaut`. Der Server hat keine Host-Portbindung. Ausschließlich der Server tritt `financensor_default` bei. Traefik-Labels und Certresolver `letsencrypt` bleiben unverändert. Keine Änderung an Financensor.
- Nur der Server erzeugt und migriert `/app/data/voltonaut.db` auf dem named Volume. Er nutzt SQLite-WAL und Fremdschlüssel.
- Litestream bleibt auf `litestream/litestream:0.5.18` gepinnt. Sein Image hat bereits den Litestream-Binary-Entrypoint. Der Command beginnt deshalb mit `replicate`, nicht mit `sh`.
- Der Sidecar läuft ebenfalls als `1000:1000`, wartet auf Server-Health und schreibt eigene Replikationsmetadaten ins gemeinsame Volume. Er erzeugt keine leere Root-Datei per `touch`.
- Der Litestream-Healthcheck führt `sync -wait` über einen privaten Unix-Socket aus. Er wartet auf die Replikation zum konfigurierten Ziel. Ein laufender Prozess allein reicht nicht. Ein nicht beschreibbares Ziel verhindert einen erfolgreichen Release. Prüfe den externen Restore trotzdem separat. Ein lokales Ziel ersetzt kein Produktionsbackup.

## Releases und Rollback

Nach den Freigaben führt die bestehende CI den Build aus, überträgt das Image per `docker save`/`docker load` und startet `bash deploy.sh deploy <sha>`. Kein Registry-Zugang ist dafür nötig.

`deploy.sh` bestimmt das Serverimage mit dem angeforderten Tag über `compose config --images server`. Deshalb gilt für die lokale Image-Prüfung dieselbe Auswahl aus privater Env-Datei und Prozessumgebung wie für Pull und Start. Compose wartet auf beide Healthchecks, einschließlich der Replikation. Danach prüft das Skript zusätzlich die öffentliche Health-URL. Erst nach Erfolg schreibt es `state/previous-tag` und `state/current-tag`.

Bei fehlgeschlagenem Start oder Healthcheck startet das Skript den letzten bestätigten Tag und prüft dessen Health erneut. Ohne vorherigen Release stoppt es nur den Server. Fehlgeschlagene Versuche verändern die bestätigten Tags nicht. Auch ein fehlgeschlagener expliziter Rollback stellt den vorher bestätigten Tag wieder her. Scheitert diese Wiederherstellung ebenfalls, beschreibt die State-Datei nur den letzten bestätigten Release, nicht den aktuellen Laufzustand.

```bash
./deploy.sh rollback
./deploy.sh rollback <tag>
./deploy.sh status
```

Führe Release-Befehle nur seriell aus. Ein Image-Rollback stellt keinen alten Datenstand wieder her. Migrationen müssen für den vorherigen Binary-Stand kompatibel bleiben. Images und Datenvolumes werden nicht gelöscht. Das Skript verwendet kein `--remove-orphans`, `down` oder `prune`.

## Lokale Tests ohne Produktionszugriff

Die Release-Tests verwenden lokale Command-Ports über `PATH`. Jeder simulierte Compose-Aufruf wird zusätzlich mit der echten Compose-Konfiguration geprüft. Dafür ist der Compose-Client nötig, nicht der Docker-Daemon:

```bash
bash deploy/test-deploy.sh
```

Die Regressionen sind einzeln ausführbar mit `first-deploy` und `image-selection` als Argument. Sie prüfen den getaggten Stop nach einem fehlgeschlagenen Erstdeploy und ein ausschließlich in der privaten Env-Datei gewähltes lokales Image bei unerreichbarer Registry. Eine abweichende Prozessvariable muss dieselbe Image-Auswahl wie Compose erhalten.

Der Container-Test baut das echte Image frisch, startet einen eindeutigen isolierten Stack und verwendet keine Host-Ports. Er braucht Docker, Compose mit `--wait`, Zugriff auf die bereits gepinnten öffentlichen Images und ausreichend lokale Ressourcen. Führe ihn nicht parallel zu anderen schweren Docker-Prüfungen aus.

```bash
bash deploy/test-docker.sh
```

`deploy/verify-data.ts` läuft dabei direkt mit dem gepinnten Node 24, ohne Compilerlauf im Container. Für den `linux/x86_64`-Produktionshost muss zusätzlich das passende Image geprüft werden. Der emulierte lokale Lauf verwendet dieselben Tests:

```bash
DOCKER_DEFAULT_PLATFORM=linux/amd64 bash deploy/test-docker.sh
```

Der korrigierte Containerlauf ist für `linux/amd64` erfolgreich. Node 24.22.3 führt `verify-data.ts` dabei direkt als UID 1000 aus. Docker Desktop läuft auf `linux/aarch64` und emuliert AMD64 mit Rosetta, im Prozess über `/run/rosetta/rosetta` nachgewiesen. Das ist kein nativer VPS-Test und kein Leistungsnachweis.

Die lokalen Belege bleiben außerhalb des Repositories erhalten. `voltonaut-proof.4dS0QD` enthält den AMD64-Lauf samt `resources.txt`, `result.txt`, `emulation.txt` und Bereinigungslog. Der frühere ARM-Nachweis mit dem damaligen JavaScript-Helfer bleibt unter `voltonaut-proof.xLzCDh` erhalten. Beide belegen ausschließlich lokale Dateisystemreplikation.

Der Test prüft fehlenden Auth-Modus, fehlende OIDC-Felder und unzulässigen Produktions-Memory-Mailer gegen das echte Paket. Disabled startet ohne Mail. Ein laufender Sidecar mit absichtlich nicht beschreibbarem lokalem Ziel muss den Deploy-Healthcheck verfehlen. Danach erzeugt der Test synthetische Accounts und Sessions und speichert Profil und Fahrt über die API im OIDC-Modus. Kein OIDC-Anbieter wird aufgerufen. Ein Serverneustart muss diese Daten erhalten.

Litestream repliziert die Daten in ein frisches lokales Dateisystem-Volume. Nach dem Stoppen des Daemons synchronisiert `replicate -once -force-snapshot` den letzten Stand. `restore -o` schreibt ausschließlich in ein weiteres frisches Volume. Eine zweite Wiederherstellung auf dieselbe Datei muss scheitern. Die API aus demselben gebauten Image prüft nach Restore dieselben Sessions, Eigentümer, Profile, Fahrten, Belege, idempotenten Uploads und Fremdschlüssel.

Dies ist ausdrücklich ein **lokaler Dateisystemnachweis**, kein Offhost- oder S3-Produktionsnachweis. Das Skript gibt den temporären Belegpfad aus. `resources.txt` enthält die eigenen Ressourcennamen, `result.txt` erscheint nur nach Erfolg. Die Bereinigung entfernt ausschließlich Ressourcen dieses eindeutigen Testprojekts. Das gebaute lokale Testimage und die Belege bleiben für das Review erhalten. Es gibt keine Produktionsverbindung und keine Änderung bestehender Daten.
