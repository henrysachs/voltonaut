# Strava aktivieren

Nur der Parent führt diese Schritte nach Review, grünen Gates und Produktionsfreigabe aus. Persönliches OAuth bleibt beim Nutzer. Dieser Ablauf behauptet keinen abgeschlossenen Anbieterpilot.

1. Integriere die additive Migration gemeinsam mit der Mitgliedschaftsmigration. Der isolierte Entwurf heißt vorläufig `0006_strava_authorization_checks`. Regeneriere gemeinsam SQL-Metadaten und Snapshot für die finale `0007`. Ändere keine historischen Migrationen.
2. Starte den bestehenden manuellen Workflow `provision-server` auf `main` mit Profil `strava`. Verwende die bestehende Produktionsfreigabe. Der Sender liest ausschließlich vorhandene Strava-Client-Secrets. Der Empfänger erzeugt Schlüsselmaterial nur bei nachweislich leerem verschlüsseltem Verbindungsbestand. Unlesbare Bestände führen zum Abbruch.
3. Stelle das geprüfte API-Artefakt bereit. Prüfe Health, unverändertes OIDC und deaktivierte Querylogs. Die optionale `strava.env` aktiviert ausdrücklich `declared_ble_v1`. Das ist BLE-Selbstauskunft, kein Hardwareattest. Ohne Registrierungsdatei bleibt OAuth gesperrt, während die Challenge erreichbar ist.
4. Übertrage ausdrücklich **beide** geprüften Dateien `deploy/provision_env.py` und `deploy/strava_subscription.py` über den bestehenden gepinnten SSH-Weg in ein neues privates Operatorverzeichnis auf dem VPS. Der normale Deploy-Tar überträgt diese Dateien nicht. Vergleiche ihre SHA-256-Hashes vor der Ausführung.
5. Führe dort `python3 strava_subscription.py register` aus. Der Operator liest ausschließlich die feste private VPS-Konfiguration. Fehlender Bestand erlaubt genau einen Erstellungsversuch. Passender Bestand wird übernommen. Fremde Callbacks werden nicht gelöscht. Unklare Antworten verlangen erneutes Lesen, keinen blinden Ersatz. Erfolg schreibt ausschließlich die private `strava-webhook.env` mit Modus 600.
6. Lade die neue Registrierungsdatei durch kontrolliertes Neuerstellen desselben API-Dienstes mit dem bestätigten aktuellen Image-Tag. Prüfe erneut Health und OIDC. Ändere weder SQLite-Volume noch Schlüsseldatei.

Keine Datei enthält einen Schlüssel aus CI. Die beiden lokal erzeugten Geheimnisse bleiben auf dem VPS. Compose überschreibt sie nicht durch leere Strava-Umgebungsdefaults. Ein privates temporäres Abbild für Compose wird nach dem Lesen entfernt. Es gibt weiterhin kein Backup und keinen zugesagten Restore.

## Offene Anbieterabnahmen

Der Nutzer bestätigt Callbackdomain und Athletenkapazität im Dashboard und autorisiert sein Konto selbst. Eine echte zulässige Fahrt prüft VirtualRide-Klassifikation, Messwerte, Zeit, Sichtbarkeit und fertige Verarbeitung. `201` bleibt Verarbeitung. `visibility=only_me` ist eine dokumentierte Anforderung, keine Sichtbarkeitsgarantie.

Die [Webhookbeschreibung](https://developers.strava.com/docs/webhooks/) dokumentiert keinen POST-Signaturvertrag. Das [offizielle Beispiel](https://developers.strava.com/docs/webhookexample/) zeigt dagegen `X-Strava-Signature` mit einem getrennten Signing-Secret, ohne dessen Provisionierung zu erklären. Dieser Entwurf behandelt POSTs weiterhin ausschließlich als ungeprüfte Hinweise. Er behauptet weder Signaturprüfung noch abschließende Policykonformität. Eigene Daten und bisherige Versandbelege werden nicht stillschweigend entfernt.

Ungeprüfte Hinweise dürfen höchstens die abgerundete Hälfte jeder tatsächlichen API-Budgetgrenze verwenden. Bekannte Uploads und Polls behalten volle Grenzen. Das unbekannte Startbudget von 1 erlaubt keinen Hinweis-GET. Ohne vorherige bekannte Ressourcenantwort können Hinweise daher bis zum Reset unbestätigt bleiben. Später gelernte Header ziehen eine bereits zurückgestellte Prüfung nicht vor. Keine Quoten erhöhen oder künstlichen Warmup-GETs senden, um diesen Zustand als geprüfte Deautorisierung auszugeben.

Weitere Primärverträge, gelesen am 21.11.2026: [Uploadreferenz](https://developers.strava.com/docs/reference/#api-Uploads-createUpload), [Uploads](https://developers.strava.com/docs/uploads/), [Authentifizierung](https://developers.strava.com/docs/authentication/), [Limits](https://developers.strava.com/docs/rate-limits/) und [vorgeschriebene Webhooks](https://developers.strava.com/docs/getting-started/#webhooks). Standardlimits bleiben 200/2000 insgesamt und 100/1000 lesend. `external_id` bietet keine dokumentierte transaktionale Deduplizierung.
