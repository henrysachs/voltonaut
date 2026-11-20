# Spec E0-02 – Erster Web-Deploy

- **Roadmap-Bezug:** E0, erste öffentliche Web-App. Kein Abschluss des optionalen VPS-Deploys.
- **Status:** Web veröffentlicht am 20.11.2026. API-Deploy blockiert.
- **Freigabe:** Henry hat den ersten Deploy am 20.11.2026 im Auftrag ausdrücklich erlaubt.
- **Betroffen:** Cloudflare-Pages-Projekt und DNS. Keine Laufzeit-, CI- oder Serveränderung.

## Ziel

Der geprüfte `main` ist als gastfähige Web-App öffentlich erreichbar. Der noch CI-rote 3D-PR wird nicht veröffentlicht.

## Abnahmekriterien

- [x] Nur der gemergte Commit `11bab31b27e228bd08b814496c4eb3653afa31ae` wird veröffentlicht. Dessen [vollständiges CI-Gate](https://github.com/henrysachs/voltonaut/actions/runs/44723365856) ist grün.
- [x] `https://voltonaut.pages.dev/?sim=1` lädt ohne Anmeldung. Die Browserprüfung bestätigt Bewegung im HUD und Schalten mit der Tastatur.
- [x] `https://voltonaut.pages.dev/debug/ble.html` lädt den Sniffer. Die Browserprüfung verbindet keine Hardware und meldet keine Page-Errors.
- [x] `voltonaut.stammkneipe.dev` ist als Pages-Domain registriert. Ein proxied CNAME zeigt auf `voltonaut.pages.dev`.
- [x] Die eigene Domain liefert die Anwendung mit gültigem TLS. Der erste Browsernachweis verwendet die öffentliche DNS-Antwort direkt, weil der lokale Resolver noch eine negative Antwort zwischenspeichert.
- [x] Bestehende Dienste und Daten auf dem VPS bleiben unverändert. `SERVER_DEPLOY_ENABLED=false` bleibt bestehen.
- [x] Keine Zugangsdaten gelangen in Repository, Frontend oder Chat. Die bestehende lokale Cloudflare-Anmeldung wird nicht nach GitHub kopiert.

## Veröffentlichter Stand

Der Stand enthält Sim-Fahrt, Physik, lokales Rider-Profil, lesende BLE-Verbindung und Sniffer. Er enthält weder die neue 3D-Szene aus PR #9 noch Cloudflare-OIDC oder Strava.

Die unveränderliche Deployment-URL ist [93235e50.voltonaut.pages.dev](https://93235e50.voltonaut.pages.dev). Cloudflare meldet den Produktionsdeploy als erfolgreich. Seine Commit-Metadaten stimmen mit dem freigegebenen `main` überein.

## Betriebskonfiguration

Das Pages-Projekt `voltonaut` verwendet das GitHub-Repository als Quelle und `main` als Produktionsbranch. Automatische Produktions- und Preview-Deploys sind ausgeschaltet. Der erste Build wurde nach dem grünen CI-Lauf ausdrücklich mit `cf pages deployments create` gestartet.

Der Build verwendet Node `24.22.3`, pnpm `10.33.0` und das eingefrorene Lockfile. Sein Ausgabeverzeichnis ist `apps/web/dist`. Browserdownloads und die automatische Abhängigkeitsinstallation von Pages sind ausgeschaltet. Der Build-Befehl führt die Installation selbst mit `--frozen-lockfile` aus.

In GitHub fehlen weiterhin die Cloudflare-Deploy-Secrets. Dieser manuelle Deploy aktiviert deshalb keine automatische Veröffentlichung zukünftiger Commits. Eine spätere CI-Anbindung benötigt einen eigenen, begrenzten Deploy-Zugang. Sie darf nicht ungeprüft die lokale OAuth-Anmeldung übernehmen.

## Verifikation

- `mise exec -- pnpm --filter @voltonaut/web build` ist für den veröffentlichten Web-Stand grün.
- Die externe Chromium-Prüfung lädt Sim-Fahrt und Sniffer über `pages.dev`. Tempo steigt, der Gang wechselt von 12 auf 13, beide Seiten antworten mit HTTP 200.
- Dieselben Prüfungen bestehen über die eigene Domain mit aktivierter TLS-Prüfung. Nur die DNS-Auflösung wird auf die öffentliche Cloudflare-Antwort festgelegt.
- Der öffentliche DNS-Resolver liefert den neuen Record. Der lokale Resolver meldet beim ersten Nachweis noch `ENOTFOUND`. Deshalb bleibt `pages.dev` bis zur normalen lokalen Auflösung die verlässlich geprüfte Einstiegsadresse.
- An echter Hardware getestet: nein.

## Blockierter API-Deploy

`apps/server/src/config.ts` verlangt im Produktionsmodus einen echten Mailprovider. `deploy/compose.yaml` übergibt dem Server bislang nur `HOST`. Auf dem VPS existiert noch kein Voltonaut-Projektverzeichnis.

Es wird kein Speicher-Mailer als Produktionslösung eingesetzt und keine Konfigurationsprüfung gelockert. Die gastfähige Web-App funktioniert ohne diese API. Für den API-Deploy fehlen eine zur Auth-Entscheidung passende Produktionskonfiguration und ein überprüfbares Backup-Ziel. Der optionale VPS-Roadmappunkt bleibt offen.

## Offene Fragen

- API-Produktionskonfiguration und Backup-Ziel?
- Begrenzter Cloudflare-Zugang für spätere CI-Deploys?
