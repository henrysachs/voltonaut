# ADR-020 – Einmalige Produktionsprovisionierung und optionales Backup

- **Status:** Angenommen. Henry genehmigt am 21.11.2026 ausdrücklich den Provisionierungs-Workflow und entscheidet „wir brauchen kein backup“.
- **Bezug:** ADR-004, ADR-009, ADR-013, Spec E0-04.

## Kontext

Web und API sollen erstmals gemeinsam produktiv laufen. Die eingeschränkte OIDC-Anwendung existiert. Ihr Client-Secret liegt nur als GitHub-Environment-Secret vor und lässt sich nicht zurücklesen. Auf dem VPS existiert noch keine Voltonaut-Konfiguration.

Die bisherige Compose-Datei verlangt für jeden Start Litestream und S3-Zugangsdaten. Das widerspricht Henrys nun ausdrücklich gewähltem Betrieb ohne Backup. Vorhandene Datenträger dürfen deshalb nicht gelöscht oder durch flüchtigen Speicher ersetzt werden.

## Entscheidung

Ein dedizierter, einmaliger Provisionierungs-Workflow darf vorhandene OIDC-Werte aus dem GitHub-Environment `production` verschlüsselt auf den VPS übertragen. Er wird ausschließlich manuell auf `main` gestartet. Die vorhandene manuelle Produktionsfreigabe bleibt unverändert. PR-Läufe erhalten keinen Zugriff auf Produktionssecrets.

Der Workflow verwendet den vorhandenen Deploy-Nutzer, seinen dedizierten SSH-Schlüssel und einen unabhängig geprüften Hostschlüssel. Er schreibt weder Credentialwerte in Logs noch ins Repository, Frontend oder Image. Die Übergabe erfolgt nicht über Prozessargumente. Die private Datei wird mit Modus `600` atomar neu angelegt. Eine vorhandene identische Datei ist ein idempotenter Erfolg. Eine vorhandene andere oder unsichere Datei wird nicht überschrieben.

Der normale Compose-Deploy startet ausschließlich die API mit persistentem SQLite-Volume. OIDC bleibt ausdrücklich konfiguriert. Fehlende OIDC-Werte werden nicht durch Disabled oder Speicher-Mail ersetzt.

Die vorhandene Litestream-Konfiguration bleibt als ausdrücklich ausgewähltes Compose-Overlay nutzbar und getestet. Nur dieser Modus verlangt S3-Zugangsdaten und erfolgreiche Replikations-Healthchecks. Ein API-Deploy ohne Overlay behauptet keine Sicherung oder Wiederherstellbarkeit. Es werden kein R2-Bucket, keine Backup-Credentials und kein neuer Tarif angelegt.

## Alternativen

Eine Übertragung über Chat oder erneute Ausgabe bestehender Secrets wird verworfen. Ein blindes Rotieren des OIDC-Secrets würde bestehende Verbraucher beeinflussen. Die zeitweilige Auswahl von `AUTH_MODE=disabled` wäre kein funktionsfähiger OIDC-Deploy.

Leere oder erfundene S3-Werte im normalen Compose-Vertrag werden verworfen. Sie würden eine nicht vorhandene Sicherung verschleiern. Das Löschen der vorhandenen Backup-Prüfungen ist für den ausdrücklich optionalen Modus ebenfalls nicht nötig.

## Folgen

Neue geschützte Workflow-Dateien sind durch diese konkrete Freigabe und diese ADR abgedeckt. Bestehende Check-, Review-, Deploy- und Environment-Schutzregeln werden nicht abgeschwächt. Der Anwendungscode erhält keine Secrets aus GitHub direkt.

Ohne externes Backup können ein Volume- oder Serververlust und fehlerhafte Datenänderungen dauerhaft Daten kosten. Ein Image-Rollback stellt keinen alten Datenstand wieder her. Diese Einschränkung wird beim Produktionsnachweis ausdrücklich genannt. Die persistente Datenablage, SQLite-WAL, Fremdschlüssel und atomare Fahrtenbelege bleiben unverändert.
