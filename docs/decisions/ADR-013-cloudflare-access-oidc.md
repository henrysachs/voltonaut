# ADR-013 – Cloudflare Access als OIDC-Broker für den Login

**Status:** Angenommen als Zielentscheidung durch Henry (2026-11-20). Henry hat Access am selben Tag aktiviert. App und Pilot-Policy sind inzwischen nach separater Freigabe eingerichtet, siehe [E5-04](../specs/E5-04-access-oidc-pilot-setup.md). Implementierung und Produktionsnachweis stehen aus. Ersetzt den Magic-Link-Standard aus ADR-005 Punkt 6 und den Login-Mail-Teil von ADR-009. Spec: [E5-03](../specs/E5-03-cloudflare-access-oidc.md).

## Kontext

Henry wählt Cloudflare Access für den Login. Das [Voltonaut-Konto](../../GLOSSARY.md) und seine Spieldaten bleiben unter Voltonauts Kontrolle wie in ADR-005. Die öffentliche Anwendung einschließlich Offline-, Sim-, E3- und BLE-Fahrt bleibt anonym nutzbar.

Der erste übernommene Nur-Lese-Befund vom 20.11.2026 lieferte für Access-Organisation, Identity Provider und Anwendungen jeweils HTTP 403, Code 9999, `access.api.error.not_enabled`. Henry hat Access danach selbst aktiviert. Die erneute Nur-Lese-Prüfung am selben Tag bestätigt eine Organisation, genau einen Identity Provider vom Typ `cloudflare` und keine Anwendungen. Google oder Microsoft sind nicht als konfigurierte IdPs nachgewiesen. Die Organisationsantwort enthält weder Plan noch Seats; Tarif und Kontingent bleiben unbestätigt.

Diese Befunde stammen aus dem verbundenen MCP-Zugang; die `cf`-CLI war nicht installiert. Der prüfende Agent führte keine externen Schreiboperationen aus und erzeugte keine Secrets. Teamdomain, Account-ID und IdP-ID werden nicht im Repo festgeschrieben; die Umsetzung verwendet Umgebungskonfiguration.

PR #6 mit lokalen `users`, `sessions`, `login_tokens` und SQLite ist inzwischen als `191d4e8` auf `main` gemergt. Seine Auth-Grundlage ist verfügbar, OIDC noch nicht implementiert. ADR-012 dokumentiert das serverseitige `skipLibCheck`.

## Entscheidung

### Öffentliche Anwendung und lokaler Account

- Access wird als generische OIDC-SaaS-Anwendung zum Broker. Es entsteht keine Access-Proxy-Sperre vor der gesamten Webseite oder API.
- Login beginnt nur nach einem Nutzerklick. Gast- und Sim-Start benötigen weder Authentifizierung noch funktionierenden Storage oder Netzwerkzugriff. Kein Cloudflare One Client und kein WARP erforderlich.
- Access authentifiziert. Voltonaut besitzt weiterhin die stabile `users.id`, opake Bearer-Sessions und verbindliche Fahrten, Inventar, Progression und Volts.
- Die unproxied API `api.voltonaut.stammkneipe.dev` und TLS über den vorhandenen Traefik bleiben unverändert. Andere Anwendungen, insbesondere Financensor, erhalten keine SSO-Änderungen.

### Identität und Kontoverknüpfung

- `auth_identities(user_id, issuer, subject)` ordnet eine Broker-Identität einem lokalen Account zu. `UNIQUE(issuer, subject)` verhindert die Zuordnung zu zwei Accounts. `user_id` referenziert `users.id`.
- E-Mail ist ein Kontaktattribut, kein Account-Schlüssel. Gleiche E-Mail verknüpft niemals automatisch Accounts. Eine Kollision mit einem bestehenden Account verlangt dessen Besitznachweis, statt einen zweiten Besitzer anzulegen oder eine Identität still auszutauschen.
- Eine zusätzliche Identität wird nur aus einem angemeldeten Account verknüpft. Beide Logins müssen nachgewiesen werden, einschließlich frischer Reauthentifizierung. Die letzte Login-Methode darf nicht entfernt werden.
- Cloudflares E-Mail-bezogene Access-Identifikation ist keine allgemeine Kontoverknüpfung über verschiedene E-Mail-Adressen. Die Quelle zu Access-Application-Tokens beschreibt nicht automatisch die `sub`-Semantik jedes OIDC-SaaS-Tokens.
- Der Pilot prüft `issuer` und `sub` bei Wiederanmeldung und erlaubtem IdP-Wechsel. Entfernen eines Access-Nutzers oder Neuerstellen von Organisation beziehungsweise App kann Identitäten verändern. Eine Migration verlangt Besitznachweise, niemals Neuzuordnung anhand der E-Mail.

### Servergesteuerter Login

- Authorization Code Flow mit PKCE `S256`, `state`, `nonce` und exakt registrierten Redirect-URIs. Keine Wildcards für Produktions-, Preview- oder lokale Callbacks.
- Eine gepflegte OIDC-Clientbibliothek übernimmt Protokoll- und JWT-Prüfung. Keine selbst geschriebene JWT-Validierung. Bibliothekswahl und Eintrag in `docs/dependencies.md` folgen vor einer Installation; diese Dokumentationsänderung installiert keine Abhängigkeit.
- Der Server besitzt kurzlebige, einmalig verwendbare Login-Transaktionen mit `state`, `nonce`, PKCE-Verifier und Browserbindung. Die Bindung kann über ein geschütztes Transaktionscookie erfolgen, unabhängig von der Bearer-Anwendungssession.
- Der Callback prüft erwarteten Issuer, Audience, Signatur, Ablauf, `state`, `nonce` und Code-Bindung über die Bibliothek gegen die serverseitige Transaktion. Fehler erzeugen keine Session.
- Broker-Access- oder Refresh-Token und Client-Secret bleiben serverseitig. Weder diese Werte noch das Voltonaut-Bearer-Token gelangen in Redirect-URLs, Browserlogs oder Frontend-Bundles. Falls die SPA Bearer beibehält, erhält sie die Session über einen kurzlebigen, einmaligen und browsergebundenen Übergabecode. Endpunktnamen bleiben Implementierungsdetail.
- Logout und Widerruf betreffen ausdrücklich die Voltonaut-Session. Eine noch gültige Broker-Session kann eine spätere Anmeldung erleichtern. Eine Access-Policy-Änderung widerruft nicht automatisch lokale Anwendungssessions; Laufzeiten und Widerruf werden vor Produktion geprüft.

### Ablösung des Magic Links

Im Cloudflare-Authmodus startet der Server ohne Cloudflare-Email-Sending- oder Resend-Zugangsdaten. Die Produktions-Mailpflicht aus PR #6 muss dafür ausdrücklich angepasst und getestet werden. Bestehende Produktionsprüfungen dürfen nicht still abgeschwächt werden.

Magic Link ist bis zur Migration ein ausdrücklich gewählter Legacy- oder Entwicklungsmodus, kein zweiter Standard. Nach dem OIDC-Cutover wird dieser Login deaktiviert oder entfernt. Die frühere Mailanbieter-Recherche bleibt historisch erhalten; Transaktionsmails sind optional. Strava-OAuth und Upload-Berechtigungen bleiben vom Login getrennt. Broker-Token gewähren keinen Strava-API-Zugriff.

## Konsequenzen

- Kein eigener Mailversand als Voraussetzung für den Ziel-Login. Voltonaut muss trotzdem Account-Zuordnung, Sessions und sichere Kontoverknüpfung betreiben.
- Neue Logins hängen von Access und dem gewählten Identity Provider ab. Bei deren Ausfall bleibt anonymes Fahren möglich.
- Access verwendet Seats. Die Account-API bestätigt inzwischen `Teams Free Base`, aber keine Zahl verfügbarer Seats. Es wurde kein Tarif geändert. Vor einer breiteren Nutzung müssen verfügbare Seats und Kosten geprüft werden. Kein kostenpflichtiger Plan ohne gesonderte Freigabe.
- Die einmalige Aktivierung durch Henry ist erledigt. Die App nutzt ausschließlich den vorhandenen Identity Provider vom Typ `cloudflare`. Dessen tatsächliches Login-Verhalten ist noch im Pilot zu prüfen.
- Eingerichtet ist genau eine Voltonaut-OIDC-App mit verpflichtendem PKCE, Client-Secret und den Scopes `openid` und `email`. Die minimale Allow-Policy erlaubt nach ausdrücklicher Freigabe Henry und Florian. Keine `Everyone`-Policy und keine accountweite SSO-Umstellung.
- Die enge Freigabe für diese neuen OIDC-Credentials ist erfolgt. Client-Secret, Client-ID und Issuer liegen in GitHub `production`, nicht im Repository. Die allgemeine Deploy-Freigabe ersetzt keine gesonderte Erlaubnis für andere oder bestehende Secrets. Keine Tokens im Chat anfordern und keine bestehenden Secrets ohne Freigabe lesen oder überschreiben.
- Produktionspilot, Betriebsfreigabe und Rollback bleiben eigenständige Schritte der Spec. Eine konfigurierte App und erfolgreiche Discovery beweisen weder die OIDC-Laufzeitumsetzung noch einen laufenden Login oder produktiven Accountbetrieb.

## Alternativen

- Eigene Magic Links als Standard weiterbetreiben. Nicht gewählt, weil Henry Access will und eigener Login-Mailversand dann entfällt.
- Die gesamte Webseite oder API hinter einen Access-Proxy stellen. Verworfen, weil öffentliche Gast-, Offline- und Sim-Nutzung erhalten bleiben muss.
- Alle externen Logins anhand gleicher E-Mail zusammenführen. Verworfen wegen fehlender Besitznachweise und falscher Eigentumszuordnung.
- Passkeys direkt in Voltonaut als zweite Standardimplementierung bauen. Nicht Teil dieses Entscheids. Zunächst werden verfügbare Login-Methoden im Broker geprüft.

## Quellen

Offizielle Dokumentation, abgerufen am 20.11.2026:

- [Generische OIDC-SaaS-Anwendung](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/saas-apps/generic-oidc-saas/): Code Flow, PKCE, Discovery, Claims und getrennte Anwendungssessions.
- [Identity Provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/): verfügbare Login-Methoden. Der Account-Befund bestätigt bisher nur den Typ `cloudflare`.
- [Access-Application-Token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/): E-Mail-bezogene Access-Identität und mögliche `sub`-Änderung. Nicht mit dem OIDC-SaaS-ID-Token gleichsetzen.
- [Seat-Verwaltung](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/): Seat-Verbrauch und gesperrte weitere Logins bei ausgeschöpftem Kontingent.
