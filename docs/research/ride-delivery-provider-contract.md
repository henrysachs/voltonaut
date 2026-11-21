# Strava-Vertrag für die Fahrt-Auslieferung

Öffentliche Primärquellen erneut gelesen am 20.11.2026. Keine OAuth-Anfrage, kein Athletenzugriff und kein echter Upload wurden ausgeführt. Diese Referenz ergänzt die historische [Recherche](strava-integration.md), deren Codebefunde einen älteren Commit beschreiben.

## Upload und Status

- `POST https://www.strava.com/api/v3/uploads` verlangt `activity:write` und Multipart mit Datei und `data_type`.
- `sport_type=VirtualRide` ist in der Uploadanleitung dokumentiert. `trainer=1` erzwingt stationär. TCX ohne GPS ist zulässig. Jeder Trackpoint benötigt einen Zeitstempel.
- Die API-Referenz dokumentiert `visibility=only_me` oder `followers_only` als restriktivere Sichtbarkeit. Die Uploadanleitung führt diesen Parameter nicht auf. Eine gesendete Anforderung ist kein hier bewiesener echter Sichtbarkeitspilot.
- HTTP 201 bedeutet eingereiht, nicht fertig. Die bekannte Upload-ID gehört dauerhaft zum Auftrag. `GET /api/v3/uploads/:id` darf nicht häufiger als einmal pro Sekunde erfolgen.
- `external_id` soll eindeutig sein. Es gibt keine dokumentierte transaktionale Idempotenzgarantie und keine dokumentierte Uploadsuche nach diesem Feld.
- Ein Timeout nach möglichem POST-Versand oder ein Absturz während des Versands ist deshalb kein sicherer Fehlschlag. Ohne bekannte Remote-ID darf kein automatischer neuer POST folgen.
- `error` und `status` sind menschliche Texte und können HTML enthalten. Eine nichtleere Fehlermeldung hat Vorrang vor einer Activity-ID.
- Upload-IDs können 64 Bit groß sein. Dafür ist `id_str` dokumentiert. Für `activity_id` ist kein entsprechendes Stringfeld zugesichert. Bereits gerundete JavaScript-Zahlen dürfen nicht als sichere IDs gespeichert werden.

Quellen: [Uploadanleitung](https://developers.strava.com/docs/uploads/), [Upload-Referenz](https://developers.strava.com/docs/reference/#api-Uploads-createUpload).

## Rotation und Widerruf

- Ressourcenaufrufe verwenden einen noch gültigen Access-Token. Maßgeblich ist das zurückgegebene `expires_at`.
- Refresh verwendet den zuletzt erhaltenen Refresh-Token. Jede erfolgreiche Tokenantwort liefert einen Refresh-Token. Ein neuer Refresh-Token kann den alten sofort ungültig machen.
- Ein verlorener Refresh-Response kann deshalb eine unklare Rotation hinterlassen. Ein unverändert gespeicherter alter Token beweist keine weitere Gültigkeit.
- Seit 01.06.2026 ist `POST /oauth/revoke` mit Basic-Clientauthentifizierung und Formularfeld `token` die empfohlene Deautorisierung. HTTP 200 hat keinen Body. HTTP 503 ist als wiederholbar dokumentiert.

Quelle: [Authentifizierung](https://developers.strava.com/docs/authentication/).

## Kontingente

- Limits gelten appweit. Neben dem Gesamtlimit gibt es ein Nicht-Upload-Limit. Uploadstatus-GETs fallen unter beide.
- Die vier Header `X-RateLimit-Limit`, `X-RateLimit-Usage`, `X-ReadRateLimit-Limit` und `X-ReadRateLimit-Usage` liefern tatsächliche Kontingente.
- Kurzzeitfenster erneuern sich um Minute 0, 15, 30 und 45. Das Tagesfenster erneuert sich um Mitternacht UTC.
- Überschreitung liefert HTTP 429. Die Dokumentation garantiert keinen `Retry-After`-Header. Wiederholte Anfragen trotz Kurzzeitlimit zählen weiter zum Tageslimit.

Quelle: [Rate Limits](https://developers.strava.com/docs/rate-limits/).
