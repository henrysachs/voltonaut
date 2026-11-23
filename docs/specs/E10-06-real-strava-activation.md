# Spec E10-06 – Echte Strava-Nutzung aktivieren

- **Auftrag:** Henry fordert am 21.11.2026 ausdrücklich, Strava zu aktivieren und vollständig funktionsfähig zu machen.
- **Basis:** Produktiver Stand `916edbb070ee5c3ffaeea5836cd91dfed3410836`.
- **Integrationsbasis:** Mitgliedschafts-Main `3afcfc59f4c3d1dbcbe4fb5e6a6d2ada5c224055`.
- **Status:** Implementiert, gemeinsam am gebauten Artefakt softwaregeprüft und nach Korrekturen unabhängig geprüft. Die gemeinsame Gesamtprüfung besteht mit der freigegebenen CI-Reihenfolge. CI des endgültigen Heads und tatsächliche Aktivierung bleiben offen. Bestehende Produktion bleibt unverändert.
- **Module:** Dedizierte private Strava-Provisionierung, Compose, Server `strava`, vorhandene Uploadoberfläche und Verifikation.

## Ziel

Ein berechtigter Nutzer verbindet sein echtes Strava-Konto und gibt eine zulässige eigene Fahrt bewusst frei. Gespeicherte Token, Einwilligungen und Versandbelege bleiben bei Neustarts konsistent. Die bestehende OIDC-Konfiguration wird weder ersetzt noch rotiert.

## Feste Grenzen

Der Operator darf den persönlichen Strava-OAuth-Klick nicht vortäuschen. Normal/Premium/Pro und VIP begrenzen diese Funktion vorerst nicht. Sim, beschleunigte Zeit, unvollständiges Journal und ungeeignete Quellenfenster bleiben gesperrt. BLE-Selbstauskunft ist kein Hardwareattest.

Henry hat den Betrieb ohne Backup gewählt. Es werden weder Backupressourcen noch ein neuer Tarif angelegt. Ein verlorener Verschlüsselungsschlüssel kann vorhandene Strava-Tokens unlesbar machen. Ein Ersatzschlüssel wird bei vorhandenem Chiffrat nicht blind neu erzeugt.

## Abnahmekriterien

- [ ] AK1 – Ein eigenes Provisionierungsprofil verwendet ausschließlich vorhandene Strava-Client-Secrets aus GitHub. Manueller Main-Start, Produktionsfreigabe, gepinnter SSH-Host und private stdin-Übergabe bleiben erhalten. OIDC-Datei und ihre bisherigen Eigenschaften bleiben unverändert.
- [ ] AK2 – Schlüsselmaterial entsteht einmalig kryptografisch sicher auf dem VPS, bleibt privat mit Modus 600 und gelangt nicht in CI, Prozessargumente, Logs, Frontend oder Image. Wiederholung und konkurrierende Provisionierung erhalten den bestehenden Schlüssel. Unsichere/abweichende Bestände werden nicht ersetzt.
- [ ] AK3 – Die API erhält echte Strava-Konfiguration aus einer getrennten privaten Datei. Ohne Datei bleiben sichere Defaults erhalten. Aktivierung wählt ausdrücklich `declared_ble_v1`, ohne Herkunft oder reale Trainingsleistung zu attestieren.
- [x] AK4 – Verbindung, Athletenbindung und Einzelfahrtfreigabe bleiben getrennt. Höchstens ein externer Upload-POST je Fahrt, keine blinde Wiederholung bei unklarem Ergebnis, bekannte Upload-IDs bleiben bei Pollfehlern und Neustarts erhalten.
- [x] AK5 – Aktuelle offizielle Verträge für Multipart, VirtualRide, TCX, `visibility=only_me`, Scopes, Refreshrotation und appweite Limits sind belegt. Eine angefragte Sichtbarkeit wird nicht als tatsächlich bestätigte Strava-Privatsichtbarkeit ausgegeben.
- [x] AK6 – Erforderliche Deautorisierungs-Webhooks haben einen engen, geprüften Vertrag. Ein ungeprüfter öffentlicher POST darf weder eigene Aufnahmen löschen noch eine neue Verbindung anhand eines alten Ereignisses dauerhaft sperren. Subscription-Setup verändert keine fremde bestehende Subscription.
- [x] AK7 – Normales Gate, Build, sichere Provisionierungs-/Containerproben, ursprüngliche zwölf gebaute Auslieferungsfälle, aktuelle Anbietergegenproben und unabhängiges Review bestehen. Keine Zeitlimits, Assertions, Datenfrische oder Grafikqualität gelockert.
- [ ] AK8 – Der tatsächliche Produktionsstand, private Konfigurationspräsenz, unverändertes OIDC, Callback-/Logprüfung und verbleibende menschliche Abnahmen sind belegt. Persönlicher OAuth, echte zulässige Fahrt und sichtbare Strava-Verarbeitung bleiben bis zum gemeinsamen Pilot explizit offen.

## Recherche und Architekturfragen

Die offizielle Upload-Referenz dokumentiert `visibility=only_me`; die allgemeinere Uploadanleitung lässt den Parameter aus. Der vorhandene Parameter und die ehrliche Einschränkung bleiben erhalten. Kein unnötiger Wechsel der Einwilligungsrevision allein aufgrund dieser Auslassung.

Ein getrenntes optionales `strava.env` konfiguriert den bestehenden API-Dienst. Ein Sendervertrag darf keinen Ersatzschlüssel liefern. Öffentliche Ereignisse bleiben ungeprüfte Hinweise. Die neue Datenmigration folgt der bereits integrierten Mitgliedschaftstabelle.

[ADR-022](../decisions/ADR-022-real-strava-provisioning.md) wählt öffentlich validierte Hinweise mit anschließender Anbieterprüfung statt geheimer Callback-URLs. Drei additive Connection-Felder speichern Hinweisrevision, bestätigte Revision und frühesten Prüfzeitpunkt. Der Scheduler nutzt aktuelle Credential-Leases und appweite Read-Budgets. Ein generischer 400/401-Refreshfehler ist kein Beweis einer Deautorisierung. Eine spezifische Strava-Antwortform muss als dokumentierter oder tatsächlicher sicherer Wire-Nachweis vorliegen; bis dahin bleibt die Verarbeitung konservativ.

Eine Operator-Registrierung läuft erst nach dem HTTP-Start. Sie liest vorhandene Subscriptions, übernimmt nur passende Callbacks und legt ausschließlich bei Abwesenheit neu an. Die Subscription-ID bleibt in einer eigenen privaten Registrierungsdatei erhalten. Verbindungsstart ohne bestätigte Registrierung bleibt gesperrt. Die generierte `0007_strava_authorization_checks` folgt der unveränderten `0006_account_membership_admin`. Historische SQL- und Snapshot-Dateien bleiben erhalten.

## Testplan

Mit echten temporären Dateien und Prozessen Schlüsselbeständigkeit, Races, Crashpunkte und identisches OIDC prüfen. Tatsächlicher Compose-/Containerprozess muss Literalwerte erhalten. Lokale HTTP-Anbieter simulieren Zustimmungen, Verarbeitung, Rotation, Rate-Limits, Deautorisierung, Antwortverlust und Neustart. Bekannte Originalgegenproben bleiben unverändert. Produktionsprüfungen lesen keine Secrets aus und authentifizieren den Agenten nicht als Henry.

## Isolierte Software- und Reviewnachweise

Die korrigierte Einheit besteht `E2E_PORT=5242 CI=1 mise run check` mit 860 Unit-Tests und 49 Browserfällen. Normaler Build und ursprüngliche zwölf gebaute Auslieferungsfälle bestehen. Die Gegenstellen sind lokale HTTP-Anbieter und native Geräte-Fakes, keine reale Strava- oder Hardwareabnahme. Konfigurations- und Operatorproben führen tatsächliches Compose, einen Node-Container, private Dateien und den übertragenen Python-Operator aus. Die 30 Pythonfälle bestehen mit zwei lokalen Root-only-Skips. Beide Eigentümerfälle wurden zusätzlich als Container-root geprüft. Der vollständige Docker-/Backup-Proof wurde für diesen Stand nicht ausgeführt.

Das erste unabhängige Sicherheitsreview fand erschöpfbares Lesebudget durch gefälschte Hinweise und eine umgehbare Bodygrenze. Ein weiteres Review und eine Elternprobe belegten zusätzliche Fragment- und Absolute-Form-Request-Targets. Die Korrekturen erhielten vor der Produktänderung jeweils korrekte rote Regressionen. Alle ursprünglichen Belege bleiben erhalten.

Das frische Budgetreview führt einen Angriff über 1000 kontrollierte Scheduler-Minuten gegen echte SQLite-Dateien und einen lokalen HTTP-Anbieter aus. Nach 499 Hinweis-GETs liefert ein späterer bekannter Upload auch nach Datenbankneustart. Die Tagesnutzung beträgt danach 501 von 1000 Reads. Zwei parallele Prozesse bestätigen denselben reservierten Anteil. Gegen den alten Limiter scheitert die korrigierte Probe weiterhin mit erschöpftem Budget und ausbleibendem späterem Poll. Zwei ursprüngliche private Vorbedingungen bleiben historisch rot, weil sie erst den nun verhinderten Verbrauch oder einen Hinweis bei unbekannter Kapazität verlangen. Keine Produktionsquote wurde dafür erhöht.

Das frische Parserreview sendet 102 reale HTTP-Requests. Dasselbe 1.048.723-Byte-JSON, das der alte Build über rohe Fragment- und Absolute-Form-Targets annahm, erhält im aktuellen Build 413. Exakt 8192 Byte bleiben zulässig, 8193 werden abgelehnt. Chunked, UTF-8, Charset, falscher Medientyp und Kompression sind geprüft. Allgemeine Fahrtenrequests behalten 8 MiB. Nachrichten unterscheiden 8 KiB und 8 MiB, ohne Nutzlasten auszugeben.

Private Primärbelege liegen unter `$TMPDIR/opencode/`: `strava-independent-p1-c3f1wncn/`, `strava-independent-p2-0bYuNplJ/`, `strava-parser-root-fix.md`, `strava-parser-parent-final-proof.json` und `full-ride-delivery-proof-suite-wp1meZ/`. Diese Nachweise betreffen die isolierte Einheit mit vorläufiger Migration. Die folgenden gemeinsamen Prüfungen ergänzen sie. AK1 bis AK3 bleiben bis zur tatsächlichen privaten Produktionsprovisionierung und Aktivierung offen.

## Gemeinsame Migration

Die Elternintegration behält alle 14 veröffentlichten SQL- und Snapshot-Dateien bis einschließlich Main-`0006` bytegleich. Die ersten sieben Journaleinträge bleiben unverändert. Drizzle Kit erzeugt aus dem gemeinsamen Root-Schema die finale `0007` mit genau den drei bereits geprüften `ALTER TABLE`-Anweisungen. Der neue Snapshot erhält `account_status` und alle übrigen Tabellen unverändert. Die vorläufige, nie produktiv angewendete Strava-`0006` entfällt.

17 Datenbanktests und der Typecheck bestehen am gemeinsamen Stand. Upgrades aus sechs und sieben tatsächlichen Migrationen erhalten Chiffrate, Sessions, eigene Fahrten und vorhandenes Pro/VIP/Admin einschließlich erneutem Öffnen. Der Mitgliedschaftstest vergleicht weiterhin sämtliche 16 alten Strava-Spalten und prüft die drei neuen Standardwerte separat. Die Gesamtfolge umfasst jetzt acht Migrationen. Dies ist noch kein Beleg für den vollständigen gemeinsamen Browserfluss oder den Produktionsdeploy.

Die anschließende gemeinsame Artefaktprüfung besteht mit normalem Build, dem unveränderten Admin-Browserfall und dem tatsächlichen Produktionspaket. Rollenvergabe, unabhängiges Pro/VIP, Kontowechsel, fortlaufende Sim-Fahrt und Netzwerkgrenzen sind geprüft. Der bestehende Paket-Smoke bestätigt alle acht Migrationen. Nach Korrektur einer lediglich noch im Git-Index erfassten gelöschten vorläufigen SQL-Datei bestehen auch die ursprünglichen zwölf Auslieferungsfälle unverändert. Alle zwölf Anwendungsquellmanifeste sind identisch und während des Laufs stabil. Der fehlgeschlagene Manifestvorlauf bleibt erhalten, keine Assertion wurde dafür geändert.

Primärbelege sind `joined-software-verification.md`, `joined-membership-browser-fKHpcz/`, `joined-membership-package-46xozX/`, `joined-twelve-source-proof.json` und `full-ride-delivery-proof-suite-xyVdHo/` unter demselben privaten Belegverzeichnis. Nach Integration der gesondert freigegebenen CI-Reihenfolge bestehen `E2E_PORT=5242 CI=1 mise run check` mit 889 Unit-Tests und den unveränderten 49 Browserfällen sowie der normale Build. Belege: `joined-final-sequenced-check.log` und `joined-final-sequenced-build.log`. Keine Bereitstellung oder reale Fahrtabnahme behauptet.

## Menschliche Abnahmen

Henry bestätigt Callbackdomain und verfügbare Athletenkapazität im Strava-Dashboard. Er führt persönlichen Login und OAuth-Klick selbst aus. Eine ausdrücklich freigegebene reale Fahrt prüft VirtualRide-Klassifikation, Messwerte, Zeit, Sichtbarkeit und fertige Verarbeitung. Der Rendererfehler aus #26 bleibt ein eigener Auftrag.
