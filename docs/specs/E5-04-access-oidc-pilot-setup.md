# Spec E5-04 – Cloudflare-OIDC-Pilot einrichten

- **Roadmap-Bezug:** E5, Einrichtung vor der Laufzeitumsetzung aus [E5-03](E5-03-cloudflare-access-oidc.md).
- **Status:** App, Policy, Credential-Hinterlegung und öffentliche Metadaten geprüft. Anwendungscode und echter Login bleiben offen.
- **Freigabe:** Henry hat am 20.11.2026 seine Pilotadresse sowie die isolierte App, Policy und Hinterlegung neuer Zugangsdaten freigegeben.
- **Betroffen:** Cloudflare Access und GitHub-Environment `production`. Keine Laufzeit- oder CI-Änderung.

## Ziel

Zwei ausdrücklich freigegebene Nutzer können später den OIDC-Login testen. Die öffentliche Gastfahrt bleibt ohne Access-Sperre erreichbar.

## Abnahmekriterien der Einrichtung

- [x] Genau eine neue SaaS-Anwendung `Voltonaut OIDC pilot` verwendet OIDC. Es wurde keine Self-hosted-Anwendung vor Webseite oder API eingerichtet.
- [x] Die wiederverwendbare Allow-Policy `Voltonaut pilot` enthält genau die beiden freigegebenen E-Mail-Adressen. Keine `Everyone`-, Bypass- oder Service-Token-Regel.
- [x] Die App referenziert diese Policy und nur den bereits vorhandenen IdP vom Typ `cloudflare`. Andere Anwendungen und IdPs bleiben unverändert.
- [x] Die App erlaubt ausschließlich `authorization_code_with_pkce`. Der Client-Secret-Nachweis bleibt erforderlich. Scopes sind `openid` und `email`.
- [x] Die Callback-Liste enthält nur die drei unten genannten URLs, ohne Wildcards oder Preview-Domains.
- [x] Das neue Client-Secret sowie Client-ID und Issuer liegen in GitHub `production`. Bestehende gleichnamige Einträge wurden vorab ausgeschlossen.
- [x] Discovery und JWKS antworten mit HTTP 200. Der zurückgegebene Issuer stimmt exakt mit dem konfigurierten Issuer überein. Discovery nennt Code Flow und RS256. JWKS enthält öffentliche Signaturschlüssel.
- [x] Die Account-API meldet `Teams Free Base`. Es wurde kein Tarif geändert oder gebucht. Die Zahl verfügbarer Seats ist damit noch nicht bestätigt.
- [ ] Echter Pilot bestätigt erlaubten und abgelehnten Login sowie stabile Identitätszuordnung. Dafür fehlen noch OIDC-Anwendungscode und ein freigegebener API-Betrieb.

## Konfiguration

Die App akzeptiert folgende Server-Callbacks:

- `http://localhost:3000/v1/auth/oidc/callback`
- `http://127.0.0.1:3000/v1/auth/oidc/callback`
- `https://api.voltonaut.stammkneipe.dev/v1/auth/oidc/callback`

Das Anlegen der URLs implementiert diese Endpunkte nicht. Der laufende lokale Server und der veröffentlichte Web-Stand enthalten noch keinen OIDC-Callback.

Der Broker-Access-Token ist auf 15 Minuten begrenzt. Die Pilot-Policy verwendet eine Stunde. Das sind keine Laufzeiten der späteren Voltonaut-Session. Diese bleibt eine eigene Entscheidung der Laufzeitumsetzung.

Die App ist im App Launcher ausgeblendet. Es sind weder Implicit- noch Hybrid- oder Refresh-Token-Flows aktiviert. Die tatsächliche PKCE-Verarbeitung prüft erst der spätere Login-Pilot.

Account-ID, Teamdomain, App-/Client-ID, Policy-ID, Pilotadresse und Secret-Werte werden nicht im Repository festgeschrieben. Die Laufzeitumsetzung übernimmt diese GitHub-Environment-Secrets über die freigegebene Serverkonfiguration:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`

Die Secret-Werte wurden nicht ausgegeben. Ein ausschließlich für die einmalige Übergabe erzeugtes privates Recovery-Artefakt wurde nach erfolgreicher Hinterlegung entfernt. Broker-Tokens oder Nutzerdaten wurden nicht angefordert.

## Nachweise und Grenzen

Die `cf`-CLI hat zuerst Apps, Policies, IdPs und Tarifmetadaten gelesen. Es gab vor der Einrichtung keine Access-App und keine wiederverwendbare Policy. Schreiboperationen betrafen nur die freigegebenen neuen Ressourcen.

Nach dem Anlegen antwortete Discovery zunächst mit HTTP 404. Dieselbe Client-ID-URL liefert später ohne Konfigurationsänderung HTTP 200. Die App wurde nicht gelöscht oder neu erstellt. Der abschließende Nur-Lese-Nachweis bestätigt App-Typ, Grants, Secret-Pflicht, Scopes, Callback-Liste und Policy-Referenz. GitHub bestätigt die drei Secret-Namen, ohne deren Werte zurückzugeben.

Henry hat anschließend Florian als zweiten Pilotnutzer freigegeben. Nur die bestehende Policy wurde um dessen genaue Adresse ergänzt und neutral umbenannt. App, Client-ID und Issuer bleiben unverändert. Der erneute Nur-Lese-Nachweis bestätigt genau zwei erlaubte Adressen und keine weiteren Selektoren.

Ein positiver Discovery-Nachweis beweist noch keinen Login. Die Laufzeitkriterien aus E5-03 bleiben offen, insbesondere Transaktionsbindung, Tokenprüfung, lokale Sessions, Account-Zuordnung, Logout und Ablösung der bisherigen Produktions-Mailpflicht. Auch IdP-Verhalten, Allow/Deny und Identitätsstabilität sind noch nicht im echten Pilot geprüft.

Die ursprüngliche Voraussetzung aus PR #6 ist inzwischen erfüllt: Die SQLite-/Account-/Session-Grundlage ist seit `191d4e8` auf `main`. Das ist keine OIDC-Implementierung.

## Rücknahme und Betrieb

Bei einem Konfigurationsfehler neue Logins an dieser App sperren und die Ursache prüfen. Die bestehende Organisation oder App nicht vorsorglich neu erstellen. Ihre Identitätszuordnung darf nicht still verändert werden. Gastfahren bleibt unabhängig erreichbar.

Ein lokaler Testprovider und ein eigener Laufzeit-PR müssen zuerst E5-03 erfüllen. Ein echter Produktionspilot braucht zusätzlich Backup-/Restore-Nachweis, sicheren API-Deploy und Henrys Betriebsfreigabe. Vor mehr Nutzern sind Seats und Konditionen erneut zu prüfen.

## Quellen

- [Cloudflare: Generische OIDC-Anwendung](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/saas-apps/generic-oidc-saas/), geprüft am 20.11.2026.
- Aktuelle API-Verträge aus `cf schema zero-trust access applications create` und `cf schema zero-trust access policies create` sowie dem Cloudflare-API-Katalog, geprüft am 20.11.2026.
- Accountbefund über `cf zero-trust access applications list`, `cf zero-trust access policies list`, `cf zero-trust identity-providers list` und `cf accounts subscriptions get`.

## Offene Fragen

- Laufzeitbibliothek, Login- und Übergabefristen?
- API-Backupziel und Restore-Nachweis?
- Allow/Deny und Identitätsstabilität im echten Pilot?
