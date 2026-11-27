# Spec E5-03 – Login über Cloudflare Access OIDC

- **Roadmap-Bezug:** `docs/07-roadmap.md`, E5, Auth über Cloudflare Access OIDC.
- **Status:** Laufzeitentwurf. Zielentscheidung angenommen, Access-App und Pilot-Policy eingerichtet. Laufzeitumsetzung und echter Pilot offen. Einrichtungsnachweis: [E5-04](E5-04-access-oidc-pilot-setup.md).
- **Betroffene Module:** geplant `apps/server/src/auth`, `database`, `apps/web/src/ui`, `sync`, API-Schemas in `packages/shared`.
- **Entscheidung:** [ADR-013](../decisions/ADR-013-cloudflare-access-oidc.md).

## Ziel

Henry meldet sich ausdrücklich über Cloudflare Access an und erhält eine lokale Voltonaut-Session. Fahrten, Inventar und Progression bleiben unabhängig von der Login-Methode demselben Voltonaut-Account zugeordnet. Anonymes Solo-, Offline-, Sim- und BLE-Fahren bleibt unverändert möglich.

## Planungsstand und Abhängigkeiten

Diese Spec dokumentiert den Plan, nicht einen ausgelieferten Login. Alle folgenden Abnahmekriterien betreffen die spätere Laufzeitumsetzung und bleiben offen.

- Auth-Grundlage aus PR #6 ist seit `191d4e8` auf `main` und für die Umsetzung verfügbar.
- Der Aktivierungsblocker ist seit Henrys Aktivierung am 20.11.2026 gelöst. Der damalige Ausgangsbefund bestätigt eine Organisation, einen IdP vom Typ `cloudflare` und keine Apps. Nach separater Freigabe sind App, Pilot-Policy und Credential-Hinterlegung inzwischen eingerichtet. E5-04 dokumentiert den aktuellen Befund einschließlich `Teams Free Base`. Seats und echter Login sind noch nicht bestätigt. Keine Google- oder Microsoft-Konfiguration nachgewiesen.
- Keine Konfiguration, API-Schreiboperation, Buchung, neue Abhängigkeit oder Secret-Änderung gehört zur Dokumentationsaufgabe.
- Die versehentlich als fertig markierten E0-opt-Punkte VPS-Deploy und Observability bleiben offen. `SERVER_DEPLOY_ENABLED=false`; Observability ist noch nicht verdrahtet.

## Abnahmekriterien

- [ ] AK1 – Gast-, Sim-, Offline- und bestehende BLE-Fahrt starten ohne Authentifizierung, auch bei blockiertem Storage und Netzwerk. Erst ein Login-Klick startet OIDC.
- [ ] AK2 – Serverseitiger Authorization Code Flow nutzt eine gepflegte OIDC-Bibliothek, PKCE `S256`, `state`, `nonce` und exakte Redirects. Login-Transaktionen sind kurzlebig, einmalig und browsergebunden.
- [ ] AK3 – Callback weist falschen Issuer, Audience, Signatur, Ablauf, `state`, `nonce`, Code oder PKCE-Bindung ab. Replay, fremder Browser und abgelaufene Transaktion erzeugen keine Session. Keine offenen Redirects.
- [ ] AK4 – Wiederholter Login derselben Kombination `(issuer, subject)` liefert dieselbe `users.id`. `auth_identities` erzwingt eindeutige Zuordnung. E-Mail-Änderung und E-Mail-Kollision bewirken weder automatisches Verknüpfen noch stillen Besitzerwechsel oder einen Ersatzaccount für bestehende Daten.
- [ ] AK5 – Zusätzliches Login lässt sich nur angemeldet mit frischer Reauthentifizierung und Nachweis beider Identitäten verknüpfen. Konkurrenzzugriffe können eine Identität nicht zwei Accounts zuordnen. Entfernen der letzten Login-Methode wird abgelehnt.
- [ ] AK6 – Voltonaut erstellt und widerruft eigene opake Bearer-Sessions. Die SPA nutzt eine einmalige, kurzlebige, browsergebundene Übergabe. Bearer-, Access-, Refresh-Token und Client-Secret fehlen in Redirect-URLs, Browserlogs und Frontend-Bundles. Server- und Proxylogs enthalten keine Login-Geheimnisse oder vollständigen Callback-Parameter.
- [ ] AK7 – Cloudflare-Authmodus startet in Produktion ohne Mailanbieter-Zugangsdaten. Fehlende OIDC-Pflichtkonfiguration verhindert ausschließlich den entsprechend konfigurierten Serverbetrieb sicher und verständlich. Legacy-Magic-Link wird nach dem Cutover ausdrücklich deaktiviert oder entfernt, ohne stillen Rückfall auf einen zweiten Login-Standard.
- [ ] AK8 – Rate-Limits, exaktes CORS, Session-Ablauf, Logout und Widerruf sind geprüft. Anwendungssession und Broker-Session bleiben getrennt. Ein Access-Ausfall blockiert keine anonyme Fahrt.
- [ ] AK9 – Henry-Pilot bestätigt Discovery, `issuer` und `sub`, Wiederanmeldung und gegebenenfalls den erlaubten IdP-Wechsel. Ein nicht erlaubter Nutzer erhält keine lokale Session. Plan, Seats und Kosten sind vor Erweiterung dokumentiert.
- [ ] AK10 – Produktionsfreigabe und Rollback sind geprüft. `mise run check` ist grün; zweiter Agent reviewt gegen Spec und Review-Checkliste. Strava-Berechtigungen bleiben ein separater OAuth-Vorgang.

## Testplan (`docs/10-testing.md`)

Die Tabelle nennt die ursprünglich geplanten Testorte. Durchgestrichene Dateien sind nie entstanden; ihre Fälle liegen in den daneben genannten vorhandenen Tests. Ein lokaler OIDC-Testprovider wird über DI eingebunden, ohne `vi.mock` und ohne Live-Secrets. Er liefert echte signierte Testtoken zur Prüfung durch die gewählte Bibliothek.

| AK       | Ebene              | Geplanter Nachweis                                                                                                                                                                                                                                              |
| -------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AK1, AK8 | E2E                | ~~`apps/web/e2e/auth-guest.spec.ts`~~ (umgesetzt in `apps/web/verification/oidc.browser.spec.ts`): Sim-Fahrt ohne Login bei ausgefallenem Backend, gesperrtem Storage und Netzwerk; kein automatischer Login-Redirect                                           |
| AK2, AK3 | Serverintegration  | `apps/server/src/auth/oidc.integration.test.ts`: positiver Code Flow, PKCE, negative Tokenfälle, Replay, falscher Browser, Ablauf und Redirect-Allowlist                                                                                                        |
| AK4, AK5 | SQLite-Integration | ~~`apps/server/src/auth/identities.integration.test.ts`~~ (umgesetzt in `apps/server/src/auth/oidc-storage.test.ts`, `oidc-link.test.ts`): stabile Account-ID, Kollision, explizites Verknüpfen, Parallelität und letzte Login-Methode                          |
| AK6, AK8 | Contract und E2E   | API-Schemas in `packages/shared`, ~~`apps/web/e2e/auth-login.spec.ts`~~ (umgesetzt in `apps/web/verification/oidc.browser.spec.ts`): Übergabe nur einmal und im gebundenen Browser, Session-Ablauf, Logout, CORS und Rate-Limits; URL-, Log- und Bundle-Prüfung |
| AK7      | Serverintegration  | ~~`apps/server/src/auth/auth-config.test.ts`~~ (umgesetzt in `apps/server/src/auth/auth-modes.test.ts`): Produktionsstart mit gültigem OIDC ohne Mailzugang, ungültige OIDC-Konfiguration, Legacy deaktiviert                                                   |
| AK9      | Manueller Pilot    | Henrys ausdrücklicher Login nach separater Einrichtungsfreigabe; nur redigierte Ergebnisse zu Issuer-/Subject-Stabilität, Allow/Deny, Seats und Plan festhalten                                                                                                 |
| AK10     | Gate und Betrieb   | `mise run check`, Review, freigegebener Pilot auf `api.voltonaut.stammkneipe.dev`, Widerruf und Rollback-Probe ohne Datenverlust                                                                                                                                |

## Einrichtungsplan und manuelle Voraussetzungen

1. Nach Henrys bereits erfolgter Aktivierung den konkreten Free-Plan, Bedingungen und Seat-Verfügbarkeit mit ihm bestätigen. Kein kostenpflichtiger Tarif ohne separate Freigabe. Konkrete Preise und Kontingente sind nicht bestätigt.
2. Den Nur-Lese-Befund für Organisation, einen `cloudflare`-IdP und keine Apps als Ausgangspunkt verwenden. Verfügbare Pilot-Login-Methode mit Henry festlegen. Keine bestehende Organisation oder App vorsorglich neu erstellen. Teamdomain, Account-ID und IdP-ID nur über Umgebungskonfiguration einbinden, nicht im Repo festschreiben.
3. Henry den konkreten Plan für genau eine Voltonaut-OIDC-SaaS-App zeigen. PKCE aktivieren, exakte Server-Callbacks vorschlagen, Scopes auf `openid`, `email` und erforderlichenfalls `profile` begrenzen. Zunächst nur Henry in einer minimalen Allow-Policy zulassen. Keine `Everyone`-Policy oder accountweite Umstellung.
4. Vor OIDC-Secret-Verwaltung eine ausdrückliche, enge Freigabe einholen oder Henry die sichere Einrichtung selbst ausführen lassen. Die Deploy-Secret-Freigabe reicht dafür nicht. Keine Tokens im Chat, keine Secret-Ausgabe und kein Zugriff auf bestehende Secrets ohne eigene Freigabe.
5. Bibliothek auswählen und Abhängigkeitsregister ergänzen, dann Auth-Grundlage migrieren. Die Produktions-Mailpflicht aus PR #6 für den OIDC-Modus ausdrücklich ersetzen und mit AK7 absichern. Bestehende Daten behalten ihre `users.id`; E-Mail-basierte Migration bleibt verboten.

## Produktionspilot und Betriebsfreigabe

Zuerst lokal mit Testprovider prüfen. Einen echten Pilot erst nach separater Freigabe der Einrichtung und des produktiven Deploys starten. E0-opt-Deploy ist Voraussetzung; eine gesetzte Domain beweist keinen laufenden Server.

Vor dem Pilot müssen SQLite-Backup und Wiederherstellung, exakte Callback-Liste, Konfigurationsprüfung, Session-Laufzeiten und Widerruf feststehen. Staging und lokale Callbacks bekommen eigene, explizit geprüfte Einträge. Keine beliebigen Pages-Preview-URLs zulassen. TLS und der unproxied API-DNS bleiben unverändert.

Der Pilot umfasst erfolgreichen Henry-Login, Ablehnung eines nicht erlaubten Nutzers, Wiederanmeldung, Logout und Session-Widerruf. Identitätsstabilität bei zugelassenem IdP-Wechsel wird geprüft, bevor weitere Login-Methoden freigegeben werden. Ein nötiger frischer Besitznachweis muss tatsächlich vom Broker unterstützt werden; andernfalls bleibt Kontoverknüpfung gesperrt.

Zur Betriebsfreigabe gehören redigierte Nachweise, sichere Fehlerlogs und aggregierte Erfolgs-/Fehlerzähler ohne Token, E-Mail oder Subject als Metriklabel. Henry prüft Plan und Seats vor jeder Erweiterung des Nutzerkreises und genehmigt die breitere Policy erst nach Vorlage des Plans.

## Rollback

Bei falscher Account-Zuordnung, Geheimnisoffenlegung oder fehlerhafter Callback-Prüfung neue Logins stoppen und betroffene Voltonaut-Sessions widerrufen. Den letzten freigegebenen Anwendungsstand nur mit kompatiblem Datenbankschema zurückspielen. Keine Accounts, Identitätszuordnungen oder Spieldaten löschen. Migrations- und Wiederherstellungsweg vorher testen.

Gast- und Sim-Modus bleiben verfügbar. Kein automatischer Rückfall auf Magic Link. Eine erneute Legacy-Freigabe wäre eine ausdrückliche Betriebsentscheidung. Organisation oder OIDC-App nicht löschen und neu erstellen, weil sich Issuer oder Subject ändern können. Einen bereits erteilten Strava-Uploadzugriff behandelt dessen eigener Widerrufsweg.

## Nicht-Ziele

- Access als Proxy vor Webseite, API oder Financensor; Cloudflare One Client oder WARP.
- OIDC-Konfiguration, Billing, CLI-Installation oder Credentials in dieser Dokumentationsänderung.
- Eigene JWT- oder OIDC-Protokollimplementierung, automatische E-Mail-Verknüpfung oder Account-Zusammenlegung.
- Strava-Login oder Strava-Uploadrechte aus Broker-Token ableiten.
- Fahrten-Sync, Ökonomie oder Observability als bereits implementiert markieren.

## Offene Fragen und Risiken

- Welche Pilot-Login-Methode wird verwendet? Bisher ist nur ein `cloudflare`-IdP nachgewiesen. Welche frische Reauthentifizierung unterstützt er?
- Welche gepflegte OIDC-Bibliothek passt zu Node, Nest und den Repo-Leitplanken?
- Welche konkreten Fristen gelten für Login-Transaktion, Übergabe und Anwendungssession? Vor Umsetzung festlegen und auf Ablauf testen.
- Bleiben Issuer und Subject im realen Broker bei den erlaubten Login-Methoden stabil? Ohne Pilotnachweis keine breitere Freigabe.
- Welche Seats und Konditionen zeigt Henrys gewählter Plan? Die erfolgreiche Organisationsantwort enthält weder Plan noch Seats; Free-Auswahl vor dem Pilot bestätigen.

## Doku-Updates beim Laufzeitabschluss

- [ ] Roadmap-Authkriterium erst nach Laufzeitnachweisen abhaken.
- [ ] Backend, Auth-Betrieb und Migration auf den tatsächlich geprüften Stand aktualisieren.
- [ ] ADR-013 um Bibliothekswahl und Pilotergebnis ergänzen; neue Abhängigkeit registrieren.

## Prüfung der Planungsänderung

`CI=true mise run check` ist am 20.11.2026 mit 261 Tests und fünf E2Es grün. `git diff --check` ist grün. Das unabhängige Doku-Review hat keine Blocker gefunden. Diese Nachweise betreffen nur die Planungsänderung, nicht die offenen OIDC-Laufzeitkriterien.
