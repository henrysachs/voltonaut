# Spec E5-12 – Kontoexport auch für große Konten

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E5, Kontoexport und -löschung (Folge zu [E5-11](E5-11-account-data-export-deletion.md))
- **Issue:** #141, Folge #157
- **Status:** Implementiert und softwaregeprüft (Unit, Nest-Integration). Merge und Bereitstellung offen.
- **Betroffene Module:** `apps/web/src/sync` (Routen-Timeout, 429-Meldung), `apps/server/src/accounts` (Rate-Limit, Großkonto-Test), `apps/server/src/app.setup.ts` (CORS `Retry-After`). Keine neue Abhängigkeit; `@nestjs/throttler` ist bereits registriert.

## Ziel

Große Kontoexports sollen vollständig heruntergeladen werden können, ohne dass ein allgemeines 8-s-Timeout den Abbruch auslöst. Ein eigenes Budget und ein Limit pro Konto schützen gleichzeitig den Server.

## Befund

- Jede API-Route nutzte ein festes Timeout von 8 s, gemessen von der Anfrage bis zum gelesenen JSON-Body.
- Gemessen am 26.11.2026 in der Entwicklungsumgebung: 50 einstündige Fahrten (je 3600 Proben, Aufnahmeformat V1) erzeugen einen Export von 14,5 MB, den der Server in 0,8 s baut.
- Für den damaligen Client-Abbruch war die Rechenzeit auf dem Server nicht der Engpass, sondern die Übertragung: Bei 10 Mbit/s dauern 14,5 MB rund 12 s, und der Client brach vorher ab.
- Auf dem Produktionsserver und mit V2-Aufnahmen samt TCX ist das nicht gemessen.

## Abnahmekriterien

- [x] AK1 – Eine Route kann ein eigenes Budget `timeoutMs` tragen. Ohne Angabe gelten 8 s. Nur `GET /v1/me/export` hat ein längeres Budget (120 s); alle anderen Routen behalten 8 s (Unit-Test über alle Routentabellen).
- [x] AK2 – Der Server erlaubt einen Export pro Konto und Minute. Ein zweiter Export innerhalb der Minute ergibt `429 rate_limited` mit `Retry-After`. Andere Konten sind nicht betroffen, ohne Sitzung bleibt es bei `401` (Integrationstest).
- [x] AK3 – Ein `429` beim Export zeigt eine eigene Meldung mit der Wartezeit aus `Retry-After`: „Datenexport ist nur einmal pro Minute möglich. Neuer Versuch in N s.“ Andere Fehler zeigen die allgemeine Meldung ohne Minuten-Hinweis (#157). Der Server gibt `Retry-After` per `Access-Control-Expose-Headers` für die Web-Origin frei; sonst könnte der Browser den Header nicht lesen.
- [x] AK4 – Bestehende Export- und Löschtests bleiben grün.
- [x] AK5 – 50 einstündige Fahrten (je 3600 Proben) werden vollständig und schema-gültig exportiert (`AccountExportSchema`, 14,5 MB; #157).

## Bekannte Grenzen

- Das Limit zählt die Anfrage, nicht den erfolgreichen Download. Bricht der Client einen Download ab oder läuft er ins Timeout, ist ein neuer Versuch erst nach einer Minute möglich.
- Die Messung (14,5 MB, 0,8 s) ist einmalig in der Entwicklungsumgebung erhoben worden, ohne eingechecktes Skript.
- **Blockade der Event-Loop (#157, gemessen 26.11.2026, Entwicklungsumgebung, 4 Kerne mit paralleler Stryker-Last):**
  - Ein Export von 50 einstündigen Fahrten blockiert die Event-Loop am Stück für 0,9–1,0 s (`monitorEventLoopDelay`, drei Läufe). In dieser Zeit beantwortet der Server keine andere Anfrage.
  - Aufschlüsselung: `rides.exportOwn` liest und prüft alle Fahrten in 400–480 ms. `AccountExportSchema.parse` prüft das Gesamtobjekt erneut in rund 300 ms. `JSON.stringify` braucht rund 50 ms.
  - Das Limit von einem Export pro Konto und Minute begrenzt die Wirkung pro Konto, nicht über viele Konten.
  - Mögliche Folge: nach der synchronen Lesetransaktion stückweise asynchron prüfen und zwischen den Fahrten die Event-Loop freigeben, oder den Export in einen Worker verlagern. Offen ist, ob die doppelte Gesamtprüfung bleiben soll. Beides ist eine Architekturentscheidung und hier nicht umgesetzt.

## Nicht-Ziele

Kein gestreamter oder seitenweiser Export in diesem Schritt. Für den Client-Abbruch ist er nicht nötig. Ob er oder eine stückweise Prüfung wegen der Event-Loop-Blockade (siehe „Bekannte Grenzen“) kommt, ist offen (#157).

## Testplan

| AK  | Ebene             | Datei                                                                                                                       |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| AK1 | Unit              | `apps/web/src/sync/requestTimeout.test.ts`                                                                                  |
| AK2 | Nest-Integration  | `apps/server/src/accounts/account-export.rate-limit.test.ts`                                                                |
| AK3 | Unit, Integration | `apps/web/src/sync/accountSyncDeletion.test.ts`, `apps/web/src/sync/retryAfter.test.ts`, `apps/server/src/app.cors.test.ts` |
| AK4 | Integration, E2E  | `apps/server/src/accounts/account-data.test.ts`, `apps/web/e2e/account-data.spec.ts`                                        |
| AK5 | Nest-Integration  | `apps/server/src/accounts/account-export.large.test.ts`                                                                     |

## Doku-Updates

- [x] `docs/08-backend.md` beschreibt das eigene Export-Budget und das Konto-Limit.
- [x] `docs/open-questions.md` verweist auf E5-12 statt auf das allgemeine 8-s-Timeout.
- [ ] Prod-Messung mit V2-Aufnahmen samt TCX bleibt als Folgeaufgabe offen.
- [ ] Entscheidung zur Event-Loop-Blockade großer Exporte (stückweise prüfen, Worker oder Streaming) offen (#157).
- Deploy-Reihenfolge: Erst der Server mit `Access-Control-Expose-Headers: Retry-After`, dann der Web-Client. Ohne lesbaren Header zeigt ein 429 die allgemeine Meldung; das gilt auch für ein 429 von Traefik.
