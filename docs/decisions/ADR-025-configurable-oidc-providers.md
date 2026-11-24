# ADR-025 – Konfigurierbare OIDC-Provider, Cloudflare Access ist einer davon

**Status:** Vorgeschlagen. Freigabe durch Henry ausstehend (ADR-013 wird erweitert). Spec: [E5-11](../specs/E5-11-multiple-oidc-providers.md). Issue: #46.

## Kontext

[ADR-013](ADR-013-cloudflare-access-oidc.md) legt Cloudflare Access als **den** OIDC-Broker fest. Der Serverflow ([ADR-015](ADR-015-oidc-client-library.md), E5-06) ist providerneutral gebaut, kannte aber genau einen Satz `OIDC_*` mit Cloudflare-Annahmen (feste Scopes, RS256, E-Mail ohne Bestätigungsprüfung). Selbst gehostete Provider wie authentik sollen zusätzlich möglich sein. Konto, Sessions und Spieldaten bleiben bei Voltonaut (ADR-005, ADR-013).

## Entscheidung

1. **Provider-Liste statt Einzelwert.** `OIDC_PROVIDERS=cloudflare,authentik` nennt die Provider-IDs (`[a-z][a-z0-9-]{0,31}`). Jeder Eintrag liest `OIDC_<ID>_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI` und optional `_DISPLAY_NAME`, `_SCOPES` (Standard `openid email`), `_REQUIRE_EMAIL_VERIFIED` (Standard `true`), `_ID_TOKEN_ALG` (Standard `RS256`). Ein fehlerhafter oder fehlender Eintrag lässt den Start scheitern. Nicht gelistete IDs werden ignoriert. Der alte Einzelsatz entfällt ersatzlos, es gibt keine Weiterleitungsfassade.
2. **Routen mit Provider:** `GET /v1/auth/oidc/:provider/start` und `/callback`. Jeder Provider hat eine exakt registrierte Redirect-URI `…/v1/auth/oidc/<id>/callback`. `POST /v1/auth/oidc/exchange` bleibt providerlos, weil die Übergabe schon an Voltonaut-Nutzer und Browserbindung hängt.
3. **Transaktion trägt die Provider-ID** (`oidc_transactions.provider`, Migration 0008). Der Callback beansprucht nur eine Transaktion desselben Providers. Discovery und Client sind pro Provider getrennt und lazy; ein ausgefallener Provider betrifft weder Health noch andere Provider.
4. **Identität:** unverändert `(issuer, subject)`. Bestehende Cloudflare-Identitäten bleiben gültig, solange der Issuer gleich bleibt. Gleiches `sub` bei zwei Issuern sind zwei Identitäten.
5. **E-Mail-Regel:** Bei `requireEmailVerified` (Standard) und `email_verified !== true` entsteht weder Konto noch Identität noch Session (`email_not_verified`). Weiterhin keine Verknüpfung über die E-Mail (`identity_conflict`). Beide Fehler führen per Redirect zu `CLIENT_ORIGIN/auth/finish?error=<code>`, damit die Weboberfläche sie verständlich zeigen kann.
6. **`GET /v1/auth/config`** liefert `{mode:"oidc", providers:[{id, displayName}]}` ohne Issuer oder Secrets.

## Folgen

- Deployment: `deploy/compose.yaml` reicht die Sätze `OIDC_CLOUDFLARE_*` und `OIDC_AUTHENTIK_*` durch. Weitere Provider brauchen dort einen Eintrag. Eine bestehende `/srv/voltonaut/deploy.env` mit dem alten Einzelsatz muss einmalig umgestellt werden (Server startet sonst nicht, siehe `deploy/README.md`). `deploy/provision_env.py` und `.github/workflows/provision-server.yml` schreiben noch das alte Format und sind **nicht** angepasst (geschützte Dateien, Henrys Freigabe).
- Abwägung: `requireEmailVerified` ist pro Provider abschaltbar, Standard ist an. Abschalten ist nur für Provider vertretbar, deren Betreiber E-Mails selbst prüft.
- Offen (eigene Aufträge): Identitäten verknüpfen (Besitznachweis, ADR-013), Gruppen/Rollen aus Claims, RP-Initiated Logout.
