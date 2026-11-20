# Spec E5-09 – Kontogebundener manueller Datensync

- **Status:** Vollständiges lokales Gate und erneute Browsernachweise grün.
  Die gemeinsame Übernahme dokumentiert E0-04.
- **Module:** ausschließlich Web, Dokumentation und lokale Browserverifikation.

## Ziel und Grenzen

Ein kleines Panel „Kontodaten“ zeigt das eigene Serverprofil, zusammengefasste
Serverfahrten und ausdrücklich zugeordnete lokale Uploads. Gast, Sim, Aufnahme
und TCX bleiben unabhängig von Auth, Netz und Outbox. V1 bleibt ungeprüft;
keine Belohnung, automatische Gastzuordnung oder Strava-Veröffentlichung.

## Zwei Formen und Entscheidung

1. Das Kontopanel verwaltet HTTP, Session und IndexedDB. Verworfen, weil UI und
   Session konkurrierende Datenbesitzer würden und Bearer zur UI gelangten.
2. `applicationSession` besitzt Bearer und widerrufbare, origin- und
   generationsgebundene Fähigkeiten. `accountSync` besitzt ausschließlich den
   aktuellen Kontospiegel und die separate dauerhafte Outbox. UI liest DTOs und
   fordert Befehle an. Gewählt. Der Composition Root verbindet bestehende Besitzer.

Die Sessionfähigkeit erlaubt nur bekannte Profil-/Fahrtendpunkte. Logout oder
Sessionwechsel brechen ihre Requests ab. Jede asynchrone Antwort bleibt an die
ursprüngliche Generation gebunden. Auth besitzt weiterhin `/v1/me`.

Die neue IndexedDB verändert weder Profilcache noch lokales Fahrtarchiv.
Kanonische Fahrt-UUID und API-Origin bilden den Schlüssel. Die erste atomare
Zuordnung speichert Eigentümer und vollständige unveränderliche Nutzlast.
Ein anderer Account kann diese Zuordnung auch in einem zweiten Tab nicht ändern.
Profilaufträge speichern ebenfalls einen ausdrücklich bestätigten Snapshot.
`queued | sending | stored | blocked` enthalten Versuchszähler und Rückhaltefrist.
Ein nach Absturz vorhandenes `sending` wird mit derselben Nutzlast wiederholt.
Maximal 20 Einträge, keine automatische Löschung fremder oder eigener Daten.

## Abnahmekriterien

- [x] Serverprofil wird nach validiertem Login gelesen, ein fehlendes bleibt fehlend.
- [x] Ausdrücklicher Profil-Push verwendet nur das zuletzt gespeicherte lokale
      Profil, nie ungesendete Formularwerte. Pending-Push wird durch GET nicht ersetzt.
- [x] Ausdrücklicher Pull validiert und speichert lokal; aktive Fahrtparameter
      bleiben eingefroren. Speicherfehler melden keinen Erfolg.
- [x] Lokale V1-Archive erscheinen nach manuellem Aktualisieren. Erste Zuordnung
      verlangt Bestätigung der Konto-E-Mail. Keine automatische Aufnahmezuordnung.
- [x] Dauerhafte Outbox prüft gespeicherte Daten, Eigentümer, UUID-Aliase,
      Kapazität und unveränderte Nutzlast atomar.
- [x] Nur schema-, status-, medientyp- und ID-gültige Belege markieren gespeichert.
- [x] 401 wartet auf erneute Anmeldung; 403/404/409 und Vertragsfehler bleiben
      ausdrücklich blockiert. Netzwerk/5xx verwenden begrenztes Backoff ohne Schleife.
- [x] Logout/Kontowechsel entfernt sofort private Ansichten. A-Aufträge werden nie
      mit B autorisiert. Veraltete A-Antworten verändern keine B-Daten.
- [x] Speicherfehler heißen nicht „dauerhaft vorgemerkt“. Aufnahme und TCX bleiben nutzbar.
- [x] Fokussierte Tests, statische Gates, Build und echter Browser mit kompiliertem
      API-Prozess und zwei lokal signierten Provideridentitäten sind grün.

## Testplan und Integration

Unit-Tests mit injizierten Transporten/Uhr prüfen Session-Leases, Kontowechsel,
Antwortverträge, Profil-Pending und Retry. Browser prüft echte IndexedDB mit
konkurrierender Zuordnung, Reload und Fehlerfällen sowie echten Cookie-/PKCE-/
Signatur-Login, Profil-Push/Pull und Fahrtverlauf. Der eigene Browserport ist 5193,
API und Provider verwenden Zufallsports und synthetische Konten. Keine Provider-
Credentials, Modul-Mocks, neuen Abhängigkeiten oder Serveränderungen.

Das vollständige Gate verwendet bei der Integration Port 5194 statt des laufenden
Hardware-Labors auf 5173. Keine Hardwareprüfung erforderlich. Offene Nutzerfragen gibt es nicht.

## Verifizierter Stand

Am 20.11.2026 bestehen Format, Oxlint, Typecheck, Dependency-Cruiser, Guard,
Build und `git diff --check`. `mise run test` besteht mit Coverage und
490 Tests in 92 Dateien. Leitplanken, Abhängigkeiten, Server, Migrationen,
gemeinsame API-Verträge, Engine und Rules bleiben unverändert.

Die Regression `retries an old 401 profile after reauthentication even when an
older ride is already stored` scheiterte vor der Korrektur mit `blocked` statt
`stored`. Der Sender liefert jetzt das Ergebnis des aktuellen Versuchs.
Der Sync-Besitzer leitet seine Anmeldesperre nicht mehr aus alten 401-Zeilen ab.
Auch ein Speicherfehler nach HTTP 401 verlangt erneute Anmeldung.

Die öffentlichen Änderungen im Composition Root sind eng begrenzt.
`setupProfile()` liefert `initialProfile`, `saved()` und `apply()`.
`setupBrowserAccount(() => profileReady)` verbindet diese Fähigkeit mit der
Session. Worker und Aufnahme erhalten weiterhin dasselbe eingefrorene Startprofil.
`ApplicationSession.authorize()` liefert nur eine tokenlose Fähigkeit für
festgelegte API-Pfade. Die Darstellung erhält ausschließlich schreibgeschützte DTOs.

## Wiederholbarer Browsernachweis

```sh
mise run build
mise exec -- node scripts/verify-browser-oidc.mjs --sync
VERIFY_WEB_PORT=5193 mise exec -- node scripts/verify-browser-oidc.mjs
```

Die neue Suite besteht mit sechs Browserfällen. Zwei synthetische Identitäten
verwenden echte Cookies, PKCE und RS256-Signaturen gegen den kompilierten
API-Prozess. Geprüft sind Profil-Push ohne Formularentwurf, ausdrücklicher Pull,
eingefrorene Aufnahmeparameter, eigene Serverhistorie und manuelle Fahrtzuordnung.
API-Ausfall, Reload, Login als B und erneuter Login als A erhalten den A-Auftrag.
B sieht weder A-Verlauf noch A-Profil und kann eine bekannte Zuordnung nicht ändern.

Ein echter Server-Upload verliert absichtlich seine Antwort. Danach startet die
API auf derselben SQLite-Datei neu. Die Wiederholung erhält den Beleg. Eine direkte
SQLite-Abfrage bestätigt drei Fahrt-IDs mit jeweils genau einer Zeile.
Weitere Fälle prüfen echte konkurrierende IndexedDB-Transaktionen, UUID-Aliase,
Kapazität, Quota, beschädigte Zeilen und den gespeicherten `sending`-Snapshot.
Verweigerter Speicher meldet einen fehlgeschlagenen Profil-Pull ohne Formularänderung.
Die fünf bisherigen OIDC-Fälle bleiben unverändert grün, einschließlich
Backend-Ausfall, verweigertem Speicher, Welt und TCX.

Nachweise liegen im freigegebenen temporären Verzeichnis:

- Sync: `/var/folders/23/tg_nxvb56ybfx4bqy70w6rjm0000gn/T/opencode/browser-oidc-R7JDyb/`.
  Enthält `proof.json`, `database-proof.json`, `sync.sqlite` und `account-data.png`.
- Bisherige OIDC-Fälle: `/var/folders/23/tg_nxvb56ybfx4bqy70w6rjm0000gn/T/opencode/browser-oidc-oxRr7l/`.
  Enthält den Nachweis sowie TCX-Dateien für verweigerten Speicher und API-Ausfall.

Alle Browserläufe verwenden ausschließlich Port 5193 und zufällige API- und
Providerports. Die Skripte beenden ihre Prozesse vor der Rückgabe.
Port 5173 und das vollständige `mise run check` wurden nicht beansprucht.

## Bewusste Grenzen

Die Integration nach E0-04 besteht das Gesamtgate mit 623 Unit-Tests und 26 E2Es.
Der erneute Aufruf von `scripts/verify-browser-oidc.mjs --sync` besteht 14
Browserfälle einschließlich der später ergänzten Profiltransaktionsregressionen.
Die fünf OIDC-Browserfälle bestehen ebenfalls. Aktuelle Belege liegen unter
`$TMPDIR/opencode/browser-oidc-KiZgQK/` und `$TMPDIR/opencode/browser-oidc-faor3F/`.

Ohne dauerhaft bestätigte Kontozuordnung gibt es keinen flüchtigen Uploadpfad.
Das verhindert eine nach Reload unbekannte und neu bindbare Fahrtzuordnung.
Gast, Sim und TCX bleiben verfügbar. Maximal 20 Outbox-Einträge einschließlich
gespeicherter Belege und Profilauftrag bleiben erhalten. Es gibt keine automatische
Löschung und keinen Timer für wiederholte Uploadversuche. Neue Aufnahmen erscheinen
nach manuellem Aktualisieren. V1 bleibt ungeprüft und ohne Belohnung.
