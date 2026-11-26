# Spec E5-13 – Strava-Freigabe bei der Kontolöschung widerrufen

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E5, Kontoexport und -löschung (Folge zu [E5-11](E5-11-account-data-export-deletion.md))
- **Issue:** #140
- **Status:** Implementiert und softwaregeprüft (Nest-Integration mit Fake-Provider, Unit). Merge, Bereitstellung und ein echter Strava-Widerruf offen.
- **Betroffene Module:** `packages/shared` (Löschantwort), `apps/server/src/{accounts,strava}`, `apps/web/src/sync`. Keine neue Abhängigkeit, keine neue Tabelle.

## Entscheidung (Auftraggeber, 26.11.2026)

Option 1 aus #140: **Widerruf vor der Löschung, ohne neue Tabelle.** Eine Warteschlange, die nach der Löschung noch Tokens hält (Option 2), ist nicht vorgesehen.

## Befund

- `StravaStore.deleteOwn` löschte Verbindung und Tokens ohne `provider.revoke`. Voltonaut blieb bei Strava mit `activity:write` autorisiert.
- Ein späterer Widerruf über den Pfad `revocation_pending` scheitert an den Lösch-Triggern auf `strava_connections`. Deshalb muss der Widerruf vor der Löschung laufen.

## Abnahmekriterien

- [x] AK1 – `DELETE /v1/me` prüft zuerst die Bestätigung. Eine falsche Bestätigung ergibt `403`, und Strava wird nicht berührt (keine Revoke-Anfrage, Verbindung bleibt).
- [x] AK2 – Mit Strava-Verbindung ruft der Server vor der Löschung den bestehenden Trennungsablauf (`StravaService.disconnect`) auf. Gelingt der Widerruf, antwortet er `200 { stravaRevocation: "revoked" }`, und die Verbindung ist entfernt.
- [x] AK3 – Scheitert der Widerruf (Anbieterfehler, Timeout von 2 s, unlesbare Tokens, Strava deaktiviert), wird das Konto trotzdem gelöscht, mit Antwort `failed`. Ohne Verbindung lautet sie `not_connected`.
- [x] AK4 – Die Oberfläche bestätigt einen gelungenen Widerruf. Bei `failed` bittet sie, Voltonaut in den Strava-Einstellungen unter „Meine Apps“ zu entfernen. Ohne Verbindung erwähnt sie Strava nicht.
- [x] AK5 – Nach der Löschung bleiben keine Tokens gespeichert.

## Testplan

| AK           | Ebene                            | Datei                                                                                                     |
| ------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| AK1–AK3, AK5 | Nest-Integration (Fake-Provider) | `apps/server/src/strava/strava.account-deletion.test.ts`, `apps/server/src/accounts/account-data.test.ts` |
| AK2          | Unit (Vertrag)                   | `apps/web/src/sync/privateAuthTransport.test.ts`                                                          |
| AK4          | Unit                             | `apps/web/src/sync/accountSyncDeletion.test.ts`                                                           |

## Grenzen

- Der Widerruf verlängert die Löschung um bis zu etwa 2 s (Timeout des Providers).
- Gegen den echten Strava-Dienst ist der Widerruf nicht geprüft (Strava-Pilot #82).
