# Spec E5-08 – Browserkonto und OIDC-Session

- **Bezug:** E5, E5-03 und E5-06; lokale Aufnahme E10-01.
- **Status:** Vollständiges lokales Gate und unabhängiges Browser-/Grenzreview grün. Externe CI und Merge stehen aus.
- **Module:** Web `sync`, `ui`, Composition Root; Root-Verifikationsskript.

## Ziel und Architektur

Ausdrückliches Anmelden und Abmelden verwendet den vorhandenen Serverflow. Gast-, Sim-, Aufnahme- und Weltbetrieb benötigen weder Auth-Backend noch freigegebenen Browserspeicher.

Zwei Formen wurden verglichen:

1. Das Kontopanel besitzt Session, HTTP und Persistenz. Verworfen: künftiger Datensync müsste UI-State lesen; Token würden unnötig in die Darstellung gelangen.
2. `sync/applicationSession` besitzt einen diskriminierten Sessionzustand und private Zugangsdaten. Ein HTTP-Adapter validiert gemeinsame Schemas; optionale Persistenz speichert nur den Anwendungstoken unter einem eigenen API-gebundenen Schlüssel. Das Kontopanel liest ausschließlich validierte Nutzer und Status. Gewählt.

Der Composition Root verbindet diese Besitzer. Generation und Abbruch verhindern, dass alte Wiederherstellung oder Übergabe nach Abmeldung wieder anmeldet. Ohne gespeicherten Token und ohne Übergabe erfolgt kein Auth-Request. Die Profilgrenze fällt bei verweigertem Speicher auf das Standardprofil zurück; Speichern meldet Fehler statt Erfolg zu erfinden.

## Abnahmekriterien

- [x] AK1 – Deutsches Kontopanel, ausdrückliche Anmeldung/Abmeldung; deaktivierter, alter oder unerreichbarer Server verständlich, Gast bleibt nutzbar.
- [x] AK2 – Validierte Build-Origin; lokal gleicher Host, Produktion kanonische Web-/API-Site. Pages-Previews verlinken auf die kanonische Anmeldung. Keine Query-konfigurierten Redirects.
- [x] AK3 – Genau ein gültiger Übergabecode; sofortige URL-Bereinigung vor asynchroner Arbeit, Referrer-Schutz, Cookie-Tausch mit Credentials und gemeinsamen Schemas. Kein Token in DOM, URL oder Logs.
- [x] AK4 – Optionale Wiederherstellung prüft `/me` im Hintergrund. Speicherverweigerung erlaubt eine Session im Tab. Abmeldung räumt lokal auch bei Serverfehler auf und benennt unbestätigten Widerruf.
- [x] AK5 – Alte Antworten können eine abgemeldete Session nicht wiederbeleben. Nur der Sessionbesitzer hält Bearer-Zugangsdaten.
- [x] AK6 – Verweigerter Profil-/Aufnahmespeicher blockiert weder Worker noch Welt; Aufnahme und TCX bleiben im Tab möglich. Keine fremden Schlüssel oder gespeicherten Fahrten werden gelöscht.
- [x] AK7 – Navigation warnt bei aktiver oder ungesicherter abgeschlossener Aufnahme; Abbrechen erhält sie. Speichern oder Export erlaubt Navigation.
- [x] AK8 – Wiederholbarer echter Browserflow mit kompiliertem API-Prozess und lokal signierendem OIDC-Anbieter einschließlich Cookie, CORS, Übergabe, Wiederherstellung und echtem Logout.

## Testplan

`apps/web/src/sync/applicationSession.test.ts` und `authOrigin.test.ts` prüfen Origin-, Übergabe-, Persistenz- und Konkurrenzgrenzen ohne Modulmocking. `scripts/verify-browser-oidc.mjs` startet eigene Loopback-Ports, einen eigenen Vite-Cache und Chromium mit echter Uhr. Die Browserfälle liegen unter `apps/web/verification/oidc.browser.spec.ts`, getrennt von den regulären E2Es. Sie prüfen den realen Flow sowie Gastbetrieb bei blockiertem Speicher und ausgefallenem Backend. Bestehende Aufnahme-/Weltprüfungen bleiben unverändert. Default-Port 5173 und vollständiges Gate gehören dem Parent.

## Öffentliche Sessiongrenze für spätere Synchronisation

`view()` und `subscribe(listener)` liefern nur Status und schreibgeschützten, servervalidierten `User`. `login()`, `restore()`, `exchange(code)` und `logout()` sind explizite Befehle. Token bleiben im privaten Zustandsmodell; es gibt keinen automatischen Upload und keinen impliziten Besitzerwechsel lokaler Fahrten. Eine spätere autorisierte Datenfähigkeit muss im Sessionbesitzer ergänzt werden, nicht durch einen Token-Getter in der UI.

## Nicht-Ziele und Grenzen

Keine Server-/Schemaänderung, neue Abhängigkeit, Mail-UI, Popup, Outbox, Strava-Berechtigung, Cloudflare-Konfiguration oder Produktionspilot. Abmeldung widerruft nur Voltonaut, nicht die Anbietersession. Browserpersistenz ist optional und kein Schutz gegen gleichoriginiges XSS.

Auth-Requests haben acht Sekunden Timeout. Profilöffnung wartet höchstens eine Sekunde und schließt verspätet geöffnete Verbindungen. Bei fehlgeschlagener Öffnung bleibt das Standardprofil aktiv; Speichern meldet einen Fehler. Ein Abbruch der Übergabe verhindert eine spätere lokale Anmeldung. Falls der Server den Request schon akzeptiert hat, kann der Client ohne zurückerhaltenen Token dessen Widerruf nicht bestätigen.

## Offene Nutzerfragen

Keine für diese lokale Einheit. Produktivfreigabe und echter Anbieterpilot bleiben separat.

## Nachweise

Geprüft am 20.11.2026:

- `mise run fmt:check`, `lint`, `typecheck`, `depcruise`, `guard`, `test`, `build` und `git diff --check` grün.
- 414 Unit-/Integrationstests in 81 Dateien mit Coverage. Darunter 23 fokussierte Session-, Origin- und Übergabeprüfungen.
- `mise exec -- node scripts/verify-browser-oidc.mjs` grün. Vier Onlinefälle und ein Offlinefall mit echter Browseruhr. Der API-Prozess verwendet das gebaute `dist/main.js` und den vorhandenen lokalen RS256-/JWKS-Testanbieter. Kein Auth-Request wird durch Playwright beantwortet.
- Der Browser bestätigt Anmeldung, Persistenz mit anschließender `/me`-Prüfung nach Reload und echten Logout mit anschließendem HTTP 401 für denselben Token. Eine zuvor gespeicherte Aufnahme bleibt erhalten und erlaubt die Login-Navigation ohne Warnung.
- Bei verweigertem Zugriff auf die Globals `indexedDB` und `localStorage` funktionieren Welt, Worker, Profilfallback, Session im Tab und TCX. Nach echtem Prozessstopp des API-Servers bleibt die Sim-Fahrt bedienbar. Vor dem Login-Klick gibt es keinen Auth-Request.
- Native Navigationsdialoge werden bei laufender sowie bei abgeschlossener ungesicherter Aufnahme abgebrochen. Die Aufnahme bleibt erhalten. Export erlaubt anschließend Login ohne Warnung. Ein weiterer Login bestätigt die Navigation ausdrücklich.
- Ungültige und ungebundene Übergaben verschwinden aus der URL, melden den Fehler und lösen weder Wiederholung noch Login-Schleife aus. DOM, Browserlogs, Serverlogs und gebautes Webpaket werden auf die jeweiligen Geheimnisse geprüft.
- Artefakte des abschließenden Browserlaufs liegen unter `/var/folders/23/tg_nxvb56ybfx4bqy70w6rjm0000gn/T/opencode/browser-oidc-knTfVd/`: `proof.json`, `guest-world.png`, `signed-account.png`, `blocked-storage-sim.tcx` und `offline-sim.tcx`. Alle gestarteten Prozesse sind beendet.

Der Parent besteht anschließend das vollständige `CI=true mise run check` mit 414 Tests und 17 regulären E2Es sowie `mise run build`. Ein unabhängiger Prüfer besteht 42 gezielte Session-/Origin-/OIDC-Grenztests und wiederholt alle fünf Browserfälle gegen den gebauten Server und signierenden Testprovider. Das Review findet keine Korrektheits- oder Sicherheitsfehler. Seine Browserartefakte liegen unter `/var/folders/23/tg_nxvb56ybfx4bqy70w6rjm0000gn/T/opencode/browser-oidc-6pjzdK/`. Mutation ist für diesen Umfang nicht erforderlich. Keine Hardwareprüfung, kein Cloudflare-Pilot und kein produktives Deploy.

Nach zusätzlicher Integration der eigenen Profil-/Fahrtendpunkte aus E5-07 besteht das gemeinsame Gate mit 459 Tests und 17 E2Es. Build und alle fünf echten Browserfälle sind erneut grün. Dieser kombinierte Browsernachweis liegt unter `/var/folders/23/tg_nxvb56ybfx4bqy70w6rjm0000gn/T/opencode/browser-oidc-JcvtQ9/`. Die spätere Übernahme der Merge-Abstammung ändert den geprüften Anwendungscode nicht.
