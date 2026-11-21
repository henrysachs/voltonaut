# Gesamten Fahrtversand prüfen

## Aufruf

Führe den Prüfer mit den installierten, gepinnten Werkzeugen im Repository aus.

```sh
mise exec -- node scripts/ride-delivery-integration/verify.mjs
```

Ein optionaler regulärer Ausdruck wählt einzelne Fälle aus.

```sh
mise exec -- node scripts/ride-delivery-integration/verify.mjs 'capture-owned|delivery explicit'
```

Der Prozess meldet den erhaltenen Belegordner unter `$TMPDIR/opencode/full-ride-delivery-proof-*`.
Ein Fehler bleibt Exitcode 1. Fehlversuche, Datenbank und Bilder bleiben erhalten.
Der übergeordnete Ordner enthält ein Ergebnis pro Fall.
Jeder Fall erhält einen frischen Build, eigene Provider, einen eigenen API-Prozess und eine neue SQLite-Datei.
Dadurch beeinflusst die absichtlich unklare Rate-Reservierung eines verlorenen POSTs keinen anderen Fall.
Neustartfälle behalten innerhalb ihres Falls dieselbe Datenbank und dieselben Provider.

## Ausgeführte Strecke

Der Prüfer baut Shared, die tatsächliche Web-App und den Nest-Server.
Die Vite-Konfiguration liegt außerhalb des Repositorys und verwendet ein eigenes `envDir`.
`VITE_API_ORIGIN` zeigt ausdrücklich auf den eigenen API-Port.
Ein statischer HTTP-Server liefert ausschließlich das gebaute Webartefakt.
Die spezielle OIDC-Adresse `/auth/finish` erhält wie die App die gebaute `index.html`.
Die Strava-Seiten erhalten ihre tatsächlich gebauten HTML-Einstiegspunkte.

Ein eigener Node-Prozess startet den kompilierten Nest-Server mit einer neuen SQLite-Datei.
Der vorhandene signierende OIDC-Peer liefert synthetische Accounts über den öffentlichen Login.
Der Strava-Peer verwendet den vorhandenen OAuth-Peer und eine explizite lokale Uploadgrenze.
Jeder externe POST wird gezählt. Der Peer dedupliziert keine `external_id`.
Der Antwortverlust zerstört den echten HTTP-Socket vor Responseheadern.
Die Quelle bleibt `client_declared`, auch mit nativem GATT-Fake.

Der Browsercode liegt ausschließlich in den neuen Web-`verification/*.spec.ts`-Dateien.
Rootskripte importieren kein Playwright-SDK.
Der Native-Node-Resolver bildet ausschließlich verschachtelte `.spec.js`-Imports unter `apps/server/src/testing/` auf deren TypeScript-Dateien ab.
Produktmodule und der kompilierte API-Prozess verwenden diesen Resolver nicht.
Ein lesender Document-Start-Beobachter protokolliert natives `window.opener` für die tatsächlichen Strava-Seiten.
Er verändert weder Browser-APIs noch Anwendungszustand.
Playwrights `Page.opener()` ist dafür ungeeignet, weil es die erzeugende Seite auch bei `noopener` meldet.

## Fälle

| Fall                  | Geprüftes Verhalten                                                                                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture-owned`       | Öffentlicher Login vor Geräteaktivierung, Trainer und beide Play-Griffe per Nutzerklick, keine frühen FTMS-Schreibvorgänge, ausdrücklich aktivierte Steuerung, Schalten bei aktiver Aufnahme und offenem Menü, rohe V2-Zeile, ausdrückliche Kontozuordnung, Nachrechnung, Reload |
| `delivery explicit`   | Native Popup-Verbindung, eigene Kontofahrt, gesonderter Consent, Multipart, 201 bleibt Verarbeitung, tatsächlicher Poll mit Activity-ID bestätigt Abschluss                                                                                                                      |
| `lost-response`       | Annahme durch den Peer, wirklich verlorene HTTP-Antwort, API-Neustart, Browserreload, dauerhaft unbekannt, kein erneuter Uploadbutton oder POST                                                                                                                                  |
| `poll-restart`        | Tatsächlicher Pollfehler, bekannte Upload-ID über Neustart und Reload erhalten                                                                                                                                                                                                   |
| `sim-blocked`         | Tatsächliche Sim-Aufnahme und Kontozuordnung liefern keinen Uploadbutton und keinen Anbieter-POST                                                                                                                                                                                |
| `memory-cookie`       | Injizierter Ausfall von localStorage, sessionStorage und IndexedDB. Unveränderte native Cookies, ursprüngliche Memory-Session, Popup ohne opener, echte Cookieprüfung bei Callback und Bestätigung                                                                               |
| `missing-cookie`      | Dasselbe Verfahren mit ausdrücklich entferntem tatsächlichem Strava-Cookie. Callback muss vor Tokenaustausch ablehnen. Ursprünglicher Bearer bleibt gültig                                                                                                                       |
| `account-switch`      | Tatsächliches A-Angebot wird unter B abgelehnt. Fehlender Consent und fremde Fahrthistorie bleiben gesperrt                                                                                                                                                                      |
| `account-switch-code` | Tatsächlicher A-Rücksprung wird nach dem öffentlichen B-Login nicht mit B bestätigt                                                                                                                                                                                              |
| `binding`             | Wiederholte tatsächliche Bestätigung, wiederholter Callback und geänderter OAuth-State werden abgelehnt                                                                                                                                                                          |
| `expiry`              | Ursprüngliche Bestätigung am Browsernetzrand abgebrochen. Nach 65 echten Sekunden lehnt der unveränderte Server denselben Rücksprung ab                                                                                                                                          |

Der zusätzliche Fall `clock-fast` verweigert Trainersteuerung und Anbieterupload für eine tatsächlich beschleunigte BLE-Aufnahme.
Die Persistenzgegenprobe ist injiziert. Sie ist kein Nachweis einer nativen Chrome-Datenschutzverweigerung.
Der Prüfer setzt keine Bearer, OAuth-Zustände, Archiveinträge oder Fahrtjournale in die App ein.
Die Historie stammt aus öffentlich gespeicherten Aufnahmen.
Direkte Gegenproben verwenden ausschließlich durch den tatsächlichen Ablauf beobachtete eigene Zugangsdaten und Angebote.

## Belege

- `source-manifest.json` enthält HEAD, MERGE_HEAD, Arbeitsbaumstatus und Quellhashes.
- `source-stability.json` prüft unveränderte Quellbytes während des Falls. Änderungen machen den Lauf rot.
- `artifact-manifest.json` enthält die gebauten Dateien, Serverhashes und gehashten Worker.
- `commands.json` und die Buildlogs enthalten die ausgeführten Befehle.
- `cases.json` enthält das tatsächliche Playwright-Ergebnis je Fall.
- `capture-<UUID>.json` enthält ausschließlich eine von der App aufgezeichnete und per UI zugeordnete rohe Aufnahme.
- `database-proof.json` vergleicht SQLite-Nutzlast, Hash, gespeichertes TCX und TCX-Hash mit der gemeinsamen Projektion und Serialisierung.
- `provider.json` enthält gezählte POSTs, Polls und tatsächlich empfangene Multipartfelder und TCX-Bytes.
- Die fallbezogenen Netzwerkdateien enthalten nur Origin, Pfad, Methode und Status. Keine Bearer oder OAuth-Querywerte.
- Bilder und fehlgeschlagene Playwright-Traces bleiben im Belegordner. Traces können synthetische Zugangsdaten enthalten und gehören nicht ins Repository.

## Grenzen

Der Prüfer verwendet nur eigene dynamische IPv4-Loopbackports und blockiert externe Browserrequests sowie Quellmodule.
Er verändert keine Produktratelimits, Uhren, Datenfrische, Grafikqualität, Migrationen oder Testfixtures.
Alle eigenen Server und Browser enden nach dem Lauf.
Funk, echtes Widerstandsgefühl, echte Strava-Zustimmung, Sichtbarkeit und Produktion bleiben ungeprüft.
Ein erfolgreicher lokaler Lauf ersetzt weder `mise run check` noch das unabhängige Review.
