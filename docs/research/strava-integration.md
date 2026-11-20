# Strava-Anbindung ohne Cycling-Hardware

## Ergebnis und Empfehlung

Stand und Quellenprüfung vom **20.11.2026**. Codebasis ist `main` bei `11bab31b27e228bd08b814496c4eb3653afa31ae`. Dieses Dokument erklärt die Umsetzungsmöglichkeiten. Es implementiert keine Verbindung und bestätigt keine Strava-Zulassung.

OAuth, Export und Upload-Verarbeitung lassen sich ohne Trainer entwickeln und gegen lokale HTTP-Testserver prüfen. Für einen echten OAuth-Pilot braucht Voltonaut einen bestehenden lokalen Account, eine registrierte Strava-App und sichere Serverkonfiguration. Für einen echten Activity-Upload fehlt zusätzlich eine gespeicherte, serverseitig akzeptierte Fahrt. Hardware ist keine Protokollvoraussetzung. [S1, S2, C1, C2]

**Empfohlener nächster Implementierungs-PR:** Eine abgeschlossene lokale Fahrt als TCX herunterladen. Der PR zeichnet 1-Hz-Samples auf, erhält die Herkunft und exportiert auf ausdrücklichen Klick. Das liefert nutzbares Verhalten ohne Zugangsdaten, Strava-Freigabe oder Veröffentlichung. Die Fahrt bleibt lokal und ist nicht serverseitig akzeptiert. TCX ersetzt nicht das offene FIT-Roadmapkriterium. Danach folgen getrennte PRs für serverseitige Fahrtannahme und Strava-Verbindung. [Ableitung aus C1–C5, S1, S2]

Falls die unmittelbare Produktpriorität ausdrücklich **Kontoverbindung statt Export** ist, ist OAuth zuerst technisch möglich. Die gemergte Auth-Grundlage reicht als Anwendungsauthentifizierung. OIDC und vollständiges E5 müssen dafür nicht fertig sein. Der OAuth-PR muss dann Verbindung, Status, Widerruf und Löschung tatsächlich liefern. Leere Provider-Interfaces oder ein Button ohne Callback sind kein eigener Lieferumfang. Ein echter Pilot bleibt bis zur Klärung der unten genannten Policy- und Credentialfragen gesperrt. [Empfehlung auf Basis C1, C2, S1, S5–S8]

## Tatsächlich vorhandener Stand

Alle Codebefunde wurden am 20.11.2026 im genannten Commit geprüft. Die Quellen C1–C5 verlinken unveränderlich auf diesen Stand.

| Bereich                 | Gemergter Befund                                                                                                                                                                                            | Konsequenz                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Account und Session     | `AuthService` erzeugt eine UUID für `users.id`. Magic Link, gehashte einmalige Login-Tokens, gleitende Bearer-Sessions und Logout existieren. `SessionPrincipal` enthält `userId` und `sessionTokenHash`.   | Strava-Verbindung an `userId` hängen. Niemals einen Voltonaut-Account aus Strava-E-Mail ableiten. [C1]                                    |
| Bestehender Login       | Magic Link sucht lokale Nutzer derzeit über die eindeutige E-Mail. Das ist der vorhandene Login, keine Erlaubnis zur Verknüpfung externer Identitäten.                                                      | Strava darf diesen Suchweg nicht zur Kontoverknüpfung wiederverwenden. [C1, C5]                                                           |
| Datenbank               | SQLite, WAL, Fremdschlüssel, Drizzle-Migrationen und Schließen der Verbindung existieren. Die einzige Migration erstellt `users`, `sessions` und `login_tokens`.                                            | Keine vorhandenen Tabellen für Strava, Fahrten oder Samples voraussetzen. [C2]                                                            |
| Auth-Ziel               | ADR-013 und E5-03 beschreiben Cloudflare Access OIDC. `auth_identities`, OIDC-Callback und PKCE-Login sind nicht implementiert.                                                                             | Strava-Uploadrechte bleiben ein separater OAuth-Vorgang. OIDC migriert später unter Erhalt derselben `users.id`. [C1, C2, C5]             |
| Fahrtverträge           | `RideSampleSchema` enthält `tS`, `powerW`, `cadenceRpm`, optional `hrBpm` und `shift`. `RideSummary` enthält Distanz, Höhengewinn, Energie und Fahrzeit. `RideInputSchema` ist ein Fixture-Vertrag.         | Kein produktives `RideUploadSchema`, kein UTC-Start, keine Herkunft im Uploadvertrag, keine persistente akzeptierte Fahrt vorhanden. [C3] |
| Laufende API            | `AppModule` importiert Config, Database, Auth und Health.                                                                                                                                                   | Kein `POST /v1/rides`, keine Fahrthistorie, keine Accountdaten-Export- oder Löschroute implementiert. [C2, C3]                            |
| Client                  | `sync/` speichert das lokale Profil. Eine Fahrtaufzeichnung und Fahrt-Outbox sind nicht vorhanden.                                                                                                          | Kein vorhandenes Recording aus einer anderen Arbeitskopie übernehmen oder als gemergt behandeln. [C4]                                     |
| Roadmap und Backendtext | E5 plant Fahrtannahme, Plausibilitätsprüfung und Historie. E10 nennt FIT-Export und Strava-Upload akzeptierter Fahrten. Mehrere Texte nennen PR #6 noch offen, obwohl dessen Code in `191d4e8` gemergt ist. | Bei Umsetzung diese Statusaussagen berichtigen. Dokumentationsskizzen sind keine ausgelieferten API-Verträge. [C1–C5]                     |

Der globale `AuthGuard` verlangt einen Bearer für nicht öffentliche Routen. Ein Browser-Redirect von Strava enthält diesen Bearer nicht. Der OAuth-Callback muss deshalb ausdrücklich öffentlich erreichbar sein und seine Berechtigung aus einer vorher authentifiziert angelegten, browsergebundenen Transaktion prüfen. `state` allein ersetzt weder Accountbindung noch Browserbindung. [Codebefund C1, Entwurfsfolgerung aus S1]

## Verifizierter Strava-Vertrag

Die folgenden Angaben stammen aus offiziellen Quellen, geprüft am 20.11.2026. Empfehlungen außerhalb dieses Abschnitts sind keine zugesicherten API-Eigenschaften.

### Vertraulicher OAuth-Code-Flow

1. Die Webanwendung öffnet `GET https://www.strava.com/oauth/authorize` mit `client_id`, `redirect_uri`, `response_type=code`, `scope` und einem selbst erzeugten `state`. `approval_prompt` ist `auto` oder `force`. Die Redirect-URI muss innerhalb der registrierten Callbackdomain liegen. `localhost` und `127.0.0.1` sind gesondert zugelassen. Strava verspricht hier keine exakte URI-Allowlist auf Pfadebene. [S1]
2. Der Athlet kann einzelne Scopes abwählen. Der Callback enthält bei Zustimmung einen kurzlebigen, einmal verwendbaren `code` und die bewilligten `scope`-Werte. Ablehnung liefert `error=access_denied`. Ein mitgesendetes `state` wird zurückgegeben. [S1]
3. Der Server tauscht den Code über `POST https://www.strava.com/oauth/token` mit `client_id`, `client_secret`, `code` und `grant_type=authorization_code`. Die Dokumentation zeigt auch `/api/v3/oauth/token` in Beispielen. Für Voltonaut einen dokumentierten kanonischen Endpunkt verwenden, keine automatische Ausweichlogik. Formulardaten statt Secrets in Querystrings verwenden. [S1]
4. Die Antwort liefert Access-Token, Refresh-Token, `expires_at`, `expires_in` und Athleteninformationen. Scopes aus der bewilligten Antwort erhalten und gegen die benötigten Rechte prüfen. Die Dokumentation zeigt unterschiedliche Scope-Trenner in Callback und Tokenantwort. An der Grenze normalisieren, nicht das vollständige Tokenobjekt im Client ausgeben. [S1]

`activity:write` erlaubt Activity-Erstellung und Datei-Uploads. Für reinen Export zu Strava ist weder `activity:read_all` noch `profile:write` erforderlich. Lesezugriff auf Aktivitäten und Activity-Webhooks hat eigene Scope-Anforderungen. Keine umfassenden Leserechte nur für bequemere Duplikatsuche anfordern. [S1, S2, S4]

Die geprüfte Strava-Dokumentation beschreibt **kein PKCE und keine OIDC-ID-Token**. Daraus folgt weder bestätigte PKCE-Unterstützung noch ein generelles Verbot. Nicht die Cloudflare-OIDC-Konfiguration mit Strava gleichsetzen. Ein PKCE-Zwang braucht einen Strava-Nachweis vor Auswahl der Clientbibliothek. [Prüfbefund S1, C5]

### Ablauf, Rotation und Widerruf

- Access-Tokens laufen laut Dokumentation nach sechs Stunden ab. Maßgeblich für den Client ist das zurückgegebene `expires_at`, nicht eine selbst errechnete feste Lebensdauer. Refresh nutzt denselben Tokenendpunkt mit `grant_type=refresh_token`, Client-ID, Client-Secret und dem letzten Refresh-Token. [S1]
- Bei mehr als einer Stunde Restlaufzeit kann derselbe Access-Token zurückkommen. Bei höchstens einer Stunde kann Strava einen neuen Access-Token ausstellen. Alte und neue Access-Tokens gelten bis zu ihrem jeweiligen Ablauf. Jede erfolgreiche Tokenantwort enthält einen Refresh-Token. Sobald ein neuer Refresh-Token ausgegeben wird, ist der vorherige sofort ungültig. Immer den zurückgegebenen Token speichern, auch wenn er gleich aussieht. [S1]
- Seit **01.06.2026** empfiehlt Strava `POST https://www.strava.com/oauth/revoke`. HTTP Basic enthält Client-ID und Client-Secret. Der Form-Body enthält `token` und optional `token_type_hint`. HTTP 200 hat keinen Body und gilt auch für unbekannte Tokens. Der Widerruf eines Access- oder Refresh-Tokens widerruft auch die zugehörigen anderen Tokens. HTTP 503 ist laut Dokumentation sicher wiederholbar. [S1]
- `POST https://www.strava.com/oauth/deauthorize` ist noch dokumentiert, wird aber ab **01.06.2027** nicht mehr unterstützt. Neue Implementierung auf `/oauth/revoke` ausrichten. Ungültige Tokens führen bei Ressourcenaufrufen zu 401. [S1]

### Upload, Verarbeitung und Duplikate

| Schritt          | Offizieller Vertrag                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Einreichen       | `POST https://www.strava.com/api/v3/uploads`, authentifiziert mit Bearer, `multipart/form-data`. `file` und `data_type` sind erforderlich. Zulässige Dateitypen umfassen `fit`, `fit.gz`, `tcx`, `tcx.gz`, `gpx`, `gpx.gz`. JSON ist auf bestimmte Kraftsportarten beschränkt und kein Cyclingformat. [S2]                          |
| Sportart         | `sport_type=VirtualRide` ist ausdrücklich dokumentiert und überschreibt die aus der Datei erkannte Sportart. `activity_type` ist veraltet. `trainer=1` markiert stationär. Dateien ohne Koordinaten werden automatisch stationär markiert. [S2]                                                                                     |
| Korrelationswert | `external_id` ist optional und soll eindeutig sein. Ohne Angabe verwendet Strava den Dateinamen. Das ist keine dokumentierte transaktionale Idempotenzgarantie. [S2]                                                                                                                                                                |
| Angenommen       | HTTP 201 bedeutet nur angenommen und zur Verarbeitung eingereiht. Noch keine fertige Aktivität melden. Die Antwort enthält Upload-ID, `external_id`, `error`, `status` und zunächst meist `activity_id=null`. [S2]                                                                                                                  |
| Abfragen         | `GET https://www.strava.com/api/v3/uploads/:id`. Nicht häufiger als einmal pro Sekunde pollen. Eine erfolgreiche Verarbeitung liefert `activity_id`. Keine garantierte maximale Verarbeitungszeit ableiten. [S2]                                                                                                                    |
| Fehler           | `error` kann bereits beim Einreichen oder später gesetzt sein. `error` und `status` sind menschenlesbares Englisch, teilweise mit HTML. Duplikate können als Text wie `duplicate of activity ...` erscheinen. Keine stabile maschinenlesbare Duplikatkennung oder verbindliche Deduplizierung nach `external_id` dokumentiert. [S2] |
| IDs              | Upload-IDs können 64 Bit groß sein. Dafür `id_str` verwenden. `activity_id` ist als Integer dokumentiert, ohne dort zugesichertes Stringpendant. Niemals bereits gerundete JavaScript-Zahlen in IDs zurückverwandeln. [S2]                                                                                                          |

Die generierte API-Referenz und die Upload-Anleitung haben nicht denselben Detailstand. Die Anleitung dokumentiert `sport_type` ausdrücklich, die Referenz dagegen `visibility` auch für `POST /uploads`. Laut Referenz erlaubt `visibility=only_me` oder `followers_only` eine restriktivere Sichtbarkeit. Im ersten Uploadumfang `visibility=only_me` bereits beim Einreichen senden und gemeinsam mit `sport_type=VirtualRide` im genehmigten Pilot prüfen. Ein nachträgliches Update wäre kein Schutz vor anfänglicher Veröffentlichung. Ohne Pilotnachweis keine Zusage „Upload immer privat“. Parameter anhand beider Quellen testen, nicht einen alten Wrapper als Vertrag behandeln. [S2, S9]

### Dateiformate und ehrliche Herkunft

TCX v2 kann Zeit, Distanz, Radkadenz und Herzfrequenz sowie Watt über Garmin ActivityExtension v2 enthalten. Jedes Trackpoint benötigt einen Zeitstempel. Position und Höhe sind optional. Das Garmin-Schema verlangt `Sport="Biking"`, nicht `VirtualRide`. Beim API-Upload setzt deshalb der Multipartparameter die virtuelle Sportart. Ein manueller TCX-Import hat diese zusätzliche API-Metadaten nicht. [S2, S10, S11]

FIT speichert unter anderem `session.sport`, `session.sub_sport` und Records mit Zeit, Leistung, Kadenz, Distanz und optionalen Koordinaten. Strava erkennt die Sportart aus Sport und Subsport. Ein registrierter Herstellerwert muss tatsächlich zugewiesen sein. Das binäre Format, CRC-Prüfung, aktuelle Profilwerte und Encoderwahl wären ein eigener Implementierungsumfang. Der genaue FIT-Wert für virtuelle Aktivität wurde hier nicht unabhängig im aktuellen FIT-Profil geprüft. Keine erfundene Herstellernummer oder ungeprüfte Enumkonstante verwenden. [S2]

Stravas Support beschreibt virtuelle Aktivitäten als ursprünglich von einer unterstützten virtuellen Anwendung aufgezeichnet. Athleten können die Sportart nicht nachträglich selbst auf Virtual Ride ändern. Die API dokumentiert gleichzeitig `sport_type=VirtualRide`. Ob ein noch nicht registrierter Voltonaut-Produzent dafür besondere Freigabe benötigt und wie Strava TCX ohne GPS tatsächlich einordnet, bleibt durch einen genehmigten Pilot zu bestätigen. [S2, S12]

**Entwurf für Voltonaut:** Zunächst keine Koordinaten exportieren. Weltkoordinaten `x/z` sind kein gemessenes GPS. Keine beliebige reale Strecke unterlegen, keinen Garmin- oder Zwift-Produzenten vortäuschen und keinen Barometerzusatz verwenden, um Höhenwerte zu erzwingen. Virtuelle Distanz und Höhe als solche erklären. Gemessene Leistung bleibt von Sim-Leistung unterscheidbar. Sim-Dateien tragen „Voltonaut simulation, not a real workout“ in Dateiname und Notizen. Ein Exportklick ist kein Uploadklick. [Ableitung aus C3, C5, S2, S12]

### Limits und Pilot

Neue Apps starten mit **einem Athleten** im Single Player Mode. Nur der eigene Strava-Account kann sich verbinden. App-Erstellung verlangt laut aktuellem Getting Started ein Strava-Abo. Nach Konfiguration kann der Betreiber im API-Dashboard selbst auf zehn Athleten erhöhen. Das ist keine bereits für Voltonaut bestätigte Kapazität. Mehr als zehn erfordert Review. Zugang und Erhöhungen sind nicht garantiert und haben keine feste zugesicherte Bearbeitungszeit. [S3, S6, S8 §3]

| Zustand laut Dokumentation                   | Gesamte Requests                 | Nicht-Upload-Requests            |
| -------------------------------------------- | -------------------------------- | -------------------------------- |
| Standardlimit                                | 200 je 15 Minuten, 2.000 täglich | 100 je 15 Minuten, 1.000 täglich |
| Im Dashboard freigeschaltete Zehnerkapazität | 400 je 15 Minuten, 4.000 täglich | 200 je 15 Minuten, 2.000 täglich |

Die Limits gelten pro Anwendung, nicht pro Athlet. Die Header `X-RateLimit-Limit`, `X-RateLimit-Usage`, `X-ReadRateLimit-Limit` und `X-ReadRateLimit-Usage` liefern die tatsächlichen Werte. Nur Activity-Erstellung, Upload-Erstellung und Activity-Medienupload sind vom zusätzlichen Nicht-Upload-Limit ausgenommen. Statusabfragen verbrauchen deshalb auch das Lesekontingent. [S3]

HTTP 429 signalisiert Überschreitung. Viertelstundenkontingente erneuern sich um Minute 0, 15, 30 und 45. Das Tageskontingent erneuert sich um Mitternacht UTC. Trotz überschrittenem Kurzzeitlimit gesendete Requests zählen weiter zum Tageslimit. Die Quelle garantiert keinen `Retry-After`-Header. Der Client muss ohne diesen Header warten können. [S3]

Reviewunterlagen umfassen Screenshots aller Stellen mit Strava-Daten und den Verbindungsbutton. Das Dashboard ist erst mit Betreiberzugriff auf tatsächliche Kapazität prüfbar. Weder Registrierung noch Dashboardänderung wurde hier durchgeführt. [S3]

### Webhooks, Datenschutz und Marke

Eine App hat höchstens eine Webhooksubscription für alle verbundenen Athleten. Bei Einrichtung muss der Callback `hub.mode`, `hub.verify_token` und `hub.challenge` prüfen und die Challenge binnen zwei Sekunden als JSON beantworten. Events müssen binnen zwei Sekunden mit HTTP 200 bestätigt werden. Strava wiederholt bei ausbleibender Bestätigung bis zu insgesamt drei Versuchen. [S4]

Widerruf erzeugt ein Athletenevent mit `updates.authorized="false"`. Activity-Events benötigen Activity-Lesescopes. Für einen Upload-only-Client nicht vorsorglich `activity:read_all` anfordern. Das Getting Started verlangt Webhooks zur Erkennung von Deautorisierung ausdrücklich. Ob das Athletenevent mit ausschließlich `activity:write` im konkreten Pilot ankommt, ist gesondert zu prüfen. Die Webhookseite beschreibt keine kryptografische Signatur des Event-POST. Das Challenge-Token ist keine zugesicherte Signatur späterer Events. [S1, S4, S6]

Die am 01.06.2026 wirksame API-Vereinbarung und API-Policy sind für die Architektur relevant:

- Vor Zugriff sind verständliche Zustimmung, Datenarten, Verarbeitungsweg, Widerruf, Löschweg und Löschbestätigung nötig. Eigene Datenschutzerklärung, Supportkontakt und Link zum Strava-Konto gehören zur Freigabe. Die Weitergabe eigener Fahrtdaten an Strava verlangt ebenfalls die nötige Zustimmung. [S7 §5, S8 §§2, 7]
- Strava-Daten dürfen nur dem betreffenden Nutzer angezeigt werden. Keine Übernahme in Multiplayerprofile, Ranglisten, Werbung, Trainings-KI oder Produktanalysen. Keine Strava-Daten oder echten Tokenantworten in Agentenchats, Testfixtures oder KI-Kontexte übernehmen. §5.3 formuliert auch hinsichtlich „API Materials“ sehr breit. Ob KI-gestützte Entwicklungswerkzeuge für die konkrete Nutzung zulässig sind, muss vor weiterem Live-Einsatz geklärt werden. Diese Recherche hat keine Athletendaten abgerufen. [S7 Einleitung, S8 §§2.3, 5]
- §6.2 begrenzt Strava-Datencaches auf sieben Tage. §5.5 untersagt dauerhafte abrufbare Datenbestände außerhalb des erlaubten Caches. Gelöschte Strava-Daten dürfen spätestens nach 48 Stunden nicht mehr angezeigt werden. §7.4 verlangt Löschung bei Widerruf und nennt spätestens 30 Tage. Der Entwurf darf daraus keine pauschale 30-Tage-Aufbewahrung ableiten. [S8 §§5.5, 6, 7.4]
- Es besteht eine **offene Auslegungsfrage** für dauerhaft benötigte Athlete-ID, Tokens und Upload-IDs. Die Auth-Doku verlangt Tokenpersistenz, die Policy begrenzt Strava-Datenspeicherung breit. Ebenso verlangt §2.5 bei Kündigung des Zugriffs Löschung aller „Data“, während §7.4 Strava-Daten und daraus abgeleitete personenbezogene Daten nennt. „Data“ umfasst laut Vereinbarung auch eigene Anwendungsdaten. Erhalt eigener Voltonaut-Fahrten bei bloßem Strava-Trennen daher nicht ungeprüft zusichern. Vor echtem Pilot schriftlich mit Strava klären und das Löschkonzept festlegen. [S1, S7 §2.3, S8 §§2.5, 6, 7.4]
- Die Policy untersagt konkurrierende Anwendungen und bestimmte Weitervermittler. Voltonauts eigene Indoor-Spielwelt mit optionalem Upload ist keine hier bestätigte Ausnahme. Zulässigkeit des konkreten Produkts bei Unklarheit von Strava bestätigen lassen. Die Vereinbarung erlaubt Uploadoptionen grundsätzlich. [S7 §§2.2, 7, S8 §§5.2, 5.16]
- Offizielle Verbindungslogos unverändert verwenden, falls ein Logo eingesetzt wird. Keine behauptete Partnerschaft, kein Strava-Name im Appnamen. Verlinkte Strava-Daten mit „View on Strava“ kennzeichnen. Logo- und Reviewanforderungen vor Pilot erneut prüfen. [S5, S3]

## Zwei mögliche Modulformen

Die folgenden Formen sind **Entwürfe**, keine bestehenden Typen oder genehmigte Speicherpraktiken. Öffentliche JSON-Verträge gehören als Zod-Schemas nach `packages/shared/src/api`. Interne Tokens und Strava-Antwortschemas bleiben serverseitig. Zeit, HTTP und Zufall sind injizierbar. Der Client besitzt nur den Darstellungszustand. [Architekturvorgaben C5]

### Form A: Direkte Strava-Anbindung als eigenes Servermodul

- `auth/` besitzt Accounts und Sessions. Strava verwendet den authentifizierten `SessionPrincipal.userId`, ohne E-Mail-Abgleich.
- `rides/` besitzt angenommene Fahrten und deren Export. Es liefert später ausschließlich eigene akzeptierte Fahrten an das Strava-Modul.
- `strava/` besitzt OAuth-Transaktionen, verschlüsselte Zugangsdaten, Widerruf und den dauerhaften Uploadzustand. Ein auf Strava begrenzter HTTP-Adapter kennt die externen Endpunkte.
- `apps/web/src/sync/` ruft die Anwendungsschnittstelle auf. `ui/` zeigt Verbindung, Einwilligung und Uploadstatus. Kein Token im Browser.

Geplante Signaturen mit schemaabgeleiteten, semantisch getrennten IDs:

```ts
interface StravaConnections {
  start(principal: SessionPrincipal, browser: BrowserBinding): Promise<AuthorizationStart>;
  complete(callback: StravaCallback, browser: BrowserBinding): Promise<ConnectionResult>;
  status(userId: UserId): Promise<ConnectionStatus>;
  disconnect(userId: UserId): Promise<DisconnectResult>;
}

interface RideExports {
  loadOwnAccepted(userId: UserId, rideId: RideId): Promise<AcceptedRideResult>;
}

interface StravaUploads {
  request(userId: UserId, rideId: RideId, consent: UploadConsent): Promise<UploadStatus>;
  status(userId: UserId, rideId: RideId): Promise<UploadStatus>;
}
```

Ein `AcceptedRideResult` ist entweder eine nicht veröffentlichbare Ablehnung oder eine vom `rides/`-Service geladene eigene Fahrt. Kein Strava-Endpunkt akzeptiert Samples, TCX, eine fremde Athleten-ID oder frei wählbare Ziel-URLs vom Aufrufer. Herkunft und Zustimmung bleiben auch nach Wiederanlauf prüfbar.

### Form B: Allgemeines Modul für verbundene Dienste und Exportaufträge

`integrations/` besitzt einen Providerkatalog und Verbindungen. `activity-delivery/` besitzt eine providerunabhängige Warteschlange. `rides/` liefert Exportartefakte für mehrere Zielsysteme. Provider implementieren einen gemeinsamen Vertrag.

```ts
interface ActivityDestination {
  authorize(userId: UserId, browser: BrowserBinding): Promise<AuthorizationStart>;
  submit(ride: OwnAcceptedRide, consent: UploadConsent): Promise<SubmissionResult>;
  poll(receipt: SubmissionReceipt): Promise<DeliveryStatus>;
  revoke(userId: UserId): Promise<DisconnectResult>;
}
```

Diese Form lohnt sich erst bei mehreren tatsächlich implementierten Zielsystemen. Heute fehlen dafür sowohl Ziele als auch angenommene Fahrten. Unterschiedliche Provider können andere Datenschutz-, Token- und Wiederholungsregeln haben. Ein universeller Vertrag würde diese Unterschiede vorzeitig festschreiben.

**Empfehlung ist Form A.** Ein Besitzer pro Zustand, kein allgemeines Providerframework und keine zusätzliche Queue-Infrastruktur. SQLite kann die zunächst kleine Zahl von Aufträgen und Leasingzuständen tragen. Die Sicherheit hängt nicht von einem zweiten Broker ab. Native `fetch`, `FormData`, `Blob` und `node:crypto` vermeiden einen zusätzlichen Strava-Wrapper. Ob eine OAuth-Bibliothek nötig ist, bleibt eine Implementierungsentscheidung. Jede neue direkte Abhängigkeit benötigt vorher ADR und Registereintrag. [Entwurfsentscheidung, C2, C5]

## Zustände, Speicher und Fehlerbehandlung

### Verbindung und Geheimnisse

Öffentlicher Verbindungsstatus sollte eine diskriminierte Union sein. `disconnected` enthält keine Tokens. `connected` enthält bestätigte Rechte und einen sicheren Anzeigestatus. `reauthorization-required` unterscheidet fehlende Rechte oder widerrufenen Zugang. `disconnecting` blockiert neue Uploads, obwohl ein Remote-Widerruf noch aussteht. Geheimnisse sind ausschließlich interne Daten.

Der Start ist ein authentifizierter POST, beispielsweise `POST /v1/integrations/strava/authorization`. Er erstellt einen zufälligen `state`, speichert nur dessen Hash und liefert eine feste Autorisierungs-URL. Die Transaktion bindet `userId`, ursprüngliche Sessionreferenz, Browserbindung, Ablauf und einmaligen Verbrauch. Ein geschütztes Transaktionscookie bindet den Browser. Callback und Rücksprung zum Webclient sind fest konfiguriert. Keine vom Request übernommene Rücksprung-URL.

Beim Callback die Transaktion atomar beanspruchen, vor dem Codeaustausch gegen Replay sperren und die Ursprungssession über einen exportierten Auth-Service prüfen. Kein Fremdzugriff auf `auth.schema.ts`. Ein ausgeloggter, gelöschter oder abgelaufener Account wird nicht verbunden. Nach externem Austausch nur dann speichern, wenn Transaktion und Verbindungsgeneration noch gültig sind. Derselbe Strava-Athlet darf nicht still zwei Voltonaut-Accounts zugeordnet werden. Eine Kollision verlangt expliziten Besitznachweis, nicht Überschreiben.

Ein synchroner SQLite-Transaktionsblock darf keinen HTTP-Aufruf überbrücken. Beanspruchen, Netzwerkzugriff und bedingtes Speichern sind getrennte Schritte. Refresh benötigt pro Verbindung ein atomisches Lease oder gleichwertige Serialisierung. Ein reines In-Memory-Promise schützt nicht gegen zwei Prozesse oder einen Neustart. Access- und neuester Refresh-Token werden gemeinsam atomar ersetzt. [Entwurf aufgrund Rotation in S1]

Vorgeschlagene Konfiguration ist eine Union aus `disabled` und `enabled`. Im aktivierten Zustand sind Client-ID, Client-Secret, exakte Server-Callback-URI, feste Client-Rücksprung-URI und ein Verschlüsselungsschlüssel erforderlich. Mögliche Variablennamen sind `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI` und `STRAVA_TOKEN_KEY`. Es werden hier keine Werte angelegt. Bei deaktivierter Integration startet der Server ohne Strava-Secrets. Aktivierte unvollständige Konfiguration scheitert vor dem Listen sicher. Fehler dürfen weder Rohkonfiguration noch Tokens ausgeben.

Tokens müssen später wieder verwendbar sein. Anders als Voltonaut-Sessions können sie nicht nur gehasht gespeichert werden. Vorschlag ist authentifizierte Verschlüsselung mit `node:crypto`, zufälligem Nonce, Authentifizierungstag, Schlüsselversion und Accountbindung als Zusatzdaten. Schlüssel außerhalb von Datenbank, Repository, Browser und Backups der Datenbank halten. Schlüsselrotation und Restore mit altem Schlüssel testen. Konkrete Aufbewahrung und erlaubte permanente Metadaten hängen von der Policyklärung ab. [Entwurf, S1, S8]

Migrationen ergänzen nur modulbesessene Tabellen für OAuth-Transaktionen, Verbindungen und später Uploadaufträge. Eindeutigkeit für lokale Verbindung, Strava-Athlet und lokalen Uploadauftrag muss in SQLite gelten. Status und zugehörige Felder mit Constraints konsistent halten und beim Laden validieren. Bereits angewandte Migration `0000` nicht umschreiben. Keine Auth-, OIDC- oder Leitplankenänderung in diesem Recherche-PR. [Entwurf nach C2, C5]

### Uploadzustand und Wiederholungen

Ein brauchbares internes Modell unterscheidet mindestens folgende Varianten:

```ts
type UploadStatus =
  | { readonly kind: "queued" }
  | { readonly kind: "submitting"; readonly attemptId: AttemptId }
  | {
      readonly kind: "processing";
      readonly uploadId: StravaUploadId;
      readonly nextPollAtMs: number;
    }
  | { readonly kind: "succeeded"; readonly activityId: StravaActivityId }
  | { readonly kind: "submission-unknown"; readonly attemptId: AttemptId }
  | { readonly kind: "blocked"; readonly reason: "authorization" | "rate-limit" }
  | { readonly kind: "failed"; readonly reason: "invalid-file" | "duplicate" | "provider-error" };
```

Das ist eine Entwurfsskizze, noch kein vollständiges Persistenzschema. Insbesondere muss ein zurückgestelltes Polling seine Upload-ID behalten. Ein generischer Fehlerstatus darf keine bereits bekannte Remote-ID überschreiben. Sim-Herkunft ist keine Uploadoption. Für den ersten echten Uploadumfang sollte `trainerSource=sim` serverseitig abgelehnt werden, auch bei explizitem Klick. Lokaler Sim-Export bleibt möglich.

| Ereignis                             | Empfohlenes Verhalten, keine Strava-Garantie                                                                                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uploadklick                          | Nur eigene gespeicherte Fahrt mit Status `accepted`, bestätigter Herkunft, aktiver Verbindung und ausdrücklicher Zustimmung laden. `flagged`, `rejected`, fremde und Sim-Fahrten ablehnen. Zustimmung bindet Fahrt, Zielathlet, Verbindungsgeneration und Exportversion.                        |
| Doppelklick oder zwei Requests       | Eindeutiger lokaler Auftrag pro Fahrt und Ziel. Beide Requests erhalten denselben Zustand. Stabiles `external_id`, beispielsweise `voltonaut-<rideId>.tcx`. Keine E-Mail oder Token im Dateinamen.                                                                                              |
| HTTP 201                             | Upload-ID vor dem nächsten Arbeitsschritt speichern. Nur `processing` melden. `id_str` bevorzugen.                                                                                                                                                                                              |
| Erfolgreiches Polling                | Nichtleere `error` hat Vorrang. Nur eine sicher gelesene `activity_id` führt zu Erfolg. Englische Statustexte nicht als einziges Protokollsignal parsen und niemals als HTML rendern.                                                                                                           |
| Unsichere Integer-ID                 | Grenzparser akzeptiert dokumentierte String-ID oder eine nachweislich sichere Ganzzahl. Unsichere Zahl liefert einen expliziten Protokollfehler. Für darüber hinausgehende 64-Bit-Antworten verlustfreien JSON-Parser evaluieren, mit ADR bei neuer Abhängigkeit.                               |
| Timeout nach möglichem Uploadversand | `submission-unknown`, nicht automatisch erneut POSTen. Abbruch des Clients beweist keinen Abbruch bei Strava. Ohne Upload-ID gibt es in den geprüften Uploadendpunkten keine Abfrage nach `external_id`. Nutzer über unbekanntes Ergebnis informieren. Manueller Abgleich vor erneutem Versuch. |
| Absturz während `submitting`         | Nach Wiederanlauf ebenfalls unklar. Kein automatischer Neuversand. Nur bekanntes `processing` sicher weiter pollen.                                                                                                                                                                             |
| Timeout bei bekanntem Polling        | Bekannte Upload-ID erhalten. GET mit begrenztem Backoff und frühestens nach einer Sekunde wiederholen. Nach lokalem Zeitbudget „Verarbeitung läuft“ zeigen, nicht „Upload fehlgeschlagen“.                                                                                                      |
| Duplikatmeldung                      | Nicht als neue erfolgreiche Veröffentlichung zählen. Dokumentierte englische Fehlermeldung höchstens defensiv klassifizieren. Keine fremde Activity allein aus einer Text-ID als eigene übernehmen. Keine Startzeit ändern, um Duplikaterkennung zu umgehen.                                    |
| HTTP 429                             | Kontingentzustand appweit aktualisieren. Einen gültigen `Retry-After` beachten, falls vorhanden. Sonst auf dokumentiertes Resetfenster warten. Tageslimit hat Vorrang. GETs zurückstellen. Einen eindeutig abgelehnten POST nur im selben lokalen Auftrag erneut zulassen.                      |
| 5xx beim POST oder Antwortverlust    | Ohne sichere Ablehnung konservativ als unbekannte Einreichung behandeln. Keine unbeschränkten Retries.                                                                                                                                                                                          |
| Tokenrefresh mit Timeout             | Neuer Token könnte bereits ausgestellt und der alte Refresh-Token ungültig sein. Nicht endlos wiederholen. Verbindung als klärungsbedürftig markieren. Gegebenenfalls erneute Zustimmung verlangen.                                                                                             |
| HTTP 401                             | Zuerst Ablauf und lokale Generation prüfen. Höchstens einen serialisierten Refreshversuch, wenn zulässig. Keine Endlosschleife. Fehlgeschlagener Refresh verlangt Reautorisierung.                                                                                                              |
| Trennen während Upload               | Generation erhöhen, neue Aufträge sperren und ausstehende Poller stoppen. Bereits bei Strava angekommene Aktivität nicht als rückgängig gemacht behaupten. Remote-Löschung einer Activity ist ein anderer Vorgang.                                                                              |
| Widerruf                             | Lokal sofort sperren. `/oauth/revoke` wiederholbar ausführen. Bis zur Bestätigung den minimal nötigen verschlüsselten Widerrufsauftrag getrennt halten, danach Tokens löschen. Frist und Restdaten folgen dem geklärten Löschkonzept.                                                           |

Ein HTTP-Adapter braucht getrennte, begrenzte Zeitbudgets für Codeaustausch, Refresh, Upload und Polling. Vorläufige Testwerte können etwa zehn Sekunden für Tokenaufrufe und dreißig Sekunden für Dateiübertragung sein. Diese Werte sind Entwurfswerte, keine Strava-SLAs. Fake-Uhr und abbrechbarer Transport müssen jeden Timeout ohne reale Sleeps testen können. Das Ende eines HTTP-Zeitbudgets ist kein Beweis über den Remotezustand.

## Lieferbare Schritte und Abnahmekriterien

### Nächster PR: Lokale Aufnahme und TCX-Download

Vorgeschlagener Umfang ist `apps/web/src/game` für die laufende Aufnahme, `sync/` für den abgeschlossenen lokalen Datensatz, `ui/` für den ausdrücklichen Download und ein Zod-Vertrag in `packages/shared`. Ein reiner TCX-Serializer kann zunächst beim einzigen Clientaufrufer liegen. Erst bei serverseitigem Wiederverwenden einen begründeten gemeinsamen Exportort wählen. Kein neues Paket und kein allgemeines Exportframework vorab.

Der Datensatz benötigt eine Fahrt-ID, UTC-Startzeit, echte verstrichene Samplezeit, Route und Version, Herkunft sowie Distanz und optionale Messwerte je Sample. Die bestehende Engine-Fahrzeit allein reicht bei Pausen und `ride.clockSkipped` nicht zur Rekonstruktion der Wanduhr. Fehlende Messwerte nicht durch erfundene Sensorwerte ersetzen. Der erste Umfang kann ausschließlich im laufenden Tab speichern. Ohne persistente Speicherung keine Wiederherstellung nach Reload versprechen. [Ableitung aus C3–C5]

Konkrete Abnahmevorschläge:

- Eine Sim-Fahrt beenden und eine nichtleere, gekennzeichnete TCX-Datei per Klick herunterladen. Kein HTTP-Aufruf zu Strava, kein OAuth und kein automatischer Download.
- Dieselbe gespeicherte Fahrt erzeugt byteidentisches TCX. UTC-Zeiten, XML-Escaping, Reihenfolge, Radkadenz und Watt-Erweiterung entsprechen Garmin v2. Keine Koordinaten und keine fremden Herstellerangaben.
- Null Watt ist nicht „fehlend“. Fehlender Puls erzeugt kein Herzfrequenzelement. Dezimalwerte für Ganzzahlfelder werden nach ausdrücklich festgelegter Regel behandelt.
- Pause, übersprungene Zeit, Null-Samples, negative Zeitdifferenz, überlange Fahrt und Download vor Fahrtende haben definierte Ergebnisse. Ein leerer oder inkonsistenter Datensatz wird nicht als gültige Fahrt exportiert.
- Neue erwartete Exportdateien liegen beispielsweise unter `apps/web/src/sync/testdata/`, nicht unter geschützten Golden-, BLE- oder API-Fixturepfaden. Gegen das offizielle XSD und semantische Werte prüfen. Ein Snapshotvergleich allein reicht nicht.
- Es entstehen keine Strava-Verbindung, keine behauptete serverseitige Akzeptanz und keine Belohnung. Roadmap-FIT- und Strava-Kriterien bleiben offen.

### Eigenständiger nächster Serverschritt: Eigene Fahrt speichern und exportieren

Vor einem echten Strava-Upload braucht `rides/` einen produktiven Uploadvertrag, Besitzprüfung, versionierte Route und Profilbasis, Samples mit echter Zeitachse und Herkunft, serverseitige Plausibilitätsprüfung sowie idempotente Speicherung. Dieselbe `rideId` mit anderer Nutzlast darf keine Fahrt still überschreiben. Nur der Besitzer kann eine Fahrt laden und exportieren. Ablehnung, Flag und akzeptierte Fahrt sind unterschiedliche Zustände. Ein Sim-Datensatz bleibt erkennbar und bekommt keine Belohnung. [C3, C5]

Das sollte nicht nebenbei alle E5-Ziele, OIDC, Ökonomie und Outbox implementieren. Sinnvoll sind zunächst ein begrenzter Aufnahmevertrag und Speicherung mit Status, danach serverseitig geprüfte Annahme mit eigenen Integrationsfällen. Solange diese Prüfung fehlt, niemals `accepted` allein aufgrund erfolgreicher JSON-Validierung setzen. Erst ein eigener Export-Endpunkt für gespeicherte akzeptierte Fahrten kann später unverändert als Uploadquelle dienen. Dies sind Folgeschritte, kein Lieferumfang des empfohlenen Export-PRs.

### Alternative Priorität: OAuth-Verbindung vor Fahrtpersistenz

Ein enger OAuth-PR kann bestehende Magic-Link-Sessions verwenden. Er benötigt keine Ride-Tabellen und keine Hardware. Seine sichtbare Wirkung sind „verbunden“, bestätigte Uploadrechte und „getrennt“. Vor echter Nutzung müssen Privacyhinweis, Widerrufsereignis, Löschweg und die offenen Policyfragen gelöst sein. In Entwicklung bleibt der echte Strava-Transport deaktiviert. Ein lokaler Testprovider prüft dieselben HTTP-Wege, behauptet aber keine Strava-Freigabe.

Abnahmevorschläge für diesen PR:

- Ohne Voltonaut-Bearer ist der Autorisierungsstart 401. Mit Session entsteht genau eine browsergebundene Transaktion und ein Redirectziel unter der festen Strava-Origin.
- Erfolgreicher Callback verbindet genau die ursprüngliche `users.id`. Gleiche Strava-E-Mail verändert keine Accountzuordnung. Fehlende `activity:write`-Zustimmung aktiviert keine Uploadfähigkeit.
- Falsches, fehlendes, abgelaufenes und bereits benutztes `state`, ein anderer Browser sowie Logout während des Flows erzeugen keine Verbindung. Zwei gleichzeitige Callbacks verbrauchen den Code höchstens einmal.
- Unvollständige Antwort, HTTP 400, HTTP 401, HTTP 429, ungültiges JSON, Verbindungsabbruch und Timeout erzeugen einen sicheren, endlichen Fehlerzustand. Kein unkontrolliertes Wiederholen einmaliger Codes.
- Statusantwort, Redirect, Log und Browserbundle enthalten keine Access-Tokens, Refresh-Tokens, Codes oder Secrets. Callback-Querylogs am Server und Proxy werden berücksichtigt.
- Zwei Refreshanforderungen und Trennen während eines Refresh überschreiben keine neuere Verbindung. Der neue Refresh-Token überlebt einen Prozessneustart verschlüsselt.
- Lokales Trennen sperrt sofort. Revocation per `/oauth/revoke` mit Basic Auth und Form-Body ist nachweisbar. Leerer HTTP-200-Body und wiederholter Widerruf funktionieren. HTTP 503 und Timeout erhalten einen ausführbaren Widerrufsauftrag.
- Webhook-Challenge, wiederholte Widerrufsereignisse, falsche Subscription, fremder Athlet und verspätete Events sind geprüft. Unsignierte öffentliche Events dürfen keinen unkontrollierten kontenübergreifenden Löschpfad auslösen. Verfahren gegen gefälschte Events und spätes Event nach Neuverbindung vor Umsetzung festlegen.
- Bestehende Accounts und Sessions überstehen die Migration. Strava aus bedeutet keine neuen Secrets als Startpflicht. OIDC- und Magic-Link-Produktionskonfiguration werden nicht heimlich umgestellt.

Tests verwenden bestehende Nest-Testinitialisierung, Supertest, SQLite und `loginTestUser`. Ein injizierter Strava-Transport spricht mit einem lokalen HTTP-Testserver auf zufälligem Port. Dieser zeichnet Formdaten und Multipartrequests auf und liefert Codeaustausch, Rotation, Revocation und Uploadzustände. Keine `vi.mock`, keine echten Credentials, keine öffentlichen Aktivitäten und kein gebuchter Tarif. [Vorhandene Testmöglichkeiten C2, C5]

### Späterer PR: Expliziter Upload einer akzeptierten eigenen Fahrt

Erst nach beiden Voraussetzungen wird `POST /v1/rides/:rideId/strava-upload` sinnvoll. Der Body enthält höchstens ausdrückliche Zustimmung und erlaubte Metadaten, keine Messreihen. Getrennte Statusroute zeigt `queued`, `processing`, Erfolg oder Unsicherheit. Tests müssen Doppelklick, Parallelität, Neustart nach Versand, Timeout nach Remoteannahme, Pollingfehler, Duplikat, 429, Tokenrotation und Widerruf beweisen. Ein erfolgreicher Dateiexport und eine verbundene Strava-App beweisen diesen Ablauf noch nicht.

## Offene Voraussetzungen vor echtem Pilot

| Voraussetzung            | Stand und benötigter Nachweis                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strava-App und Abo       | Nicht geprüft. Betreiber bestätigt bestehende App oder richtet sie selbst nach Freigabe ein. Keine Kontoerstellung oder Buchung in dieser Aufgabe. [S6]                                                       |
| Kapazität und Review     | Nicht geprüft. Dashboard muss tatsächliche Athletenzahl und Limits zeigen. Keine zehn Athleten oder höhere Quote versprechen. [S3]                                                                            |
| Zugangsdaten             | Nicht vorhanden oder gelesen. Client-Secret und separater Verschlüsselungsschlüssel werden nach enger Freigabe serverseitig eingerichtet. Nie in Chat, Repo oder Frontend.                                    |
| Callback und Betrieb     | Exakte lokale und produktive Callback-URI, TLS, fester Rücksprung, Logredaktion und erreichbarer Webhook sind einzurichten. Kein Deploy aus dieser Recherche.                                                 |
| Policy                   | Zulässigkeit des Produkts, KI-gestützte Entwicklung, operative Token- und ID-Aufbewahrung sowie Verhalten eigener Voltonaut-Daten beim Trennen klären. Keine Rechts- oder Strava-Freigabe behauptet. [S7, S8] |
| Datenschutz              | Verständliche Einwilligung, Datenexport, Löschung einschließlich Backups, Löschbestätigung und Supportweg sind noch nicht implementiert. [C2, S8]                                                             |
| VirtualRide              | TCX ohne GPS, `sport_type=VirtualRide`, Quellenanzeige und anfängliche Sichtbarkeit in genehmigtem Pilot prüfen. Simdaten niemals automatisch veröffentlichen. [S2, S12]                                      |
| Eigene akzeptierte Fahrt | Recording, Annahmevertrag, Prüfung, Persistenz und Besitzprüfung fehlen im gemergten Stand. Keine willkürlichen Requestdaten direkt an Strava weiterleiten. [C2–C5]                                           |

## Quellen

Alle externen Quellen wurden am **20.11.2026** direkt geöffnet. Es wurden nur öffentliche Dokumentation und öffentliche Schemas gelesen. Keine OAuth-Anfrage, kein Athletenzugriff, keine Subscriptionanlage und kein Upload wurde ausgeführt.

- **S1:** [Strava Authentication](https://developers.strava.com/docs/authentication/). Code Flow, Scopes, Redirectdomain, Rotation und neue Revocation. Prüfdatum 20.11.2026.
- **S2:** [Uploading to Strava](https://developers.strava.com/docs/uploads/). Formate, Multipartparameter, VirtualRide, IDs, Verarbeitung und Duplikate. Prüfdatum 20.11.2026.
- **S3:** [Strava Rate Limits](https://developers.strava.com/docs/rate-limits/). Limits, Header, Athletenkapazität und Review. Prüfdatum 20.11.2026.
- **S4:** [Webhook Events API](https://developers.strava.com/docs/webhooks/). Subscription, Challenge, Events und Zeitgrenzen. Prüfdatum 20.11.2026.
- **S5:** [Strava API Brand Guidelines](https://developers.strava.com/guidelines/). Logos, Benennung und Verlinkung. Seite nennt Revision 29.09.2025. Prüfdatum 20.11.2026.
- **S6:** [Getting Started](https://developers.strava.com/docs/getting-started/). Abopflicht, Registrierung, Single Player Mode und Webhookpflicht. Prüfdatum 20.11.2026.
- **S7:** [API Agreement](https://www.strava.com/legal/api). Wirksam 01.06.2026. Begriffe, zulässige Nutzung und Uploads. Prüfdatum 20.11.2026.
- **S8:** [API Policy](https://www.strava.com/legal/api_policy). Wirksam 01.06.2026. Zugriffsstufen, Datenschutz, Speicherfristen, Löschung und Nutzungseinschränkungen. Prüfdatum 20.11.2026.
- **S9:** [Upload Activity API-Referenz](https://developers.strava.com/docs/reference/#api-Uploads-createUpload) und [Create Activity](https://developers.strava.com/docs/reference/#api-Activities-createActivity). Parametervergleich, insbesondere Sichtbarkeit. Prüfdatum 20.11.2026.
- **S10:** [Garmin TrainingCenterDatabase v2 XSD](https://www8.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd). TCX-Sportart, Zeit, Trackpoints, Pflichtfelder und Quellen. Prüfdatum 20.11.2026.
- **S11:** [Garmin ActivityExtension v2 XSD](https://www8.garmin.com/xmlschemas/ActivityExtensionv2.xsd). `TPX`, `Watts`, Radkadenz und Wertebereiche. Prüfdatum 20.11.2026.
- **S12:** [Virtual Trainer Activities on Strava](https://support.strava.com/en-us/articles/15401857-virtual-trainer-activities-on-strava). Ursprüngliche virtuelle Klassifikation und Leaderboards. Seite nennt 17.09.2026. Prüfdatum 20.11.2026.

Codequellen sind lokale Inspektionen am **20.11.2026**, nicht bloße Aussagen aus Planungsdokumenten:

- **C1:** [AuthService](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/server/src/auth/auth.service.ts), [Schema](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/server/src/auth/auth.schema.ts), [Guard](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/server/src/auth/auth.guard.ts), [Controller](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/server/src/auth/auth.controller.ts) und [SessionPrincipal](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/server/src/auth/auth-request.ts).
- **C2:** [AppModule](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/server/src/app.module.ts), [Datenbankprovider](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/server/src/database/drizzle.provider.ts), [Migration](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/server/drizzle/0000_steep_trish_tilby.sql), [Konfiguration](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/server/src/config.ts) und [Testinitialisierung](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/server/src/testing/test-bootstrap.spec.ts).
- **C3:** [Fahrttypen und Schemas](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/packages/shared/src/ride.ts) und [vorhandene API-Exporte](https://github.com/henrysachs/voltonaut/blob/11bab31b27e228bd08b814496c4eb3653afa31ae/packages/shared/src/api/index.ts).
- **C4:** [Client-Sync-Verzeichnis](https://github.com/henrysachs/voltonaut/tree/11bab31b27e228bd08b814496c4eb3653afa31ae/apps/web/src/sync).
- **C5:** [Architektur](../01-architecture.md), [Backend](../08-backend.md), [Roadmap E5 und E10](../07-roadmap.md), [E5-02](../specs/E5-02-server-auth-foundation.md), [E5-03](../specs/E5-03-cloudflare-access-oidc.md), [ADR-013](../decisions/ADR-013-cloudflare-access-oidc.md), [Abhängigkeiten](../dependencies.md) und [Tests](../10-testing.md), jeweils lokaler Stand bei `11bab31`. Diese Quellen beschreiben teils Ziele. Widersprüche zum Code sind oben ausdrücklich markiert.
