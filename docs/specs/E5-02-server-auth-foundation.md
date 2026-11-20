# Spec E5-02 – Datenbank und Auth-Grundlage

- **Roadmap-Bezug:** E5, Teilumfang Datenbank und Magic-Link-Authentifizierung. Keine vollständige E5-Abnahme.
- **Status:** Review
- **Betroffene Module:** `apps/server`, Auth-Verträge in `packages/shared`, Server-TS-Ausnahme im Guard (ADR-012).

## Ziel

Der Server bietet persistente Magic-Link-Sessions mit austauschbarem Mailversand. E3-Profil, Engine, Routen und Web-Client bleiben unverändert.

## Abnahmekriterien

- [x] AK1 – Eine SQLite-Verbindung mit WAL und Fremdschlüsseln. Drizzle migriert ausschließlich `users`, `login_tokens` und `sessions`. Nest schließt die Verbindung beim Herunterfahren.
- [x] AK2 – Magic-Link-Anfragen antworten für bekannte und unbekannte Adressen mit 204. Tokens bleiben gehasht, laufen nach 15 Minuten ab und sind genau einmal atomar einlösbar.
- [x] AK3 – Bearer-Guard, gleitende Sessions und Logout funktionieren. Fehler entsprechen dem geteilten Fehlervertrag. Zeit ist für Tests injizierbar.
- [x] AK4 – Ratenbegrenzung pro Adresse und IP sowie exakte CORS-Origins. Keine Mailbox-HTTP-Route und keine Token-Logs.
- [x] AK5 – MailSender ist über DI austauschbar. Entwicklung und Tests nutzen Speicher. Produktion verweigert fehlende echte Mailkonfiguration.
- [x] AK6 – `/healthz` bleibt öffentlich. Produktions-Build und `pnpm deploy --prod` enthalten Migrationen und starten aus dem Paketverzeichnis.
- [x] AK7 – Server-Code bleibt streng geprüft. Die genehmigte Bibliothekstyp-Ausnahme kann nicht auf andere Workspaces übergreifen.

## Testplan

SQLite-, Nest- und Supertest-Integrationstests prüfen AK1–AK4. Transporttests nutzen injiziertes Fetch ohne Netzwerk. Konfigurations- und Guard-Regressionstests prüfen AK5 und AK7. `mise run install`, `CI=true mise run check`, `mise run build` und ein produktiver Paket-Smoke-Test prüfen AK6.

## Nicht-Ziele

Accounts-, Profil-, DSGVO-, Fahrten- und Vergabe-Endpunkte, Outbox, Admin-CLI, UI und Deploy. Keine Änderungen an Engine, Rules oder E3-Verträgen. Keine Roadmap-Abschlusshäkchen.

## Offene Fragen und Risiken

Echter Mailversand, SPF, DKIM und DMARC bleiben manuell ungeprüft. Vollständiges E5 und die produktive Freigabe bleiben offen. Mailprovider-Transporttests beweisen keine Zustellung.

## Doku-Updates

Abhängigkeitsregister und ADR-012 sind aktualisiert. Roadmap-Checkboxen bleiben unverändert.

## Laufzeitkonfiguration

| Variable                                                    | Vorgabe und Bedeutung                                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `DATABASE_PATH`                                             | `data/voltonaut.db`, im Test `:memory:`. Fehlende Elternverzeichnisse werden angelegt.                          |
| `DRIZZLE_MIGRATIONS_DIR`                                    | `drizzle`. Auflösung aus dem Paketverzeichnis oder Repository-Root.                                             |
| `HOST`, `PORT`                                              | `127.0.0.1`, `3000`. Im Container setzt E0 `HOST=0.0.0.0`.                                                      |
| `MAIL_PROVIDER`                                             | Entwicklung und Test `memory`, Produktion `cloudflare`. Produktion verbietet `memory`.                          |
| `CLOUDFLARE_EMAIL_API_TOKEN`, `CLOUDFLARE_EMAIL_ACCOUNT_ID` | Beide für Cloudflare erforderlich.                                                                              |
| `RESEND_API_KEY`                                            | Für `MAIL_PROVIDER=resend` erforderlich.                                                                        |
| `MAIL_FROM`                                                 | `voltonaut@voltonaut.stammkneipe.dev`. Absenderdomain beim Provider verifizieren.                               |
| `CLIENT_ORIGIN`                                             | Entwicklung `http://localhost:5173`, Produktion `https://voltonaut.stammkneipe.dev`. Nur exakte HTTP(S)-Origin. |
| `CORS_ORIGINS`                                              | Kommagetrennte exakte Origins. Vorgabe localhost und produktive Web-Origin. Keine Wildcards.                    |
| `SESSION_TTL_DAYS`                                          | `30`, gleitend bei authentifizierten Requests.                                                                  |
| `THROTTLER_MAGIC_LINK_EMAIL_PER_HOUR`                       | `5`, nach Normalisierung der Adresse.                                                                           |
| `THROTTLER_MAGIC_LINK_IP_PER_HOUR`                          | `10`.                                                                                                           |
| `THROTTLER_SESSION_IP_PER_MIN`                              | `10`.                                                                                                           |

Der HTTP-Adapter vertraut genau einem Reverse-Proxy. Produktion darf den API-Port nicht zusätzlich direkt ins Internet veröffentlichen. E0 setzt Traefik ohne öffentlichen Host-Port ein.

## Verifikationsstand am 20.11.2026

- `mise run install` erfolgreich. Die Warnung über übersprungene `better-sqlite3`-Buildskripte ist unschädlich. Version 13.2.0 enthält native Plattform-Prebuilds.
- `CI=true mise run check` erfolgreich. 197 Tests in 44 Dateien und 3 Browser-E2E-Tests sind grün. Coverage-Schwellen bleiben unverändert erfüllt.
- Review-Korrektur: `Retry-After` übernimmt die Sekundenwerte aus `@nestjs/throttler` ohne erneute Umrechnung. Der HTTP-Regressionstest `apps/server/src/auth/rate-limit.test.ts` scheiterte zuvor mit 4 statt mindestens 3590 Sekunden für beide Magic-Link-Limits und 1 statt mindestens 55 Sekunden für Sessions. Nach der Korrektur sind beide Tests grün. Die Obergrenzen betragen 3600 und 60 Sekunden. Keine Sleeps oder Modul-Mocks.
- Nach der Review-Korrektur erfolgreich: `mise exec -- pnpm exec vitest run apps/server/src` mit 24 Tests, `mise run test` mit 197 Tests sowie `mise run lint`, `mise run typecheck`, `mise run guard`, `mise run depcruise` und `mise run build`. Der produktive Paket-Smoke-Test ist erneut erfolgreich. Das vollständige Gate wartet für diesen Stand noch auf die koordinierte Freigabe von Port 5173.
- Formatierung, Lint, Typecheck, Guard und dependency-cruiser einzeln erfolgreich. `mise run build` erfolgreich.
- `pnpm --filter @voltonaut/server deploy --prod <Ausgabeverzeichnis>` enthält SQL, Snapshot und Migrationsjournal. `mise exec -- node apps/server/scripts/verify-package.ts <Ausgabeverzeichnis>` prüft den Paketstart mit normalem CWD, Migrationen, WAL, öffentliches `/healthz`, Bearer-Guard, SIGTERM und fehlende Mailkonfiguration. Der Lauf ist erfolgreich und ruft keinen Mailprovider auf.
- Der zwischenzeitliche Konflikt auf Port 5173 ist behoben. Nach koordinierter Freigabe lief das vollständige Gate isoliert erfolgreich.
- Kein Deploy und kein echter Mailversand. Vollständiges E5, manuelle Mail-Abnahme und Review bleiben offen.
