# Spec E5-12 – Kontoexport auch für große Konten

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E5, Kontoexport und -löschung (Folge zu [E5-11](E5-11-account-data-export-deletion.md))
- **Issue:** #141
- **Status:** Implementiert und softwaregeprüft (Unit, Nest-Integration). Merge und Bereitstellung offen.
- **Betroffene Module:** `apps/web/src/sync` (Routen-Timeout), `apps/server/src/accounts` (Rate-Limit). Keine neue Abhängigkeit; `@nestjs/throttler` ist bereits registriert.

## Ziel

Große Kontoexports sollen vollständig heruntergeladen werden können, ohne dass ein allgemeines 8-s-Timeout den Abbruch auslöst. Ein eigenes Budget und ein Limit pro Konto schützen gleichzeitig den Server.

## Befund

- Jede API-Route nutzte ein festes Timeout von 8 s, gemessen von der Anfrage bis zum gelesenen JSON-Body.
- Gemessen am 26.11.2026 in der Entwicklungsumgebung: 50 einstündige Fahrten (je 3600 Proben, Aufnahmeformat V1) erzeugen einen Export von 14,5 MB, den der Server in 0,8 s baut.
- Die Rechenzeit auf dem Server ist also nicht der Engpass. Die Übertragung ist es: Bei 10 Mbit/s dauern 14,5 MB rund 12 s, und der Client brach vorher ab.
- Auf dem Produktionsserver und mit V2-Aufnahmen samt TCX ist das nicht gemessen.

## Abnahmekriterien

- [x] AK1 – Eine Route kann ein eigenes Budget `timeoutMs` tragen. Ohne Angabe gelten 8 s. Nur `GET /v1/me/export` hat ein längeres Budget (120 s); alle anderen Routen behalten 8 s (Unit-Test über alle Routentabellen).
- [x] AK2 – Der Server erlaubt einen Export pro Konto und Minute. Ein zweiter Export innerhalb der Minute ergibt `429 rate_limited` mit `Retry-After`. Andere Konten sind nicht betroffen, ohne Sitzung bleibt es bei `401` (Integrationstest).
- [x] AK3 – Die Fehlermeldung im Konto-Overlay nennt, dass nach einem gerade angeforderten Export ein neuer erst nach einer Minute möglich ist. Der Client unterscheidet 429 nicht von anderen Fehlern; die Meldung ist deshalb bedingt formuliert (Unit-Test in `accountSyncDeletion.test.ts`).
- [x] AK4 – Bestehende Export- und Löschtests bleiben grün.

## Bekannte Grenzen

- Das Limit zählt die Anfrage, nicht den erfolgreichen Download. Bricht der Client einen Download ab oder läuft er ins Timeout, ist ein neuer Versuch erst nach einer Minute möglich.
- Die Messung (14,5 MB, 0,8 s) ist einmalig in der Entwicklungsumgebung erhoben worden, ohne eingechecktes Skript.

## Nicht-Ziele

Kein gestreamter oder seitenweiser Export. Nach der Messung ist das nicht nötig; er bleibt eine Option, falls V2-Exporte deutlich größer werden.

## Testplan

| AK  | Ebene            | Datei                                                                                |
| --- | ---------------- | ------------------------------------------------------------------------------------ |
| AK1 | Unit             | `apps/web/src/sync/requestTimeout.test.ts`                                           |
| AK2 | Nest-Integration | `apps/server/src/accounts/account-export.rate-limit.test.ts`                         |
| AK3 | Unit             | `apps/web/src/sync/accountSyncDeletion.test.ts`                                      |
| AK4 | Integration, E2E | `apps/server/src/accounts/account-data.test.ts`, `apps/web/e2e/account-data.spec.ts` |

## Doku-Updates

- [x] `docs/08-backend.md` beschreibt das eigene Export-Budget und das Konto-Limit.
- [x] `docs/open-questions.md` verweist auf E5-12 statt auf das allgemeine 8-s-Timeout.
- [ ] Prod-Messung mit V2-Aufnahmen samt TCX bleibt als Folgeaufgabe offen.
