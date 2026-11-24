# ADR-026 – Konfigurierbare OIDC-Provider, Cloudflare Access ist einer davon

**Status:** Vorgeschlagen. Freigabe durch Henry ausstehend (ADR-013 wird erweitert). Spec: [E5-11](../specs/E5-11-multiple-oidc-providers.md). Issue: #46. Kontoverknüpfung (Punkt 7) auf Henrys ausdrückliche Anforderung in #91 ergänzt.

## Kontext

[ADR-013](ADR-013-cloudflare-access-oidc.md) legt Cloudflare Access als **den** OIDC-Broker fest. Der Serverflow ([ADR-015](ADR-015-oidc-client-library.md), E5-06) ist providerneutral gebaut, kannte aber genau einen Satz `OIDC_*` mit Cloudflare-Annahmen (feste Scopes, RS256, E-Mail ohne Bestätigungsprüfung). Selbst gehostete Provider wie authentik sollen zusätzlich möglich sein. Konto, Sessions und Spieldaten bleiben bei Voltonaut (ADR-005, ADR-013).

## Entscheidung

1. **Provider-Liste statt Einzelwert.** `OIDC_PROVIDERS=cloudflare,authentik` nennt die Provider-IDs (`[a-z][a-z0-9-]{0,31}`). Jeder Eintrag liest `OIDC_<ID>_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI` und optional `_DISPLAY_NAME`, `_SCOPES` (Standard `openid email`), `_REQUIRE_EMAIL_VERIFIED` (Standard `true`), `_ID_TOKEN_ALG` (Standard `RS256`). Ein fehlerhafter oder fehlender Eintrag lässt den Start scheitern. Nicht gelistete IDs werden ignoriert. Der alte Einzelsatz entfällt ersatzlos, es gibt keine Weiterleitungsfassade.
2. **Routen mit Provider:** `GET /v1/auth/oidc/:provider/start` und `/callback`. Jeder Provider hat eine exakt registrierte Redirect-URI `…/v1/auth/oidc/<id>/callback`. `POST /v1/auth/oidc/exchange` bleibt providerlos, weil die Übergabe schon an Voltonaut-Nutzer und Browserbindung hängt.
3. **Transaktion trägt die Provider-ID** (`oidc_transactions.provider`, Migration 0008). Der Callback beansprucht nur eine Transaktion desselben Providers. Discovery und Client sind pro Provider getrennt und lazy; ein ausgefallener Provider betrifft weder Health noch andere Provider.
4. **Identität:** unverändert `(issuer, subject)`. Bestehende Cloudflare-Identitäten bleiben gültig, solange der Issuer gleich bleibt. Gleiches `sub` bei zwei Issuern sind zwei Identitäten.
5. **E-Mail-Regel:** Bei `requireEmailVerified` (Standard) und `email_verified !== true` legt eine **neue** Identität weder Konto noch Identität noch Session an (`email_not_verified`). Eine bereits bekannte oder ausdrücklich verknüpfte Identität meldet sich unabhängig davon an, weil die E-Mail dabei kein Konto auswählt oder anlegt. Weiterhin keine Verknüpfung über die E-Mail (`identity_conflict`). Beide Fehler führen per Redirect zu `CLIENT_ORIGIN/auth/finish?error=<code>`, damit die Weboberfläche sie verständlich zeigen kann.
6. **`GET /v1/auth/config`** liefert `{mode:"oidc", providers:[{id, displayName}]}` ohne Issuer oder Secrets.
7. **Mehrere Provider am selben Konto** (Umsetzung der Regeln aus ADR-013 zu zusätzlichen Identitäten):
   - Start nur angemeldet: `POST /v1/auth/oidc/:provider/link` mit Bearer-Sitzung und exakter `CLIENT_ORIGIN`. Die einmalige OIDC-Transaktion speichert Zielkonto (`link_user_id`) und den Hash der anfragenden Sitzung (`link_session_hash`) sowie die Browserbindung.
   - Der Callback prüft die frische Anmeldung wie beim Login (State, Nonce, PKCE, Issuer, Audience, Signatur, Provider-Route), verknüpft aber nichts. Er erzeugt einen einmaligen Link-Code (`oidc_handoffs` mit `link_issuer`, `link_subject`, `link_session_hash`, 60 s) und leitet zu `/auth/finish?link=<code>`.
   - Erst `POST /v1/auth/identities {code}` verknüpft: mit Bearer derselben Sitzung, demselben Browsercookie und exakter Origin. Logout, abgelaufene Sitzung oder Kontowechsel scheitern hier; der Code wird beim ersten Versuch verbraucht. Login-Codes und Link-Codes sind gegenseitig nicht einlösbar.
   - Eine Identität eines anderen Kontos wird nie übernommen (`identity_in_use`, 409), Konten werden nie zusammengeführt, es gibt kein E-Mail-Linking. Unterschiedliche Anbieter-E-Mails sind unerheblich; die Kontakt-E-Mail des Kontos bleibt unverändert.
   - `GET /v1/auth/identities` liefert die verbundenen Anmeldungen (`providerId`, `displayName`, ohne Subject). Trennen wird nicht angeboten, deshalb kann keine letzte Anmeldung verloren gehen.

## Folgen

- Deployment: `deploy/compose.yaml` reicht die Sätze `OIDC_CLOUDFLARE_*` und `OIDC_AUTHENTIK_*` durch. Weitere Provider brauchen dort einen Eintrag. Eine bestehende `/srv/voltonaut/deploy.env` mit dem alten Einzelsatz muss einmalig umgestellt werden (`provision_env.py migrate`, siehe `deploy/README.md`); bis dahin sperrt `deploy.sh` jeden Release. Weil der neue Server die alten Variablen und der alte Server die neuen nicht lesen kann, validiert `deploy.sh` die Konfiguration mit dem neuen Image (`node dist/main.js check-config`) vor dem Containerwechsel und startet bei Rückrollung oder Wiederherstellung den Ziel-Release mit seiner gespeicherten `compose.yaml`/`deploy.env` (`deploy.sh snapshot` sichert die laufende Alt-Konfiguration vor der Umstellung und lehnt ein Compose-/Env-Paar ab, das die `OIDC_*`-Einstellungen nicht an den Container durchreicht; ohne Snapshot des laufenden Releases wird nicht deployt). `deploy/provision_env.py` liest weiter die bisherigen Secret-Namen und schreibt das neue Format mit genau dem Provider `cloudflare`; der geschützte Workflow bleibt unverändert.
- Abwägung: `requireEmailVerified` ist pro Provider abschaltbar, Standard ist an. Abschalten ist nur für Provider vertretbar, deren Betreiber E-Mails selbst prüft.
- Offen (eigene Aufträge): Trennen einer verbundenen Anmeldung (dann mit Schutz der letzten Anmeldung), Gruppen/Rollen aus Claims, RP-Initiated Logout.
