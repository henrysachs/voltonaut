# ADR-015 – openid-client für den serverseitigen OIDC-Codeflow

**Status:** Gewählt für E5-06 am 20.11.2026 im freigegebenen OIDC-Auftrag.

## Entscheidung

`apps/server` verwendet `openid-client` exakt **6.9.0** (MIT). Die aktuelle npm-Registry und das gepflegte Primärrepository bestätigen diese Version. Das ESM-Paket passt zur gepinnten Node-24-Runtime und verwendet Web Crypto und Fetch. Es übernimmt Discovery, Codeflow, State, Nonce, PKCE und JWT-Claims. `enableNonRepudiationChecks` wird ausdrücklich aktiviert: Nur der Codeflow allein erzwingt in dieser Bibliothek keine Signaturprüfung des direkt erhaltenen ID-Tokens. Als ID-Token-Algorithmus wird RS256 festgelegt.

Die PKCE-Challenge wird unabhängig von `code_challenge_methods_supported` immer mit S256 gesendet. Die Pilot-Discovery enthält dieses optionale Feld nicht. Verifier und erwartete Nonce/State werden immer an `authorizationCodeGrant` übergeben.

HTTP wird ausschließlich in Entwicklung/Test für Loopback zugelassen; ein kontrollierter Fetch prüft auch entdeckte Netzwerkziele. Produktion bleibt HTTPS-only. Discovery ist lazy: Ein Anbieterausfall verhindert nicht Health oder Gastbetrieb. Fehlgeschlagene Discovery kann beim nächsten ausdrücklichen Start erneut versucht werden. Netzwerkaufrufe besitzen feste Timeouts.

## Alternativen und Folgen

- Eigene JWT-/OIDC-Prüfung ist verboten (ADR-013) und würde sicherheitskritische Protokollarbeit duplizieren.
- Direktes `oauth4webapi` ist tieferliegend und würde mehr Codeflow-Orchestrierung verlangen.
- Ein vollständiges Authframework würde Session- und Accountbesitz unnötig verlagern.

Neue transitive Laufzeitabhängigkeiten (`jose`, `oauth4webapi`) stehen im Lockfile. Der lokale Testprovider verwendet nur native Node-Kryptografie zum Signieren, nicht zum Prüfen von Anwendungstokens. Keine zusätzliche Testabhängigkeit.

## Quellen

Geprüft am 20.11.2026:

- [npm-Metadaten 6.9.0](https://registry.npmjs.org/openid-client/6.9.0)
- [Primärrepository und API](https://github.com/panva/openid-client)
- [Explizite Signaturprüfung](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md)
- [Codeflow-Prüfparameter](https://github.com/panva/openid-client/blob/main/docs/interfaces/AuthorizationCodeGrantChecks.md)
