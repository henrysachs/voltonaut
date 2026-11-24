# Spec E5-11 – Mehrere OIDC-Provider (authentik)

- **Bezug:** E5, Issue #46, [ADR-025](../decisions/ADR-025-configurable-oidc-providers.md), baut auf [E5-06](E5-06-oidc-server-login.md) und [E5-08](E5-08-browser-oidc-session.md) auf.
- **Umfang:** `apps/server` (Konfiguration, OIDC-Client/-Service/-Controller, Migration 0008), `packages/shared` (Auth-Config, Fehlercodes), `apps/web` (Anbieterwahl, Fehlertexte), Deploy-Beispiele, Doku.
- **Status:** implementiert und softwaregeprüft (lokale Testprovider). Echter Login gegen authentik: **offen**. Bereitgestellt: **nein**.

## Vertrag

- `GET /v1/auth/config` → `{mode:"oidc", providers:[{id, displayName}]}`.
- `GET /v1/auth/oidc/:provider/start` und `/callback`, unbekannter Provider → 404. Der alte providerlose Pfad entfällt.
- Callback-Fehler `identity_conflict` und `email_not_verified` führen zu `CLIENT_ORIGIN/auth/finish?error=<code>`; andere Fehler bleiben JSON-Fehler (`invalid_oidc_login`).
- Konfiguration siehe ADR-025 und `docs/08-backend.md`.

## Abnahmekriterien

- [x] Zwei Provider gleichzeitig; ungültiger Eintrag lässt den Start scheitern (`oidc-providers.test.ts`, Konfigurationsfälle).
- [x] Integrationstest mit zwei lokalen Testprovidern, einer mit authentik-Issuer `/application/o/<slug>/`.
- [x] Callback von Provider A mit Transaktion von Provider B wird abgelehnt, ohne Tokenaufruf.
- [x] `email_verified` `false` oder fehlend → keine Session, kein User, keine Identität, keine Übergabe.
- [x] Gleiches `sub` bei zwei Providern → zwei Identitäten und Konten.
- [x] Bestehende Identitäten (Issuer unverändert) melden sich am selben Konto an (bestehende OIDC-Tests mit Provider `test`; Migration erhält Zeilen, `owned-migrations.test.ts`).
- [x] Discovery-Ausfall eines Providers: Health grün, anderer Provider funktioniert.
- [x] Keine Secrets/Issuer in `/v1/auth/config`; Redirects tragen nur Code oder Fehlercode.
- [x] Web: Anbieterwahl bei mehreren Providern, direkter Start bei einem, Fehlertexte für beide Fehlercodes.
- [ ] `mise run check` grün. Einzeln gelaufen und grün: Oxfmt-Check, Oxlint, `tsc -b`, depcruise, guard, Vitest mit Coverage (bis auf `stravaFinishPage.build.test.ts`, dort fehlt in der Agentenumgebung die passende Chromium-Version). Playwright-E2E und `verify-oidc-build.mjs` (Node 24) liefen hier nicht; der vollständige Lauf steht für CI/lokal aus.
- [ ] Echter Login gegen eine authentik-Instanz (Hardware-/Betriebsnachweis, offen).

## Nicht umgesetzt / Betrieb

- `deploy/provision_env.py` schreibt `OIDC_PROVIDERS=cloudflare` und `OIDC_CLOUDFLARE_*` aus den unveränderten Secrets `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`; der Workflow `provision-server.yml` bleibt unverändert.
- **Ausrollvoraussetzung (Review henrysachs):** Eine vorhandene `/srv/voltonaut/deploy.env` im Altformat wird nicht überschrieben. `deploy.sh` sperrt deshalb jeden Release, solange die Datei den alten Einzelsatz enthält oder `OIDC_PROVIDERS` fehlt (`deploy/test-deploy.sh`, ohne Sperre rot). Umstellung über `provision_env.py migrate`: nur die exakte Alt-Datei, gleiche Werte, Backup `deploy.env.legacy` (`test_provision_env.py`, `MigrationTests`). Schritte und Rückweg in `deploy/README.md`. Die Callback-URI `…/v1/auth/oidc/cloudflare/callback` muss vorher in der Access-Anwendung registriert werden. Umstellung und Registrierung: **offen**, nicht in Produktion ausgeführt.
- Offene Fragen aus dem Issue (zusätzlich oder statt Cloudflare, authentik-URL, Gruppenpolicy) sind entschieden bzw. offen: zusätzlich zu Cloudflare, `requireEmailVerified` pro Provider (Standard an). Authentik-Instanz und Neukonten-Policy liegen bei Henry.
