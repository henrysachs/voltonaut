# Spec E5-07 – Eigenes Profil und dauerhafte Fahrthistorie

- **Roadmap-Bezug:** E5, serverseitiges Profil und Fahrt-Upload. Keine abgeschlossene Anti-Cheat- oder Belohnungsfunktion.
- **Status:** Auth, aktuelle Welt und Aufnahme integriert. Gemeinsames lokales Gate, Paketprüfung und unabhängiges Integrationsreview grün. Externe CI und Merge stehen aus.
- **Betroffene Module:** `shared/api`, `server/accounts`, `server/rides`, Server-Composition-Root und Migrationen.

## Ziel

Angemeldete Nutzer speichern ihr eigenes Fahrerprofil und abgeschlossene lokale V1-Aufnahmen dauerhaft auf dem Server. Wiederholte Uploads liefern denselben gespeicherten Beleg. Die Aufnahmen bleiben ausdrücklich ungeprüft.

## Datenform und Modulgrenzen

`accounts` besitzt das Profil. `rides` besitzt unveränderliche Aufnahme, kanonischen Hash, ursprünglichen Beleg und aktuelle Bewertung. Eigentümer ist ausschließlich `SessionPrincipal.userId`. Authentifizierung und `GET /v1/me` bleiben im Auth-Modul.

Die Tabellenfabriken `createAccountsTables(userIdColumn: SQLiteColumn)` und `createRidesTables(userIdColumn: SQLiteColumn)` definieren echte Fremdschlüssel in ihren eigenen Modulen. `src/schema.ts` verbindet sie mit `auth/users.id` und exportiert konkrete Tabellen für Drizzle Kit. `AppModule` übergibt die Tabellen an die registrierten Module. Services injizieren ausschließlich eigene Tabellen und `DRIZZLE`. Alternative direkte Importe fremder Schema-Dateien verletzen die dokumentierte Tabellenverantwortung und werden nicht verwendet.

## API

- `GET /v1/me/profile` liefert `{status:'missing'}` oder `{status:'present',profile,updatedAt}`.
- `PUT /v1/me/profile` akzeptiert das bestehende Fahrerprofil mit striktem Profil- und Fahrradobjekt und liefert den vorhandenen Zustand.
- `POST /v1/rides` akzeptiert `RideUploadSchema` auf Basis von `CompletedLocalRideSchema` V1 und liefert HTTP 200 mit `{rideId,storage:'stored',assessment:{status:'unverified',reason:'legacy_missing_replay'}}`.
- `RideIdSchema` normalisiert UUIDs im Upload, Detailpfad und Cursor auf Kleinschreibung. Der Upload normalisiert vor Nutzlast-Serialisierung, Hash und Speicherung. Lokale V1-Dateien behalten ihr bisheriges Format und ihre UUID-Schreibweise. Auth-Identifikatoren bleiben unverändert.
- Gleicher Eigentümer, gleiche UUID und gleiche geparste Nutzlast liefern den ursprünglichen Beleg. Abweichende Nutzlast liefert 409 `ride_id_conflict`. Eine fremde UUID liefert auch beim Upload 404.
- `GET /v1/rides` liefert Zusammenfassungen ohne Samples, standardmäßig 20 und höchstens 50 Einträge mit begrenztem Cursor.
- `GET /v1/rides/:rideId` liefert die eigene Aufnahme und ihre aktuelle Bewertung. Fehlende und fremde Fahrten liefern dieselbe 404-Antwort.

## Abnahmekriterien

- [x] Zwei echte Testsessions besitzen unabhängige Profile und Fahrten. Ohne Session antworten alle Endpunkte mit 401.
- [x] Profilgrenzen, unbekannte Felder und ungültige Query- oder Pfadparameter werden mit 422 abgelehnt.
- [x] Globale UUID-Eindeutigkeit und Eigentümerprüfung liegen innerhalb einer atomaren SQLite-Transaktion. Gleichzeitige Wiederholungen erzeugen genau einen Datensatz.
- [x] UUID-Großschreibung erzeugt weder einen zweiten Datensatz noch einen anderen Beleg. Eigene Detail-Aliase funktionieren, fremde Aliase liefern 404. Cursor-Aliase liefern dieselbe Seite.
- [x] Umgeordnete JSON-Schlüssel ändern die geparste kanonische Nutzlast und den Beleg nicht. Abweichende Nutzlast wird abgelehnt.
- [x] Beleg, Profil und Aufnahme bleiben nach Datenbank-Neuöffnung erhalten.
- [x] Unkomprimiertes JSON wird vor dem Parsen auf 8 MiB begrenzt. Größere Bodies liefern 413 ohne Nutzlast im Fehler. Normale Stundenaufnahmen überschreiten nicht das Transportlimit.
- [x] Der Route-Guard prüft den Medientyp vor der Zod-Bodyvalidierung. Angemeldetes `text/plain` mit gültigem JSON liefert 415. `application/json; charset=utf-8` bleibt gültig. Ohne Session greift weiterhin zuerst der globale Auth-Guard.
- [x] Private Uploads besitzen ein Account-Rate-Limit nach dem vorhandenen Throttler-Muster.
- [x] Neue Migrationen funktionieren auf leerer Datenbank sowie nach `0000` und Auth-`0001`. Nutzer, Sessions, Identitäten, Übergaben und beanspruchte Logintransaktionen bleiben erhalten. Beide Eigentümer-Fremdschlüssel greifen.
- [x] Es gibt keine automatische Löschung, Belohnung oder behauptete Physikprüfung.

## Testplan

Reale Nest-Module, Supertest und SQLite prüfen Verträge, Isolation, Konflikte, parallele Wiederholungen, Pagination, Bodygrenzen und Neustartpersistenz. Migrationstests prüfen frische Datenbanken sowie vorhandene `0000`- und Auth-`0001`-Datenbanken mit echten Vorgängermigrationen und gespeicherten Authdaten. Keine Modul-Mocks und keine Hardware.

## Nicht-Ziele

Web-Integration, OIDC, `GET /v1/me`, Inventar, Progression, Avatar, Strava, gzip, Replay V2, Physikprüfung und Belohnungen. V1 enthält weder vollständigen Physik-Anfangszustand noch Ereignisse für eine belastbare Nachrechnung.

## Migration und Verifikation

`0002_owned_profiles_rides.sql` folgt auf die unveränderte Auth-Migration `0001_material_red_shift.sql`. Drizzle erzeugt SQL und Snapshot aus dem gemeinsamen Schema neu. Nur die zuvor nicht angewendete vorläufige Datenmigration wird ersetzt. `0000` und Auth-`0001` bleiben unverändert. Das erzeugte Daten-SQL entspricht dem bereits geprüften vorläufigen SQL. Alle bisherigen Auth-Tabellen bleiben im neuen Snapshot identisch. `db:generate` meldet danach keine Schemaänderung.

## Offene Fragen

Keine blockierenden Fragen.

## Lokale Ergebnisse

- `mise run fmt:check`, `lint`, `typecheck`, `depcruise`, `guard`, `test` und `build` sind nach der Korrektur grün. Vitest besteht mit Coverage, 78 Dateien und 391 Tests.
- `mise exec -- node apps/server/scripts/verify-owned-data.mjs` besteht nach dem Server-Build. Der Launcher kompiliert den TypeScript-Prüfeinstieg mit der vorhandenen Server-Vite-Konfiguration in ein temporäres Verzeichnis; öffentliche Workspace-Importe benötigen keine erzeugten Paket-Deklarationen. Der echte gebaute Server speichert Profil und Aufnahme. Nach SIGTERM startet ein neuer Prozess auf derselben SQLite-Datei. Der ursprüngliche Beleg, die Aufnahme und das Profil bleiben mit derselben Bearer-Session abrufbar. Das Skript nutzt ausschließlich lokale Zufallsports und eine synthetische Testsitzung.
- `mise exec -- pnpm --filter @voltonaut/server db:generate` meldet nach Erzeugung von `0002_owned_profiles_rides.sql` keine Schemaänderung. Beide Eigentümer-Fremdschlüssel stehen in SQL und TypeScript.
- `git diff --check` ist grün. Keine neue Abhängigkeit und keine Änderung an Leitplanken. Keine Hardwareprüfung.
- Das vollständige `CI=true mise run check` ist am korrigierten Einzelstand mit 391 Tests und 16 E2Es grün. Das unabhängige Korrekturreview ist Approve. Nach gemeinsamer Auth-Integration werden Migration, Paket-Smoke und vollständiges Gate erneut geprüft.

JSON-Syntaxfehler behalten HTTP 400, damit bestehende Auth-Endpunkte kompatibel bleiben. Fachliche Schemafehler liefern 422. Die Fehlerbehandlung liest auch die ursprüngliche Parserursache aus der Nest-HTTP-Exception und gibt keine rohe Nutzlast zurück.

## Korrektur nach unabhängigem Review

Das Review belegte zwei Grenzfehler. SQLite verglich UUID-Texte mit unterschiedlicher Großschreibung als verschiedene IDs. Außerdem lief die Medientypprüfung im Controller erst nach der Zod-Pipe.

- Rot vor Quelländerung mit `mise exec -- pnpm exec vitest run apps/server/src/rides/rides.identity.test.ts apps/server/src/rides/rides.boundaries.test.ts`. Sechs von 33 Tests scheiterten. Beide eigenen Schreibweisen lieferten unterschiedliche Belege. Ein fremder Großschreibungs-Upload lieferte 200 statt 404. Eigener Detail-Alias lieferte 404 statt 200. Der Großschreibungs-Cursor wiederholte die vorherige Fahrt. `text/plain` lieferte 422 statt 415.
- Grün nach Quelländerung mit `mise exec -- pnpm exec vitest run apps/server/src/rides packages/shared/src/localRide.test.ts`. Alle 54 Tests in sechs Dateien bestehen. Die API-Tests nutzen reale Nest-Module, echte Sessions und SQLite. Sie vergleichen rohe HTTP-Antworten und gespeicherte Nutzlast, Hash, Beleg und Zeilenanzahl. Ein zusätzlicher Test bestätigt unveränderte lokale V1-UUIDs.
- Die Ursache der UUID-Aliase wird am API-Eingang behoben. Upload, Detailpfad und Cursor verwenden dasselbe kanonische ID-Schema. Es gibt keine globale UUID-Umschreibung, Änderung an Auth-IDs oder Datenmigration.
- Die Medientypprüfung liegt jetzt in `RideUploadMediaTypeGuard`, nach globaler Authentifizierung und dem bestehenden Upload-Rate-Limit, vor der Body-Pipe. Die bisherigen Fehler 400, 422 und 413 sowie die Ablehnung komprimierter Bodies bleiben durch Tests belegt.
- Das gebaute Prozess-Skript lädt zuerst eine großgeschriebene UUID hoch und wiederholt sie nach SIGTERM kleingeschrieben. Es prüft die rohe kanonische Antwort, genau eine SQLite-Zeile, den großgeschriebenen Detailpfad, 415 für `text/plain` und gültiges JSON mit Charset. Der Lauf besteht.
- Die unabhängige Korrekturprüfung bestätigt beide Uploadreihenfolgen, unveränderte Belege und Hashes, fremde Aliase, Detail-/Cursor-Aliase sowie Medientypen am gebauten Server. 54 gezielte Tests, Prozess-Neustart und das vollständige Einzelgate sind grün. Die gemeinsame Auth-Integration verwendet inzwischen die neu erzeugte Datenmigration `0002`. `0000` und Auth-`0001` bleiben unverändert.

## Gemeinsamer Integrationsnachweis

- `CI=true mise run check` besteht nach Integration von Auth, Landschaft und Aufnahme mit 436 Tests und 17 E2Es. `mise run build` ist grün.
- Ein frisch mit `pnpm --filter @voltonaut/server deploy --prod` erzeugtes Produktionspaket besteht `verify-package.ts`. Es startet mit explizitem `AUTH_MODE=disabled`, enthält alle drei Migrationen und erzwingt weiterhin die Konfigurationsgrenzen.
- `verify-oidc-build.mjs` und `verify-owned-data.mjs` bestehen erneut gegen den gebauten gemeinsamen Server. Keine echten Provider werden aufgerufen.
- Der unabhängige Prüfer besteht 97 gezielte Tests und eine zusätzliche gemeinsame Prozessprobe. Eine vom signierenden Testprovider ausgestellte OIDC-Session erreicht Profil und Fahrten. Neustart erhält Authdaten, Profil und Beleg. Logout sperrt anschließend auch die Datenendpunkte. Exakte Credential-CORS, Bodygrenzen, Migrationseinträge und Fremdschlüssel werden am laufenden Artefakt geprüft.
