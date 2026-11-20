# Spec E5-06 – Serverseitiger OIDC-Login

- **Bezug:** E5, [E5-03](E5-03-cloudflare-access-oidc.md), ADR-013.
- **Umfang:** `apps/server`, gemeinsame Auth-Verträge, neue additive Migration.
- **Status:** Lokal implementiert, vollständig geprüft und nach Korrektur unabhängig freigegeben. Integration auf aktuellem `main`, externe CI und Produktionslogin stehen aus.

## Ziel und Architektur

Ein ausdrücklich gestarteter OIDC-Login liefert eine eigene Voltonaut-Session ohne Mailzugang. Zwei Formen wurden geprüft:

1. Ein allgemeines Providerframework mit optionalen OIDC-/Mailfeldern und austauschbaren Sessiondiensten. Verworfen: mehrere Besitzer und ungültige Konfigurationskombinationen.
2. Eine diskriminierte `AuthConfig` (`disabled | magic-link | oidc`), der bestehende `AuthService` als einziger Sessionbesitzer und ein konkreter `OidcService` für Transaktionen und Identitäten. Gewählt.

`OidcService.start()` erzeugt Browserbindung und Logintransaktion. `callback()` beansprucht diese synchron atomar vor dem externen Code-Tausch. `claimed_at` markiert die Einmalverwendung; die Zeile bleibt während des Anbieteraufrufs als Kapazitätsreservierung erhalten. Die Bibliothek prüft Protokoll und Signatur. Der erfolgreiche Callback ersetzt die Reservierung in einer SQL-Transaktion durch die Übergabe. Ein fehlgeschlagener Callback entfernt seine Reservierung, ein Prozessabbruch lässt sie spätestens ablaufen. `exchange()` verbraucht eine Übergabe und erstellt die bestehende `SessionResponse` in einer synchronen SQL-Transaktion. Keine SQL-Transaktion enthält `await`. Auth besitzt alle neuen Tabellen; Datenbankmodul und Konfigurationsmodul bleiben Infrastruktur.

Die Grenze von 1000 zählt unbeanspruchte Transaktionen, laufende Callback-Reservierungen und Übergaben gemeinsam. Ein laufender Anbieteraufruf öffnet keinen freien Platz. `start()` bereinigt vorher höchstens 100 abgelaufene Zeilen je Tabelle. Diese Löschungen stehen außerhalb der anschließenden Aufnahmetransaktion und bleiben auch bei HTTP 429 bestehen. Damit können spätere Requests einen bereits überfüllten Altbestand schrittweise abbauen. Die Grenze wird weder erhöht noch durch unbegrenzte Bereinigung ersetzt.

## Öffentlicher Vertrag

- `GET /v1/auth/config` liefert ausschließlich `{mode: "disabled" | "oidc" | "magic-link"}`.
- `GET /v1/auth/oidc/start` setzt ein hostgebundenes HttpOnly-/SameSite=Lax-Cookie und leitet mit PKCE S256, State und Nonce zum fest konfigurierten Anbieter. Keine Eingabe für Issuer, Redirect oder `returnTo`.
- `GET /v1/auth/oidc/callback` leitet ausschließlich zu `CLIENT_ORIGIN/auth/finish?code=<opaque>` weiter. Der Code ist keine Bearer-Session.
- `POST /v1/auth/oidc/exchange`, Body `{code}`, benötigt das ursprüngliche Browsercookie und liefert `SessionResponse`. Web-Folgeeinheit verwendet `credentials: "include"`, entfernt den Code sofort aus der Adresszeile und lädt vor dem Austausch keine fremden Ressourcen.
- `GET /v1/me` liefert `{user}` für gültige Bearer-Sessions; Logout und gleitender Sessionablauf bleiben erhalten.
- Logintransaktion 5 Minuten, Übergabe 60 Sekunden, Anwendungssession weiterhin 30 Tage gleitend (konfigurierbar). Neue Starts ersetzen die Browserbindung; parallele Tabs müssen gegebenenfalls neu starten.
- Produktion verlangt explizites `AUTH_MODE`. OIDC und Disabled benötigen keinen Mailprovider und bieten keinen funktionierenden Legacy-Login. Legacy-Produktion benötigt echte Mailkonfiguration. Ohne expliziten Modus bleibt nur Entwicklung/Test beim bisherigen Magic Link.
- OIDC verwendet genau `CLIENT_ORIGIN` als CORS-Origin mit Credentials. Web und API müssen dieselbe Site verwenden; lokale Entwicklung verwendet auf beiden Seiten denselben Loopback-Host. Kein Cross-Site-Preview-Login.

## Abnahmekriterien

- [x] AK1 – Vollständiger lokaler Codeflow mit echtem HTTP, RS256-Signatur/JWKS und bestehender Sessionantwort.
- [x] AK2 – State, Cookie, Nonce, Code, PKCE, Issuer, Audience, Signatur und Ablauf werden abgewiesen, ebenso Wiederholung, konkurrierender Callback und fremder Browser. Fehler erzeugen keine Session.
- [x] AK3 – `(issuer, subject)` bleibt eindeutig und stabil bei E-Mail-Änderung. Gleiche E-Mail verknüpft niemals; bestehender lokaler Besitzer bleibt bei Kollision unverändert.
- [x] AK4 – Atomare Einmalverwendung vor Netzwerkzugriff, begrenzte Bereinigung, Rate-Limits, Timeout, sichere Cookies und feste Redirects sind geprüft.
- [x] AK5 – Modi, Produktionsstart ohne Mail, fehlende Konfiguration, exaktes CORS, Logout und Sessionablauf sind geprüft. Keine Tokens/Secrets in Redirects, Metadaten oder Fehlerantworten.
- [x] AK6 – Additive Migration erhält bestehende Accounts und Sessions. `CI=true mise run check`, Build, Diffprüfung, Paketnachweis und unabhängiges Nachreview sind grün.

## Testplan und Grenzen

Serverintegration mit zufälligen lokalen HTTP-Ports und SQLite; keine echten Cloudflare-Anfragen, Credentials, Hardware, E-Mail oder `vi.mock`. Gemeinsame Zod-Contracttests prüfen JSON-Grenzen. Die Bibliothek übernimmt JWT-/Nonce-/Protokollprüfung; Testprovider signiert echte negative Tokenfälle.

Nicht enthalten: Weboberfläche, Profile, Uploads, Strava, Verknüpfen/Entfernen weiterer Identitäten, Produktionsbetrieb oder Anbieterpilot. **E5-03 AK5 bleibt offen.** Der echte Pilot muss Allow/Deny, Subjectstabilität, Seats und Betrieb separat bestätigen. An echter Hardware getestet: nein, nicht erforderlich.

## Lokaler Nachweis

Der ursprüngliche Stand bestand `CI=true mise run check` mit 356 Tests und elf E2Es. Das unabhängige Review fand danach einen P2-Kapazitätsfehler. Dessen Korrektur besteht beim Parent das vollständige Gate mit 359 Tests und elf E2Es. Eine zusätzliche Cookie-Regression erhöht den abschließenden Stand auf 360 Tests und elf E2Es. Build, kompilierter Prozessnachweis und Diff-Prüfung sind ebenfalls grün. Das unabhängige Nachreview ist Approve.

### Regression für Kapazität und Wiederherstellung

`apps/server/src/auth/oidc-capacity.test.ts` reproduzierte vor der Laufzeitänderung zwei Fehler:

- Zwei reale HTTP-Callbacks warteten beim lokalen Anbieter. Zusammen mit 998 weiteren Transaktionen hätten 1000 Plätze belegt bleiben müssen. Tatsächlich blieben nur 998 gezählte Zeilen, weil der Callback seine Transaktion vor `await` löschte.
- Bei 1000 abgelaufenen Transaktionen und 250 abgelaufenen Übergaben blieb ein neuer Start abgewiesen. Statt erwarteter 900 Transaktionen standen danach weiterhin 1000 in SQLite. Der Kapazitätsfehler rollte die begrenzte Bereinigung zurück.

Nach der Korrektur sind beide Tests grün. Eine dritte Regression prüft das Ablaufen einer noch laufenden Reservierung. Ihr später Callback erzeugt weder Übergabe noch Session. Der überschrittene Altbestand sinkt nach der ersten abgewiesenen Anfrage auf 900 Transaktionen und 150 Übergaben. Die nächste Anfrage wird mit 801 Transaktionen und 50 Übergaben wieder aufgenommen. Keine Anfrage löscht mehr als 100 abgelaufene Zeilen je Tabelle.

Der gemeinsame Lauf von Kapazitäts-, Protokoll-, Speicher- und Migrationstests besteht mit 32 Tests, darunter allen 18 bisherigen Protokollfällen. Der gesamte Unit- und Integrationslauf `mise run test` besteht mit 359 Tests und Coverage. Format, Lint, Typecheck, Dependency-Cruiser, Guard, Build, Diffprüfung, E2E und vollständiges Gate sind nach der Korrektur grün.

```sh
mise exec -- pnpm exec vitest run apps/server/src/auth/oidc-capacity.test.ts apps/server/src/auth/oidc.integration.test.ts apps/server/src/auth/oidc-storage.test.ts apps/server/src/database/database.test.ts
```

Der wiederholbare Artefaktnachweis startet den gebauten Serverprozess und einen echten lokalen RS256-Provider auf zufälligen Ports:

```sh
mise run build
mise exec -- node apps/server/scripts/verify-oidc-build.mjs
```

Geprüft sind Health, öffentliche Authfähigkeit, Anbieterweiterleitung, Codeflow, browsergebundene Übergabe, `GET /v1/me` und Logout. Das Skript setzt ausschließlich lokale Testkonfiguration und übernimmt keine Umgebungs-Credentials. Port 5173 bleibt unbenutzt.

### Produktionspaket

Der Parent erzeugt zusätzlich das echte Standalone-Paket mit `pnpm --filter @voltonaut/server deploy --prod <temporäres Ziel>`. Der bisherige Paket-Smoke scheitert daran zunächst am fehlenden Produktions-`AUTH_MODE`. Eine gesonderte Prozessprobe bestätigt die Konfigurationsursache: Dasselbe unveränderte Paket startet mit explizitem `disabled` ohne Mailzugang.

Der aktualisierte Smoke prüft diesen Produktionsmodus, Health, Authfähigkeit, Bearer-Guard, WAL, alle tatsächlich verpackten Migrationen und Tabellen sowie SIGTERM. Er liest erwartete Tabellen aus dem validierten letzten Paket-Snapshot statt eine veraltete Tabellenliste zu verdoppeln. Expliziter Legacy-Betrieb ohne Mailzugang und fehlender Produktionsmodus müssen weiterhin zeitnah scheitern. Der neue Smoke besteht auf demselben Paket und ist unabhängig geprüft. Kein Netzwerkaufruf geht an einen echten Anbieter.

### Vollständiger Cookie-Wert

Eine weitere eigene Regression zeigt, dass das Aufteilen an jedem `=` einen gültigen Bindungswert mit angehängtem `=extra` akzeptierte. Der Parser prüft jetzt den gesamten Wert nach dem Cookienamen. Der Test scheitert vor der Korrektur und besteht danach. Das unabhängige Nachreview bestätigt gültige sichere und lokale Cookies, zusätzliche fremde Cookies sowie Ablehnung fehlender, doppelter und verlängerter Werte. Die bisherigen Protokollfälle bleiben grün.

## Offene Nutzerfragen

Keine für diese lokale Servereinheit.
