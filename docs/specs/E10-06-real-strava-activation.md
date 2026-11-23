# Spec E10-06 – Echte Strava-Nutzung aktivieren

- **Auftrag:** Henry fordert am 21.11.2026 ausdrücklich, Strava zu aktivieren und vollständig funktionsfähig zu machen.
- **Basis:** Produktiver Stand `916edbb070ee5c3ffaeea5836cd91dfed3410836`.
- **Integrationsbasis:** Main `415cffe217dae06a6b4ada7a0e1cbf26d7314606` mit Mitgliedschaft/Admin, Sprint-/KOM-Vorschau und reinen Reward-Angeboten.
- **Status:** Implementiert, am Artefakt softwaregeprüft und auf API `a504e35` serverseitig aktiviert. Echte Anwendungssubscription registriert und geladen. Der Budgetfix `61ca9c0` besteht beide nativen PR-Gates und alle drei Main-Prüfjobs unverändert. Persönlicher Pilot und Bereitstellung dieses nachfolgenden Queryplan-Fixes bleiben offen.
- **Module:** Dedizierte private Strava-Provisionierung, Compose, Server `strava`, vorhandene Uploadoberfläche und Verifikation.

## Ziel

Ein berechtigter Nutzer verbindet sein echtes Strava-Konto und gibt eine zulässige eigene Fahrt bewusst frei. Gespeicherte Token, Einwilligungen und Versandbelege bleiben bei Neustarts konsistent. Die bestehende OIDC-Konfiguration wird weder ersetzt noch rotiert.

## Feste Grenzen

Der Operator darf den persönlichen Strava-OAuth-Klick nicht vortäuschen. Normal/Premium/Pro und VIP begrenzen diese Funktion vorerst nicht. Sim, beschleunigte Zeit, unvollständiges Journal und ungeeignete Quellenfenster bleiben gesperrt. BLE-Selbstauskunft ist kein Hardwareattest.

Henry hat den Betrieb ohne Backup gewählt. Es werden weder Backupressourcen noch ein neuer Tarif angelegt. Ein verlorener Verschlüsselungsschlüssel kann vorhandene Strava-Tokens unlesbar machen. Ein Ersatzschlüssel wird bei vorhandenem Chiffrat nicht blind neu erzeugt.

## Abnahmekriterien

- [x] AK1 – Ein eigenes Provisionierungsprofil verwendet ausschließlich vorhandene Strava-Client-Secrets aus GitHub. Manueller Main-Start, Produktionsfreigabe, gepinnter SSH-Host und private stdin-Übergabe bleiben erhalten. OIDC-Datei und ihre bisherigen Eigenschaften bleiben unverändert.
- [x] AK2 – Schlüsselmaterial entsteht einmalig kryptografisch sicher auf dem VPS, bleibt privat mit Modus 600 und gelangt nicht in CI, Prozessargumente, Logs, Frontend oder Image. Wiederholung und konkurrierende Provisionierung erhalten den bestehenden Schlüssel. Unsichere/abweichende Bestände werden nicht ersetzt.
- [x] AK3 – Die API erhält echte Strava-Konfiguration aus einer getrennten privaten Datei. Ohne Datei bleiben sichere Defaults erhalten. Aktivierung wählt ausdrücklich `declared_ble_v1`, ohne Herkunft oder reale Trainingsleistung zu attestieren.
- [x] AK4 – Verbindung, Athletenbindung und Einzelfahrtfreigabe bleiben getrennt. Höchstens ein externer Upload-POST je Fahrt, keine blinde Wiederholung bei unklarem Ergebnis, bekannte Upload-IDs bleiben bei Pollfehlern und Neustarts erhalten.
- [x] AK5 – Aktuelle offizielle Verträge für Multipart, VirtualRide, TCX, `visibility=only_me`, Scopes, Refreshrotation und appweite Limits sind belegt. Eine angefragte Sichtbarkeit wird nicht als tatsächlich bestätigte Strava-Privatsichtbarkeit ausgegeben.
- [x] AK6 – Erforderliche Deautorisierungs-Webhooks haben einen engen, geprüften Vertrag. Ein ungeprüfter öffentlicher POST darf weder eigene Aufnahmen löschen noch eine neue Verbindung anhand eines alten Ereignisses dauerhaft sperren. Subscription-Setup verändert keine fremde bestehende Subscription.
- [x] AK7 – Normales Gate, Build, sichere Provisionierungs-/Containerproben, ursprüngliche zwölf gebaute Auslieferungsfälle, aktuelle Anbietergegenproben und unabhängiges Review bestehen. Keine Zeitlimits, Assertions, Datenfrische oder Grafikqualität gelockert. Der erneute native Budgettimeout ist mit unverändertem Originaltest durch Wiederverwendung vorbereiteter Abfragen behoben; fünf native vollständige Gates des Fixes bestehen.
- [x] AK8 – Der tatsächliche Produktionsstand, private Konfigurationspräsenz, unverändertes OIDC, Callback-/Logprüfung und verbleibende menschliche Abnahmen sind belegt. Persönlicher OAuth, echte zulässige Fahrt und sichtbare Strava-Verarbeitung bleiben bis zum gemeinsamen Pilot explizit offen.

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

Die native CI überschritt anschließend im langen Budgettest dessen unveränderte Frist. Die Entkopplung wiederholter Athleten-HTTP-Aufrufe reichte nicht. Eine gezielte Diagnose fand einen Fehler der neuen Testgegenstelle: Sie lehnte nach erfolgreichem echtem Refresh das neu ausgegebene Token ab und verursachte 483 weitere Refresh-Aufrufe. Die Gegenstelle lernt nun ausschließlich erfolgreich ausgegebene Tokens. Neue dauerhafte Regressionen prüfen die Äquivalenz zum echten lokalen HTTP-Anbieter sowie abgelehnte Refresh-Antworten. Der vollständige 1000-Schritte-Budgetfall verlangt zusätzlich genau einen Refresh, bestätigte Hinweisrevision 499 und Tokenrevision 1. Alle bisherigen Assertions, Quoten und Fristen bleiben erhalten. Gegen den alten Limiter scheitert derselbe Fall weiterhin am ausbleibenden späteren Poll.

Das reguläre Gate nach dieser unabhängig geprüften Testkorrektur besteht mit 892 Unit-/Integrationstests und 49 Browserfällen, ebenso der normale Build. Produktquellen und gebauter Server bleiben bytegleich. Belege sind `strava-native-diagnosis/`, `strava-policy-rotation-fix/` und `strava-rotation-readonly-review-HF6nJh/`. Diese lokalen Nachweise ersetzen nicht die noch ausstehende native Prüfung des endgültigen Heads.

Nach Integration von Main `415cffe` bestehen das reguläre Gate mit 1050 Unit-/Integrationstests und 50 Browserfällen, der normale Build und erneut alle zwölf ursprünglichen gebauten Auslieferungsfälle. Alle zwölf Manifeste enthalten dieselben 515 Anwendungsquellen und entsprechen dem aktuellen Arbeitsbaum. Ihre kompilierten Server entsprechen dem normalen Build mit SHA-256 `ab379e282abc39b59d2acbb5fc86a00e7db6630ddde31e6a868385d795a05af0`. Engine und Rules bleiben gegenüber Main unverändert.

Belege sind `strava-main415-awake-{check,build,twelve}.log`, `strava-main415-twelve-source-proof.json` und `full-ride-delivery-proof-suite-pQXMLp/`. Zwei lokale Vorläufe bleiben erhalten: zuerst fehlte nach dem Workspacewechsel die normale Installation, danach unterbrach der protokollierte Mac-Ruhezustand den Build-Hook. Installation mit unverändertem Lockfile und eine nur für den abschließenden Prozess geltende Wachhalte-Anforderung beheben diese Umgebungsbedingungen. Kein Test, Timeout, Ressourcenlimit oder Produktcode wurde dafür geändert.

## Tatsächliche Serveraktivierung

Henry hat die Produktionsläufe `45226134599` für das Strava-Profil und `45225736978` für die API persönlich freigegeben. Der tatsächliche API-Stand `a504e356ea7cad49b99cb0e8dd513f1efc0fc24d` läuft gesund mit acht Migrationen. Schlüssel- und Verify-Token entstanden ausschließlich privat auf dem VPS. Die beiden ausdrücklich übertragenen und hashgeprüften Operatorquellen bestätigten nach der echten Subscription-Erstellung den Appbezug und den kanonischen Callback. Der anschließende API-Recreate lädt die private Registrierungsdatei unter demselben freigegebenen Image und Volume. Die private OIDC-/Schlüsselkonfiguration bleibt erhalten. Das ist eine Anwendungssubscription, keine persönliche Kontoverbindung.

Die Runtime bestätigt OIDC, aktiviertes Strava, vorhandenen Schlüssel, Verify-Token und Subscription-ID sowie `declared_ble_v1`. Öffentliche GET-Proben prüfen Health, Authgrenzen, CORS und Challenge-Ablehnung. Die unabhängige Betriebsprüfung wiederholt diese HTTP-Proben und prüft die privaten Receipts auf Konsistenz; sie behauptet keine eigene SSH-Abnahme der privaten Werte. Containerlog-Nachweis und persönliche Pilotgrenzen sind ausdrücklich eingegrenzt. Primärbelege liegen unter `$TMPDIR/opencode/strava-a504-activation-handoff.md` und `strava-activation-independent-review.md`.

Die folgenden Main-Läufe überschritten den ursprünglichen Budgettest wieder, trotz der vorherigen grünen baumgleichen Feature-CI. [Issue #35](https://github.com/henrysachs/voltonaut/issues/35) ist danach durch den unabhängig geprüften Queryplan-Fix aus PR #37, Main `61ca9c0`, geschlossen. Beide nativen PR-Gates und alle drei Main-Prüfjobs bestehen mit 1061 Tests und 50 Browserfällen. Kein ursprünglicher Test, Timeout, Schritt, Quotenwert oder Transaktionsschutz wurde verändert. Der diagnostische Draft #36 ist ohne Merge geschlossen. Der Webclient `61ca9c0` ist nach diesen Prüfungen veröffentlicht und unabhängig mit allen 17 gebauten Dateien sowie gewöhnlichem Sim-/Aufnahme-/TCX-Browserfluss geprüft. Die kompatible API `a504e35` hat dieselben HTTP-Verträge und aktiviertes Strava; die neue private SQL-Implementierung wartet auf ihre eigene API-Produktionsfreigabe.

## Menschliche Abnahmen

Henry bestätigt Callbackdomain und verfügbare Athletenkapazität im Strava-Dashboard. Er führt persönlichen Login und OAuth-Klick selbst aus. Eine ausdrücklich freigegebene reale Fahrt prüft VirtualRide-Klassifikation, Messwerte, Zeit, Sichtbarkeit und fertige Verarbeitung. Issue #26 ist durch die gesondert genehmigte CI-Lastkorrektur aus ADR-023 geschlossen, nicht durch eine Rendereränderung oder Hardwareabnahme.
