# Spec E0-04 – Web und API produktiv bereitstellen

- **Auftrag und Freigabe:** Henry beauftragt am 21.11.2026 ausdrücklich den Produktionsdeploy von Web und API.
- **Basis:** `9b8e28b500f5aaf000c57ff2aa094835b412416e`, alle drei Main-Workflows erfolgreich.
- **Status:** Web und API auf `916edbb` produktiv bereitgestellt und öffentlich softwaregeprüft. Persönlicher Anbieterlogin und Hardwareabnahme bleiben offen.
- **Betroffen:** Bestehendes Pages-Projekt `voltonaut`, dediziertes API-Compose-Projekt auf dem vorhandenen VPS und sichere Produktionskonfiguration ohne Backup.

## Ziel

Die aktuelle Fahrtoberfläche ist öffentlich über HTTPS erreichbar. Die eigene API erhält gültiges TLS und echtes OIDC. Henry wählt ausdrücklich den Betrieb ohne Backup. Der lokale Fahrstand bleibt unabhängig verfügbar.

## Ausgangsbefund

Pages liefert noch den Stand `a2e0398`; automatische Deploys sind deaktiviert. Auf dem VPS existieren weder `/srv/voltonaut` noch Voltonaut-Volumes. Die API-Adresse liefert das Traefik-Standardzertifikat statt eines gültigen eigenen Zertifikats. Bestehende Financensor-Dienste werden nicht verändert.

OIDC-Anwendung, eingeschränkte Pilot-Policy und Produktionscallback sind vorhanden. Das Client-Secret liegt ausschließlich als nicht auslesbares GitHub-Environment-Secret vor. Ein privates API-Environment wurde noch nicht provisioniert. R2 ist bereits aktiv; ein dediziertes Voltonaut-Backupziel existiert noch nicht.

## Abnahmekriterien

- [x] AK1 – Pages veröffentlicht ausschließlich den freigegebenen grünen Main-Stand. Eigene Domain, Sim-Fahrt, Geräteoberfläche, Menü, Aufnahme und TCX funktionieren am öffentlichen gebauten Artefakt ohne Hardwarezugriff.
- [x] AK2 – API-Image stammt aus demselben geprüften Stand. Container läuft unprivilegiert, ohne öffentliche Host-Portbindung, hinter dem bestehenden Traefik. Bestehende Dienste und Daten bleiben erhalten.
- [x] AK3 – Produktionsmodus bleibt ausdrücklich OIDC. Issuer, Client-ID und Secret gelangen nur über einen freigegebenen sicheren Kanal in die private Serverkonfiguration. Kein Disabled- oder Speicher-Mailer-Fallback und keine blinde Credentialrotation.
- [x] AK4 – Normaler Deploy benötigt weder Litestream noch S3-Werte. SQLite bleibt persistent. Es werden keine Backupressourcen angelegt und keine Offhost-Wiederherstellung behauptet. Der optionale Backupmodus bleibt getrennt fail-closed geprüft.
- [x] AK5 – Öffentliche API hat gültiges TLS, korrekte Credential-CORS und geschützte eigene Endpunkte. Callback-Queries und Secrets erscheinen nicht in Betriebslogs. Ein erzwungener Login im Namen eines Pilotnutzers wird nicht vorgetäuscht.
- [x] AK6 – Tatsächliche Release-IDs, Commit, URLs, Health, Sicherung und verbleibende manuelle Abnahmen sind getrennt dokumentiert. Kein bloß erfolgreicher Workflow gilt als Deploynachweis.

## Grenzen

Keine Datenlöschung oder Übernahme lokaler Fake-Daten nach Produktion. Keine Änderung bestehender Identitäten, Pilotadressen, Traefik-Grundkonfiguration oder anderer Anwendungen. Kein neuer kostenpflichtiger Tarif ohne Freigabe. Änderungen an geschützten Workflows benötigen ADR und ausdrückliche Freigabe. Manuelle Produktionsfreigaben bleiben erhalten.

Strava-Upload bleibt standardmäßig deaktiviert. Deployfreigabe ersetzt weder echte Anbieterzustimmung noch Sichtbarkeits-/Datenschutzprüfung. Die Hardwareabnahme von Trainer und Controllern bleibt offen. Render-Issue #26 wird durch den Deploy nicht als behoben ausgegeben.

## Testplan

Bestehendes `mise run check`, Produktionsimage und Compose-Vertrag verwenden. Compose- und Containerproben arbeiten ausschließlich mit synthetischen Daten und eigenen isolierten Ressourcen. Danach öffentliche Read-only-API-Prüfungen und ein frischer Browserkontext für Gast/Sim, Aufnahme, TCX, Reload und gebaute Worker. Keine realen BLE-Verbindungen und keine Authentifizierung als Henry durch den Agenten.

## Freigegebene Betriebsentscheidungen

- Henry genehmigt den einmaligen CI-Provisionierungs-Workflow mit ADR und unveränderter manueller Produktionsfreigabe.
- Henry entscheidet ausdrücklich gegen ein Backup. Kein R2-Bucket und keine Backup-Credentials werden angelegt.
- [ADR-020](../decisions/ADR-020-explicit-production-provisioning.md) hält Übergabe, Nichtüberschreiben und den persistenten Betrieb ohne Sicherung fest.
- Keine offenen Anforderungsfragen. Credential- und Deploynachweise sind unten festgehalten.

## Nachweise

Pages-Produktionsdeploy `7b3d9bc5-723e-4834-9325-5fe215addff7` liefert den geprüften Stand `9b8e28b`. Buildlog und Deploymentmetadaten bestätigen denselben Checkout. Die eigene Domain besteht mit normaler TLS-Prüfung, sichtbarer Welt, Menü, Geräteoberfläche, Sniffer, Sim-Schaltung, rohem V2-Abschluss, TCX und identischem Reload. Die gebaute Strava-Finishseite entfernt ihre Query vor der ersten Skriptanforderung. Keine Hardware ausgewählt und kein persönlicher Anbieterlogin durchgeführt.

Der endgültige Web-Deploy `7c8c881a-586e-4516-818a-f2ec739bf99e` und der API-Release verwenden beide `916edbb070ee5c3ffaeea5836cd91dfed3410836`. Pages-Buildlog bestätigt den tatsächlichen Checkout. Öffentliche Workerbytes entsprechen den geprüften Artefakten. Die Gast-/Sim-Aufnahmeprüfung besteht nach diesem Deploy erneut.

Henry hat den [Provisionierungslauf](https://github.com/henrysachs/voltonaut/actions/runs/44889675380) und anschließend den [API-Deploy](https://github.com/henrysachs/voltonaut/actions/runs/44890102275) jeweils im bestehenden GitHub-Environment `production` manuell freigegeben. Alle Schritte sind erfolgreich. Die vorhandene Schutzkonfiguration bleibt unverändert. Die private OIDC-Datei liegt als Deploy-Nutzer mit Modus 600 vor und enthält ausschließlich die sechs genehmigten Felder. Es bleiben keine Stagingdateien zurück. Werte wurden nicht ausgegeben oder in Images übernommen.

Der native VPS führt das CI-gebaute `linux/amd64`-Image `sha256:27cdc2241fdd58525aabc2534709ffdbb67b5c2a3d3bfe7cda231eee61308c59` als `node` aus. Ein SSH-Aufruf über den bereits vertrauten Hostzugang bestätigt dieselbe Image-ID wie das CI-Buildlog, den Release-Tag, Health und `state/current-tag`. Im Voltonaut-Projekt läuft nur `voltonaut-server-1`, ohne veröffentlichte Host-Ports, mit persistentem `voltonaut_sqlite`. Datenbankprozess und Datei gehören UID 1000. Sechs normale Migrationen und Fremdschlüsselintegrität sind bestätigt.

`https://api.voltonaut.stammkneipe.dev/healthz` antwortet mit 200 und gültigem Let's-Encrypt-Zertifikat. Eigene Endpunkte lehnen fehlende Sessions mit 401 ab. Credential-CORS erlaubt exakt die kanonische Web-Origin und keinen fremden Ursprung. Der echte OIDC-Einstieg bestätigt Cloudflare-Discovery, registrierte Client-ID und Callback, PKCE S256 sowie hostgebundenes Secure-/HttpOnly-Cookie. Es wird kein persönlicher Login oder Tokenaustausch als Pilotnutzer behauptet.

Die No-Backup-Komposition und der Provisionierer sind unabhängig freigegeben. Base plus Backup-Overlay entspricht der bisherigen vollständigen Compose-Konfiguration. Der neue Standard enthält nur API und persistentes SQLite. Tatsächliche ARM64- und emulierte AMD64-Containerproben bestehen einschließlich Datenbesitz, Migrationen, OIDC-Konfiguration, geschützter Daten, Idempotenz und Wiederanlauf. Die bisherigen optionalen Replikations- und Restoregegenproben bleiben erhalten. Dies aktiviert keine Sicherung in Produktion.

Das reguläre `E2E_PORT=5236 CI=1 mise run check` besteht mit 822 Unit-Tests einschließlich Coverage und 49 Browserfällen. Build und Release-Kommandotests grün. Provisionierungstests bestehen lokal mit 16 Fällen und einem mangels Rootrechten übersprungenen Fremdbesitzfall. Der neue Workflow bestätigt auch diesen Fall gesondert als Root in seiner isolierten CI. Alle drei Main-Push-Workflows auf `916edbb` sowie der tatsächliche Deploy sind erfolgreich.

`SERVER_DEPLOY_ENABLED` war ausschließlich für den beauftragten Dispatch aktiv und steht wieder auf `false`. Künftige Main-Pushes aktivieren deshalb keinen neuen Produktionsdeploy. Backups bleiben ausdrücklich aus. Der lokale Fahrstand wurde durch diesen Rollout nicht verändert.

## Noch offene reale Abnahmen

Persönlicher Cloudflare-Login mit Allow/Deny und Identitätsstabilität, echte Trainer-/Controllerfahrt und der ausdrücklich beauftragte reale Strava-Pilot bleiben getrennt. Mitgliedsstufen mit Adminoberfläche und ein noch nachzuweisender Renderfix aus #26 sind nachfolgende Aufträge, keine Eigenschaften dieses Release-Nachweises.

Private Belege liegen unter `$TMPDIR/opencode/production-deploy-CcIOVO/`, `oidc-runtime-review-wwj9f_ef/` und den darin referenzierten Docker-Proof-Verzeichnissen. Literalwerte mit Dollarzeichen, Quotes, Backslashes und Unicode sind zusätzlich im tatsächlichen Containerprozess geprüft. Secrets bleiben aus den Belegen und Logs heraus.
