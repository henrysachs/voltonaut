# Spec E0-04 – Web und API produktiv bereitstellen

- **Auftrag und Freigabe:** Henry beauftragt am 21.11.2026 ausdrücklich den Produktionsdeploy von Web und API.
- **Basis:** `9b8e28b500f5aaf000c57ff2aa094835b412416e`, alle drei Main-Workflows erfolgreich.
- **Status:** In Arbeit. Zuerst lesender Betriebsbefund, dann getrennte Bereitstellung und öffentliche Prüfung.
- **Betroffen:** Bestehendes Pages-Projekt `voltonaut`, dediziertes API-Compose-Projekt auf dem vorhandenen VPS und sichere Produktionskonfiguration ohne Backup.

## Ziel

Die aktuelle Fahrtoberfläche ist öffentlich über HTTPS erreichbar. Die eigene API erhält gültiges TLS und echtes OIDC. Henry wählt ausdrücklich den Betrieb ohne Backup. Der lokale Fahrstand bleibt unabhängig verfügbar.

## Ausgangsbefund

Pages liefert noch den Stand `a2e0398`; automatische Deploys sind deaktiviert. Auf dem VPS existieren weder `/srv/voltonaut` noch Voltonaut-Volumes. Die API-Adresse liefert das Traefik-Standardzertifikat statt eines gültigen eigenen Zertifikats. Bestehende Financensor-Dienste werden nicht verändert.

OIDC-Anwendung, eingeschränkte Pilot-Policy und Produktionscallback sind vorhanden. Das Client-Secret liegt ausschließlich als nicht auslesbares GitHub-Environment-Secret vor. Ein privates API-Environment wurde noch nicht provisioniert. R2 ist bereits aktiv; ein dediziertes Voltonaut-Backupziel existiert noch nicht.

## Abnahmekriterien

- [x] AK1 – Pages veröffentlicht ausschließlich den freigegebenen grünen Main-Stand. Eigene Domain, Sim-Fahrt, Geräteoberfläche, Menü, Aufnahme und TCX funktionieren am öffentlichen gebauten Artefakt ohne Hardwarezugriff.
- [ ] AK2 – API-Image stammt aus demselben geprüften Stand. Container läuft unprivilegiert, ohne öffentliche Host-Portbindung, hinter dem bestehenden Traefik. Bestehende Dienste und Daten bleiben erhalten.
- [ ] AK3 – Produktionsmodus bleibt ausdrücklich OIDC. Issuer, Client-ID und Secret gelangen nur über einen freigegebenen sicheren Kanal in die private Serverkonfiguration. Kein Disabled- oder Speicher-Mailer-Fallback und keine blinde Credentialrotation.
- [ ] AK4 – Normaler Deploy benötigt weder Litestream noch S3-Werte. SQLite bleibt persistent. Es werden keine Backupressourcen angelegt und keine Offhost-Wiederherstellung behauptet. Der optionale Backupmodus bleibt getrennt fail-closed geprüft.
- [ ] AK5 – Öffentliche API hat gültiges TLS, korrekte Credential-CORS und geschützte eigene Endpunkte. Callback-Queries und Secrets erscheinen nicht in Betriebslogs. Ein erzwungener Login im Namen eines Pilotnutzers wird nicht vorgetäuscht.
- [ ] AK6 – Tatsächliche Release-IDs, Commit, URLs, Health, Sicherung und verbleibende manuelle Abnahmen sind getrennt dokumentiert. Kein bloß erfolgreicher Workflow gilt als Deploynachweis.

## Grenzen

Keine Datenlöschung oder Übernahme lokaler Fake-Daten nach Produktion. Keine Änderung bestehender Identitäten, Pilotadressen, Traefik-Grundkonfiguration oder anderer Anwendungen. Kein neuer kostenpflichtiger Tarif ohne Freigabe. Änderungen an geschützten Workflows benötigen ADR und ausdrückliche Freigabe. Manuelle Produktionsfreigaben bleiben erhalten.

Strava-Upload bleibt standardmäßig deaktiviert. Deployfreigabe ersetzt weder echte Anbieterzustimmung noch Sichtbarkeits-/Datenschutzprüfung. Die Hardwareabnahme von Trainer und Controllern bleibt offen. Render-Issue #26 wird durch den Deploy nicht als behoben ausgegeben.

## Testplan

Bestehendes `mise run check`, Produktionsimage und Compose-Vertrag verwenden. Compose- und Containerproben arbeiten ausschließlich mit synthetischen Daten und eigenen isolierten Ressourcen. Danach öffentliche Read-only-API-Prüfungen und ein frischer Browserkontext für Gast/Sim, Aufnahme, TCX, Reload und gebaute Worker. Keine realen BLE-Verbindungen und keine Authentifizierung als Henry durch den Agenten.

## Freigegebene Betriebsentscheidungen

- Henry genehmigt den einmaligen CI-Provisionierungs-Workflow mit ADR und unveränderter manueller Produktionsfreigabe.
- Henry entscheidet ausdrücklich gegen ein Backup. Kein R2-Bucket und keine Backup-Credentials werden angelegt.
- [ADR-020](../decisions/ADR-020-explicit-production-provisioning.md) hält Übergabe, Nichtüberschreiben und den persistenten Betrieb ohne Sicherung fest.
- Keine offenen Anforderungsfragen. Tatsächlicher Credential- und Deploynachweis bleibt zu erbringen.

## Bisherige Nachweise

Pages-Produktionsdeploy `7b3d9bc5-723e-4834-9325-5fe215addff7` liefert den geprüften Stand `9b8e28b`. Buildlog und Deploymentmetadaten bestätigen denselben Checkout. Die eigene Domain besteht mit normaler TLS-Prüfung, sichtbarer Welt, Menü, Geräteoberfläche, Sniffer, Sim-Schaltung, rohem V2-Abschluss, TCX und identischem Reload. Die gebaute Strava-Finishseite entfernt ihre Query vor der ersten Skriptanforderung. Keine Hardware ausgewählt und kein persönlicher Anbieterlogin durchgeführt.

Die No-Backup-Komposition und der Provisionierer sind unabhängig freigegeben. Base plus Backup-Overlay entspricht der bisherigen vollständigen Compose-Konfiguration. Der neue Standard enthält nur API und persistentes SQLite. Tatsächliche ARM64- und emulierte AMD64-Containerproben bestehen einschließlich Datenbesitz, Migrationen, OIDC-Konfiguration, geschützter Daten, Idempotenz und Wiederanlauf. Die bisherigen optionalen Replikations- und Restoregegenproben bleiben erhalten. Dies aktiviert keine Sicherung in Produktion.

Das reguläre `E2E_PORT=5236 CI=1 mise run check` besteht mit 822 Unit-Tests einschließlich Coverage und 49 Browserfällen. Build und Release-Kommandotests grün. Provisionierungstests bestehen lokal mit 16 Fällen und einem mangels Rootrechten übersprungenen Fremdbesitzfall. Der neue Workflow prüft diesen Fall gesondert in seiner isolierten CI. Tatsächliche Credentialübergabe und API-Aktivierung stehen noch aus.

Private Belege liegen unter `$TMPDIR/opencode/production-deploy-CcIOVO/`, `oidc-runtime-review-wwj9f_ef/` und den darin referenzierten Docker-Proof-Verzeichnissen. Literalwerte mit Dollarzeichen, Quotes, Backslashes und Unicode sind zusätzlich im tatsächlichen Containerprozess geprüft. Secrets bleiben aus den Belegen und Logs heraus.
