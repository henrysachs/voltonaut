# Spec E5-11 – Mehrere OIDC-Provider (authentik)

- **Bezug:** E5, Issue #46, [ADR-026](../decisions/ADR-026-configurable-oidc-providers.md), baut auf [E5-06](E5-06-oidc-server-login.md) und [E5-08](E5-08-browser-oidc-session.md) auf.
- **Umfang:** `apps/server` (Konfiguration, OIDC-Client/-Service/-Controller, Kontoverknüpfung, Migration 0008), `packages/shared` (Auth-Config, Identitäten, Fehlercodes), `apps/web` (Anbieterwahl, verbundene Anmeldungen, Fehlertexte), Deploy-Beispiele, Doku.
- **Status:** implementiert und softwaregeprüft (lokale Testprovider). Echter Login gegen authentik: **offen**. Bereitgestellt: **nein**.

## Vertrag

- `GET /v1/auth/config` → `{mode:"oidc", providers:[{id, displayName}]}`.
- `GET /v1/auth/oidc/:provider/start` und `/callback`, unbekannter Provider → 404. Der alte providerlose Pfad entfällt.
- Callback-Fehler `identity_conflict` und `email_not_verified` führen zu `CLIENT_ORIGIN/auth/finish?error=<code>`; andere Fehler bleiben JSON-Fehler (`invalid_oidc_login`).
- Kontoverknüpfung: `POST /v1/auth/oidc/:provider/link` (angemeldet) → `{location}` + Browsercookie; Callback → `/auth/finish?link=<code>`; `POST /v1/auth/identities {code}` (dieselbe Sitzung, dasselbe Cookie) → `{identities}`; `GET /v1/auth/identities` → `{identities:[{providerId, displayName}]}`. Fehler `identity_in_use` (409).
- Konfiguration siehe ADR-026 und `docs/08-backend.md`.

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

### Mehrere Provider am selben Konto (Anforderung Henry, #91)

- [x] Im angemeldeten Konto einen weiteren Provider ausdrücklich verbinden; Zielkonto und Sitzung sind serverseitig an die einmalige Transaktion und den Link-Code gebunden, frische geprüfte Anmeldung beim neuen Provider (`oidc-link.test.ts`).
- [x] Danach führen beide Identitäten zur gleichen `users.id`; Profil bleibt unverändert, kein zweites Konto, auch bei abweichender und unbestätigter Anbieter-E-Mail (`connects a second provider …`).
- [x] Kein E-Mail-Linking; fremd belegte Identität → `identity_in_use`, nichts übernommen oder zusammengeführt (`oidc-link-negative.test.ts`).
- [x] Logout, abgelaufene Sitzung und Kontowechsel übertragen keine Verknüpfung; wiederverwendeter Code, fremdes Browsercookie, falsche Provider-Route, Link-Code im Login und Login-Code im Link werden abgelehnt. Gegenproben: ohne Sitzungsbindung, ohne Fremd-Identitätsschutz bzw. ohne Trennung der Code-Arten jeweils rot.
- [x] Verbundene Anmeldungen im Kontomenü mit „Mit <Anbieter> verbinden“ für nicht verbundene Provider (`identityLinks.test.ts`, `identityLease.test.ts`, `authHandoff.test.ts`). Trennen wird nicht angeboten.
- [x] Reine Tab-Sitzung (#97): Ohne speicherbare Sitzung („Nur in diesem Tab“) startet keine Verknüpfung, weil die Vollnavigation zum Anbieter den einzigen Bearer verwerfen würde. Der Button ist gesperrt und erklärt das; Bearer wird weder neu persistiert noch weitergereicht. Browserregression `e2e/account-links.spec.ts` mit gesperrtem Speicher (kein Link-Request, weiter angemeldet) und positivem Kontrollfall (Rundweg, Sitzung wiederhergestellt, genau ein `POST /v1/auth/identities`, weiter angemeldet); auf dem vorherigen Stand ist der gesperrte Fall rot. Ein Popup-/Bridge-Ablauf, der auch Tab-Sitzungen verknüpfen kann, ist nicht umgesetzt.
- [ ] `mise run check` grün. Einzeln gelaufen und grün: Oxfmt-Check, Oxlint, `tsc -b`, depcruise, guard, Vitest mit Coverage (bis auf `stravaFinishPage.build.test.ts`, dort fehlt in der Agentenumgebung die passende Chromium-Version). Playwright-E2E und `verify-oidc-build.mjs` (Node 24) liefen hier nicht; der vollständige Lauf steht für CI/lokal aus.
- [ ] Echter Login gegen eine authentik-Instanz (Hardware-/Betriebsnachweis, offen).

## Nicht umgesetzt / Betrieb

- `deploy/provision_env.py` schreibt `OIDC_PROVIDERS=cloudflare` und `OIDC_CLOUDFLARE_*` aus den unveränderten Secrets `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`; der Workflow `provision-server.yml` bleibt unverändert.
- **Ausrollvoraussetzung (Review henrysachs):** Neuer Server und alter Einzelsatz sowie alter Server und neue Compose-Umgebung schließen sich gegenseitig aus. Absicherung in `deploy.sh`: (1) Sperre, solange `deploy.env` den alten Einzelsatz enthält oder `OIDC_PROVIDERS` fehlt; (2) Validierung mit dem neuen Image (`node dist/main.js check-config`, `check-config.test.ts`) in einem Einmal-Container vor dem Wechsel; (3) gespeicherte Konfiguration je gesundem Release (`state/config/<tag>/`, `600`), mit der Wiederherstellung und `rollback` den Ziel-Release starten; `deploy.sh snapshot` sichert vor der Umstellung die laufende Alt-Konfiguration und lehnt ein Paar aus Compose- und Env-Datei ab, das die `OIDC_*`-Einstellungen nicht an den Container durchreicht (Randfall „vorzeitiger Main-Deploy hat schon die neue Compose-Datei abgelegt“, Review henrysachs P2); `snapshot <compose-datei>` übernimmt dann die Compose-Datei des laufenden Releases. Ein Deploy ohne Snapshot des laufenden Releases bricht vor jedem Schritt ab. Das Testmodell prüft die von `docker compose config` gerenderte Container-Umgebung mit alter und neuer Compose-Datei; Gegenproben ohne Paarprüfung, ohne Snapshot-Pflicht und mit Snapshot aus neuer Compose plus alter Env sind rot. Belegt in `deploy/test-deploy.sh` (Szenario alter Release → Umstellung → abgelehnte/ungesunde/gesunde neue Version → Rückrollung in beide Richtungen; ohne Snapshots bzw. ohne Validierung jeweils rot). Umstellung über `provision_env.py migrate` (`MigrationTests`). Schritte und Rückweg in `deploy/README.md`. Kein echter Container- oder Produktionslauf: Umstellung, Callback-Registrierung `…/v1/auth/oidc/cloudflare/callback` und Login sind **offen**.
- Keine Browserprüfung mit echtem Provider; `e2e/account-links.spec.ts` ersetzt API und Anbieter durch einen lokalen Fake.
- Offene Fragen aus dem Issue (zusätzlich oder statt Cloudflare, authentik-URL, Gruppenpolicy) sind entschieden bzw. offen: zusätzlich zu Cloudflare, `requireEmailVerified` pro Provider (Standard an). Authentik-Instanz und Neukonten-Policy liegen bei Henry.
