# Spec E0-02 – Erster Web-Deploy

- **Roadmap-Bezug:** E0, erste öffentliche Web-App. Kein Abschluss des optionalen VPS-Deploys.
- **Status:** Erster Web-Deploy und späterer 3D-Deploy am 20.11.2026 nachgewiesen. API nicht veröffentlicht.
- **Freigabe:** Henry hat den ersten Deploy am 20.11.2026 im Auftrag ausdrücklich erlaubt.
- **Betroffen:** Cloudflare-Pages-Projekt und DNS. Keine Laufzeit-, CI- oder Serveränderung.

## Ziel

Der geprüfte `main` ist als gastfähige Web-App öffentlich erreichbar. Beim ersten Deploy bleibt der damals noch CI-rote 3D-PR unveröffentlicht.

## Abnahmekriterien des ersten Deploys

- [x] Beim ersten Deploy wird nur der gemergte Commit `11bab31b27e228bd08b814496c4eb3653afa31ae` veröffentlicht. Dessen [vollständiges CI-Gate](https://github.com/henrysachs/voltonaut/actions/runs/44723365856) ist grün.
- [x] `https://voltonaut.pages.dev/?sim=1` lädt ohne Anmeldung. Die Browserprüfung bestätigt Bewegung im HUD und Schalten mit der Tastatur.
- [x] `https://voltonaut.pages.dev/debug/ble.html` lädt den Sniffer. Die Browserprüfung verbindet keine Hardware und meldet keine Page-Errors.
- [x] `voltonaut.stammkneipe.dev` ist als Pages-Domain registriert. Ein proxied CNAME zeigt auf `voltonaut.pages.dev`.
- [x] Die eigene Domain liefert die Anwendung mit gültigem TLS. Der erste Browsernachweis verwendet die öffentliche DNS-Antwort direkt. Der lokale Resolver meldet dabei noch `ENOTFOUND`; dessen Ursache ist nicht abschließend geprüft.
- [x] Bestehende Dienste und Daten auf dem VPS bleiben unverändert. `SERVER_DEPLOY_ENABLED=false` bleibt bestehen.
- [x] Keine Zugangsdaten gelangen in Repository, Frontend oder Chat. Die bestehende lokale Cloudflare-Anmeldung wird nicht nach GitHub kopiert.

## Historischer erster Deploy

Der erste Stand enthält Sim-Fahrt, Physik, lokales Rider-Profil, lesende BLE-Verbindung und Sniffer. Er enthält weder die neue 3D-Szene aus PR #9 noch Cloudflare-OIDC oder Strava.

Die unveränderliche Deployment-URL ist [93235e50.voltonaut.pages.dev](https://93235e50.voltonaut.pages.dev). Cloudflare meldet den Produktionsdeploy als erfolgreich. Seine Commit-Metadaten stimmen mit dem freigegebenen `main` überein.

## Nachgewiesener öffentlicher Folgestand

Später am 20.11.2026 wurde `a2e0398cbe4daec165c4cc3bdc2a2b9c1828c379` mit der 3D-Welt veröffentlicht. Cloudflare bestätigt den erfolgreichen Produktionsdeploy `101facdb-e23a-4ca9-a60a-1177add4757c`. Seine unveränderliche URL ist [101facdb.voltonaut.pages.dev](https://101facdb.voltonaut.pages.dev).

Die externe Browserprüfung besteht auf dieser URL, `voltonaut.pages.dev` und `voltonaut.stammkneipe.dev` mit normaler DNS-Auflösung und TLS-Prüfung. Sie bestätigt die Landschaft mit See und Wald, Worker-Bewegung, Gangwechsel, Kamerawechsel, sicheren Browserkontext und Sniffer. Es treten keine Page-Errors auf. Die DNS-Einschränkung des ersten Nachweises gilt damit nicht mehr für diesen Folgestand.

Die lokale Aufnahme aus PR #13 ist inzwischen als `5e761d1` gemergt, aber nicht veröffentlicht. Der Server-OIDC-Login aus PR #15 ist als `1b264ac` gemergt, aber keine produktive API. Weblogin, Datensynchronisation und Strava sind nicht als produktiv nachgewiesen.

## Betriebskonfiguration

Das Pages-Projekt `voltonaut` verwendet das GitHub-Repository als Quelle und `main` als Produktionsbranch. Automatische Produktions- und Preview-Deploys sind ausgeschaltet. Der erste Build wurde nach dem grünen CI-Lauf ausdrücklich mit `cf pages deployments create` gestartet.

Der Build verwendet Node `24.22.3`, pnpm `10.33.0` und das eingefrorene Lockfile. Sein Ausgabeverzeichnis ist `apps/web/dist`. Browserdownloads und die automatische Abhängigkeitsinstallation von Pages sind ausgeschaltet. Der Build-Befehl führt die Installation selbst mit `--frozen-lockfile` aus.

In GitHub fehlen weiterhin die Cloudflare-Deploy-Secrets. Dieser manuelle Deploy aktiviert deshalb keine automatische Veröffentlichung zukünftiger Commits. Eine spätere CI-Anbindung benötigt einen eigenen, begrenzten Deploy-Zugang. Sie darf nicht ungeprüft die lokale OAuth-Anmeldung übernehmen.

## Verifikation des ersten Deploys

- `mise exec -- pnpm --filter @voltonaut/web build` ist für den veröffentlichten Web-Stand grün.
- Die externe Chromium-Prüfung lädt Sim-Fahrt und Sniffer über `pages.dev`. Tempo steigt, der Gang wechselt von 12 auf 13, beide Seiten antworten mit HTTP 200.
- Dieselben Prüfungen bestehen über die eigene Domain mit aktivierter TLS-Prüfung. Nur die DNS-Auflösung wird auf die öffentliche Cloudflare-Antwort festgelegt.
- Der öffentliche DNS-Resolver liefert den neuen Record. Der lokale Resolver meldet beim ersten Nachweis noch `ENOTFOUND`. Das belegt unterschiedliche Resolverantworten, nicht deren genaue Ursache. Beim ersten Nachweis bleibt deshalb `pages.dev` die verlässlich geprüfte Einstiegsadresse. Der Folgestand besteht später auch über die eigene Domain ohne Resolvervorgabe.
- An echter Hardware getestet: nein.

## Blockierter API-Deploy

Seit [E5-06](E5-06-oidc-server-login.md) verlangt `apps/server/src/config.ts` in Produktion ein explizites `AUTH_MODE`. `oidc` benötigt die OIDC-Konfiguration, aber wie `disabled` keinen Mailprovider. Nur `magic-link` verlangt weiterhin einen echten Mailprovider. `deploy/compose.yaml` übergibt dem Server bislang nur `HOST`. Auf dem VPS existiert noch kein `/srv/voltonaut`; eine Voltonaut-API ist nicht bereitgestellt. `SERVER_DEPLOY_ENABLED=false` bleibt bestehen.

Es wird kein Speicher-Mailer als Produktionslösung eingesetzt und keine Konfigurationsprüfung gelockert. Die gastfähige Web-App funktioniert ohne diese API. Für den API-Deploy fehlen die Übergabe der Produktionskonfiguration, ein eingerichtetes externes Backup-Ziel und ein Restore-Nachweis. Die hinterlegten Secrets `OIDC_ISSUER`, `OIDC_CLIENT_ID` und `OIDC_CLIENT_SECRET` ersetzen diese Betriebsschritte nicht. Der optionale VPS-Roadmappunkt bleibt offen.

## Offene Fragen

- API-Produktionskonfiguration und Backup-Ziel?
- Begrenzter Cloudflare-Zugang für spätere CI-Deploys?
