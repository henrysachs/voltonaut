# Spec E0-03 – API-Deploy-Konfiguration und lokaler Restore

- **Roadmap-Bezug:** E0-opt, API auf Hetzner hinter vorhandenem Traefik, ADR-004/009.
- **Status:** Daemonlose Regressionen, emulierter AMD64-Containerlauf und unabhängiges Korrekturreview erfolgreich. Vollständiges lokales Integrationsgate und erneute daemonlose Regressionen grün. Externe CI und Übernahme nach E0-04. Kein produktives Deploy.
- **Betroffene Module:** `deploy/`, Docker-Build-Kontext. Keine Produktlogik oder Schemaänderung.

## Ziel

Das echte Produktionspaket startet mit expliziter Auth-Konfiguration und einem beschreibbaren SQLite-Volume. Ein wiederholbarer lokaler Litestream-Restore belegt Datenpersistenz, nicht externe Datensicherung.

## Konfigurationsformen und Entscheidung

1. Eine optionale Env-Datei mit automatischem `AUTH_MODE=disabled` erlaubt einen unbeabsichtigt deaktivierten Login. Sie wird verworfen.
2. Eine private, verpflichtende `deploy.env` liefert nur explizite Einstellungen. Compose verlangt Auth-Modus, Client-Origin und Backup-Zugang. Der vorhandene Serverparser prüft die vom Modus abhängigen OIDC- und Mailfelder beim Start. Diese Form wird umgesetzt. Es gibt keinen impliziten Auth-Fallback.

`deploy.sh` übergibt die Env-Datei an Compose, ohne sie als Shellcode auszuführen. Produktionswerte bleiben außerhalb des Repositories. GitHub-Environment-Secrets werden weder gelesen noch neu erzeugt. Die geschützte CI-Datei bleibt unverändert.

## Korrekturrunde und Signaturen

Der bisherige Command-Port akzeptierte ein ungetaggtes `stop`, obwohl die echte Compose-Konfiguration den Tag verlangt. Er prüft künftig jeden simulierten Compose-Aufruf mit dem echten `config --quiet`. Zwei getrennt ausführbare Regressionen prüfen den fehlgeschlagenen Erstdeploy und die lokale Image-Auswahl ohne Registry-Zugriff. Das zu prüfende Image kommt ausschließlich aus `VOLTONAUT_TAG=<tag> compose config --images server`. Compose besitzt damit die Auswahl aus Prozessumgebung und privater Env-Datei. Ein eigener Env-Parser entfällt.

Für den Datenprüfhelfer wurden zwei Formen verglichen. JavaScript mit JSDoc behält die Typkommentare als zweite Schreibweise. Gewählt ist `verify-data.ts` mit nativen TypeScript-Parametern, die das gepinnte Node 24 direkt ausführt. Keine neue Abhängigkeit oder Compilerkonfiguration.

- `request(path: string, token: string, method: "GET" | "PUT" | "POST", body?: string, expectedStatus = 200): Promise<string>` erhält unveränderte HTTP-Bytes.
- `save(name: string, value: string): void` und `read(name: string): string` behalten die vorhandenen Dateigrenzen.
- `createOwner()` liefert genau eine erzeugte UUID und ein zufälliges Sessiontoken. Zwei benannte Aufrufe bilden das feste Besitzerpaar, ohne möglicherweise fehlenden Arrayeintrag.
- SQLite-Abfragen behalten ihre konkreten SQL-Abfragen. `assert.ok(row)` prüft das mögliche Fehlen einer Zeile vor dem Zugriff auf deren Spalten. Keine Assertion-Casts oder Non-null-Operatoren.

## Abnahmekriterien

- [x] AK1 – Compose übergibt `AUTH_MODE`, `CLIENT_ORIGIN`, OIDC-Felder und kanonischen Callback. Fehlender Modus oder unvollständiges OIDC scheitert. Disabled/OIDC benötigen keine Mailzugänge.
- [x] AK2 – Ein frischer Linux-Build enthält keine Host-`node_modules`. Das Standalone-Paket startet als `node`, enthält Migrationen `0000`, `0001`, `0002` und persistiert Daten über Neustarts.
- [x] AK3 – Nur der Server erzeugt die SQLite-Datei. Der gepinnte Litestream-Sidecar startet mit echtem Entrypoint und passenden Schreibrechten ohne Root-Dateirennen. Ein laufender Sidecar mit fehlgeschlagener Replikation verhindert einen erfolgreichen Release.
- [x] AK4 – Litestream 0.5.18 repliziert synthetische Accounts, Sessions, Profile, Fahrten und Belege in ein frisches lokales Dateisystemziel. Restore in ein weiteres frisches Volume erhält Daten, Idempotenz und Fremdschlüssel. Keine Dateikopie als Ersatz für Restore. Der frühere ARM-Lauf bleibt erhalten. Der neue TypeScript-Helfer besteht denselben Test im emulierten AMD64-Image.
- [x] AK5 – Lokale Command-Port-Tests belegen angeforderten Pull-Tag, erfolgreiche Zustandsübernahme erst nach Health und unveränderten bestätigten Zustand nach fehlgeschlagenem Deploy oder Rollback. Keine fremden Container werden entfernt.
- [x] AK6 – README beschreibt private Bereitstellung mit Modus 600, manuelle Produktionsfreigabe und explizite Blocker für externe Backups und sichere OIDC-Provisionierung. `SERVER_DEPLOY_ENABLED` bleibt aus.

## Testplan

| AK         | Ebene                       | Prüfung                                                                                                   |
| ---------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1, 2, 3, 4 | Lokale Containerintegration | Gepinnte Images, eindeutige Testnamen, isoliertes Netz und frische Volumes. Keine Produktionsressourcen.  |
| 5          | Prozessintegration          | `bash deploy/test-deploy.sh` mit Command-Ports über `PATH` und echtem Compose-Client, ohne Docker-Daemon. |
| 6          | Review                      | Keine Secrets, Ports, Proxyänderungen, neuen Abhängigkeiten oder geschützten CI-Änderungen.               |

## Nicht-Ziele und Blocker

Keine Aktivierung, Buchung, Cloudressource oder produktive Migration. Auf dem VPS erfolgen keine Schreibzugriffe. Lokale Dateisystemreplikation ist kein Offhost-Backup. Externes S3-Ziel, Zugang und Restore-Nachweis bleiben Produktionsvoraussetzungen. Die sichere Bereitstellung vorhandener OIDC-Werte und die Prüfung von Callback-Query-Logs bleiben vor Produktion offen. Ein Image-Rollback setzt keine Datenmigration zurück.

## Bisheriger lokaler Nachweis am 20.11.2026

- `bash deploy/test-deploy.sh` ist grün. Vor den Änderungen scheiterten angeforderter Pull-Tag und der Zustand nach fehlgeschlagenem Erstdeploy.
- Der erste Lauf von `bash deploy/test-docker.sh` war grün. Das frische `linux/arm64`-Image lief als `node`. Das bestehende Dockerfile benötigte weder einen Shared-Build-Schritt noch eine Freigabe weiterer Native-Buildskripte. Die Pins bleiben unverändert. Dieser erste Nachweis galt ausschließlich für ARM.
- Der alte `sh`-Command scheitert am tatsächlichen Binary-Entrypoint. Ein gesonderter lokaler Shell-Test bestätigt außerdem das latente Root-`touch`-Problem durch `EACCES` für UID 1000.
- Ohne Litestream-Healthcheck war ein laufender Sidecar mit nicht beschreibbarem Replikationsziel fälschlich bereit. Derselbe Negativtest verhindert jetzt den Release. `sync -wait`, `replicate -once -force-snapshot` und `restore -o` wurden gegen das tatsächliche Image 0.5.18 geprüft.
- Belege liegen außerhalb des Repositories im ausgegebenen temporären Verzeichnis. `result.txt` bestätigt ausschließlich den lokalen Dateisystem-Restore. `resources.txt`, CLI-Hilfe, Build-, Fehler- und Bereinigungslogs erlauben die Zuordnung zum Testlauf.
- Formatter, Lint, Typecheck, Dependency-Cruiser und Guard sind grün. Fullgate und E2E laufen nicht parallel zur reservierten Parent-Prüfung.

## Reviewkorrektur am 20.11.2026

- Die neuen daemonlosen Regressionen mit Compose 5.6.1 waren vor den Logikänderungen getrennt rot. Beim Erstdeploy fehlte der Tag für `stop`. Bei der Image-Auswahl ignorierte die lokale Prüfung das ausschließlich in der privaten Env-Datei gewählte Image und versuchte einen unnötigen Pull.
- Nach den Änderungen sind `bash deploy/test-deploy.sh first-deploy`, `bash deploy/test-deploy.sh image-selection` und die vollständige Command-Port-Prüfung grün. Jeder simulierte Lifecycle-Aufruf muss jetzt die echte Compose-Konfiguration auflösen. Das Image kommt ausschließlich aus der getaggten Compose-Ausgabe, ohne Env-Parser.
- Die Belege `first-deploy-red.log`, `image-selection-red.log` und die zugehörigen Green-Logs liegen im temporären Verzeichnis `deploy-correction.NNZib5` außerhalb des Repositories. Es enthält keine gerenderte Secretkonfiguration.
- Nach der Ressourcenfreigabe besteht `DOCKER_DEFAULT_PLATFORM=linux/amd64 bash deploy/test-docker.sh` denselben vollständigen Build-, Daten- und Restore-Test. Das frische Image ist `linux/amd64`, ID `sha256:d9009e78eccfa73f6f731e6ad8ac1e80cd2db81887627b65222c9609bd356629`. `verify-data.ts` läuft direkt in Node 24.22.3 als UID 1000, ohne Compiler oder zusätzliche Abhängigkeit im Container.
- Der Docker-Host ist `linux/aarch64`. `/proc/self/maps` des AMD64-Prozesses enthält `/run/rosetta/rosetta`. Der Nachweis läuft unter Rosetta-Emulation, nicht nativ auf dem VPS und nicht als Leistungsprüfung. Die bisherigen Zeitlimits bleiben unverändert.
- Der neue Belegordner `voltonaut-proof.4dS0QD` enthält Image-ID, Plattform, Ergebnis, CLI-Hilfe, Build-, Fehler- und Bereinigungslogs sowie `emulation.txt`. Der frühere ARM-Belegordner `voltonaut-proof.xLzCDh` bleibt unverändert. Alle eigenen Container, Netzwerke und Volumes sind entfernt. Lokale Testimages und Belege bleiben für das Review erhalten.
- Die beiden korrigierten Release-Regressionen, der gesamte Command-Port-Test und der zusätzliche strikte Typecheck von `deploy/verify-data.ts` sind grün. Der unabhängige Korrekturprüfer wiederholt beide ursprünglichen Fehlerproben erfolgreich. HTTP-/Datenbankprüfungen und Nutzlastbytes des Prüfhelfers bleiben erhalten. Sein ausführbarer Nachweis samt Quellhashes liegt unter `$TMPDIR/opencode/deploy-correction-review-g3cxYO/`. Fullgate und externe CI bleiben offen.
- Ein zusätzlicher Nur-Lese-Aufruf auf dem Zielhost bestätigt Compose 5.8.0. Das ist kein nativer Containerlauf auf dem VPS. Externes S3-Backup, sichere OIDC-Provisionierung und Produktionsfreigabe bleiben offen.

## Doku-Updates

- `deploy/README.md` beschreibt den tatsächlichen Stand.
- Die E0-opt-Roadmap bleibt offen, solange das produktive Deploy und externe Backup nicht nachgewiesen sind.
- Keine neue ADR.
