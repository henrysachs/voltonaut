# Spec E5-05 – Autonomer Ausbau zur ersten nutzbaren Fahrt

- **Auftrag:** Henry hat am 20.11.2026 die selbstständige Umsetzung des besprochenen Stands bis zu seiner Rückkehr freigegeben. Integration auf `main` braucht keine weitere PR-Freigabe im Chat. Tests und unabhängige Reviews bleiben Pflicht.
- **Umfang:** Welt, lokale Aufnahme, Accounts/OIDC, Profil- und Fahrtenspeicherung, Offline-Nachlieferung sowie Strava-Verbindung und ausdrücklicher Upload. Nicht die gesamte E6–E10-Roadmap.
- **Status:** Laufender Arbeitsplan. Einzelne grüne Einheiten werden integriert. Offene Abnahmen werden nicht als fertig markiert.

## Prüfkriterium

Der Lauf ist softwareseitig verifiziert, wenn ein Browser im Sim-Modus eine sichtbare Fahrt aufnimmt, lokal speichert und als TCX exportiert. Gegen lokale Testprovider muss derselbe Client sich anmelden, eigene Daten synchronisieren und eine zulässige eigene Fahrt ausdrücklich an den Strava-Testserver übergeben können. Nicht erlaubte Identitäten, fremde Fahrten, fehlende Einwilligung und unsichere Wiederholungen müssen abgewiesen werden.

Jede gelieferte Einheit benötigt `CI=true mise run check`, den betroffenen Build, ein unabhängiges Review und einen Nachweis am tatsächlichen Artefakt. Engine-/Rules-Änderungen benötigen zusätzlich Mutation. Ein reiner Build oder ein Autorenbericht reicht nicht.

Echte BLE-, Widerstands- und Controllerabnahmen bleiben Hardwarearbeit. Persönliche OIDC-/Strava-Zustimmung und ein echter Upload-Pilot benötigen später Henrys Mitwirkung. Testprovider beweisen keine Anbieterfreigabe.

## Aktueller Lieferstand

- Welt und Landschaft sind über PR #9 und #11 integriert und öffentlich veröffentlicht. Der Landschaftsdeploy `a2e0398` funktioniert über `voltonaut.stammkneipe.dev` mit normaler DNS-Auflösung und TLS.
- PR #13 liefert lokale Aufnahme, Persistenz und tatsächlichen TCX-Download auf `main`. Der unabhängige Browsernachweis bestätigt identische, XSD-gültige Downloads nach Reload. Dieser neue Aufnahmestand ist noch nicht öffentlich deployed.
- PR #15 liefert den OIDC-Server auf `main`. Signierender lokaler Provider, Browserbindung, Accountzuordnung, Session, Widerruf und Standalone-Paket sind geprüft. Das ist kein echter Cloudflare-Pilot.
- PR #17 liefert eigene Profile und Fahrten samt additiver Migration auf `main`. PR #16 liefert das Browserkonto. Der [Integrations-PR #19](https://github.com/henrysachs/voltonaut/pull/19) führt diese Browseranbindung mit kontogebundenem manuellem Sync, Outbox und dem aktuellen Bluetooth-Stand zusammen. Das lokale Gesamtgate sowie fünf OIDC- und 14 Sync-Browserfälle sind grün.
- Frühere CI-Läufe scheiterten an BLE-Wiederverbindung und Hintergrundfahrt innerhalb bestehender Zeitgrenzen. Der zusammengeführte Stand benötigt grüne PR-CI vor dem Merge. Timeouts, Assertions und Leitplanken bleiben unverändert. Dieser Integrationsauftrag enthält keinen öffentlichen Deploy.
- Kontogebundene Outbox, reine Replay-V2-Prüfeinheit und serverseitige Strava-Verbindung sind implementiert und lokal geprüft. Die V2-Architektur verwendet vollständige Engine-Aufrufhistorie ab Initialisierung. Öffentliche Pose allein rekonstruiert den verborgenen warmen Zustand nachweislich nicht. V2-Browseraufzeichnung, V2-HTTP-Annahme und Strava-Fahrtupload fehlen weiterhin. Die Zusammenführung gemäß [E0-04](E0-04-current-implementation-integration.md) schließt diese Erweiterungen nicht ab.
- Die Produktions-API bleibt ausgeschaltet. Es fehlen verdrahtete Produktionskonfiguration und nachgewiesenes Backup mit Restore. Der OIDC-Modus benötigt keinen Mailprovider.

## Ausgangsbefund zu Laufbeginn

Die folgenden Punkte beschreiben den Start des Laufs, nicht den aktuellen Lieferstand.

- PR #9 liefert die erste Szene. Der Software-WebGL-Fehler ist in `e6a8873` reproduziert, korrigiert, unabhängig geprüft und in CI grün.
- Der aktuelle öffentliche Web-Deploy basiert noch auf `11bab31`. Er enthält Sim, Physik, Profil und lesendes BLE, nicht die neue Szene.
- Die lokale Aufnahme samt TCX-Download ist implementiert. Das Review fand eine fehlende Fehlererholung nach sechs Stunden. Eine ausdrückliche Verwerfen-Aktion ist test-first ergänzt. Der korrigierte Stand wartet auf sein vollständiges Gate und Nachreview.
- Der Landschaftsausbau läuft getrennt auf Basis der korrigierten Szene.
- Access-App, begrenzte Pilot-Policy und OIDC-Credentials sind eingerichtet. Discovery und JWKS liefern HTTP 200. Der Anwendungscode fehlt noch.
- Strava-Client-Konfiguration liegt nach ausdrücklicher Freigabe in GitHub `production`. Persönliche Tokens werden nicht verwendet. Es gab noch keinen Strava-API-Aufruf.
- Die API ist noch nicht deployed. Produktions-Mailpflicht und fehlende Backup-Konfiguration sind echte Voraussetzungen, keine zu umgehenden Tests.

## Arbeitseinheiten und Reihenfolge

Der Umfang umfasst sechs Funktionsbereiche. Auth, Speicherung und Strava werden bei Bedarf weiter in unabhängig prüfbare PRs geteilt. Kleine geprüfte Einheiten haben Vorrang vor einem einzigen Etappen-PR.

1. **Vorhandene Lieferungen abschließen.** Szene, Deploy-Nachweis und korrigierte lokale Aufnahme prüfen, integrieren und auf aktuellem `main` nachweisen. Nur bekannte eigene Änderungen zusammenführen.
2. **Welt verbessern.** Gelände, See, Wald und Straßenorientierung als eigenen E4-Teilschritt liefern. Physik und Route bleiben unverändert. Sichtnachweise und Ressourcenfreigabe prüfen, keine Headless-FPS als Hardwarebeleg.
3. **OIDC-Anmeldung implementieren.** Zuerst Bibliothek und Protokollgrenzen festlegen. Danach servereigene Login-Transaktion, lokale Identitäten/Sessions und Browserübergabe gegen einen echten signierenden Testprovider prüfen. UI und Gast-/Storagefehlerfälle gesondert integrieren. Kein E-Mail-Autolinking.
4. **Eigene Daten synchronisieren.** Profil, idempotente Fahrtpersistenz und Eigentumsprüfung liefern. Der Server unterscheidet gespeicherte, prüfbare und nicht prüfbare Fahrten. Outbox und Status gehören zu `sync/`. Bestehende lokale Aufnahmen bleiben lesbar.
5. **Prüfbare Fahrt und Strava liefern.** Zuerst V2-Vertrag und reine Nachrechnung prüfen. Danach erfasst der Worker seine geordnete Engine-Aufrufhistorie ab Initialisierung und bestätigt Aufnahmegrenzen atomar. V2-Persistenz, Upload und tatsächliche Browseraufnahme folgen vor der Strava-Anbindung. Die öffentliche Engine rechnet diese vollständige Historie nach. Nur eigene zulässige Nicht-Sim-Fahrten dürfen nach ausdrücklicher Zustimmung hochgeladen werden. OAuth, verschlüsselte Tokenablage, Widerruf, dauerhafter Uploadzustand und unklare Versandresultate separat testen.
6. **Integrieren und bereitstellen.** Einen vollständigen Browserfluss gegen die tatsächlich zusammengeführte Anwendung fahren. Nur grüne, unabhängig geprüfte Stände veröffentlichen. API-Betrieb und Backup/Restore separat nachweisen. Ohne sicheren Produktionsbetrieb bleibt dessen Aktivierung ausdrücklich blockiert, nicht die lokale Softwareprüfung.

## Risikoreiche Entscheidungen zuerst

Zwei Formen sind möglich:

- Ein großer Integrations-Branch ändert Auth, Aufnahme, Server und Welt gemeinsam. Das verdeckt Besitz- und Protokollfehler und ist schwer einzeln zu prüfen.
- Getrennte Besitzer veröffentlichen konkrete Verträge. Die Integration folgt nach deren jeweiligem Nachweis. Gewählt ist diese Form.

`auth/` besitzt Identitäten und Sessions. `accounts/` besitzt Profile. `rides/` besitzt gespeicherte Fahrten, Prüfung und Exportquelle. `strava/` besitzt nur Verbindung und Auslieferung. `game/` besitzt die laufende Aufnahme. `sync/` besitzt lokale Datensätze, Sessiondarstellung und Outbox. Gemeinsame JSON-Verträge liegen in `shared`. Kein Modul importiert fremde Tabellen direkt.

V1 speichert relative Distanz, aber weder vollständigen warmen Engine-Zustand noch Aufrufhistorie. Anfangstempo und Routenposition ersetzen verborgene Akkumulatoren und Eingabepuffer nicht. V2 rekonstruiert den Zustand deshalb durch vollständige geordnete Aufrufe der öffentlichen Engine ab deren festgelegten Initialisierungsdefaults. Nur die bestätigten Aufnahmegrenzen bestimmen die gewertete Fahrt; die Vorlaufhistorie zählt nicht dazu. Ein bloß validierter V1-Upload bleibt ungeprüft und exportierbar. Ein fehlender oder abgeschnittener V2-Präfix wird nicht durch eine geschätzte Startpose ersetzt. Nachrechnung belegt Konsistenz, keine Echtheit der Hardwaremessung.

Strava wird als eigenes Modul umgesetzt, nicht als allgemeines Providerframework. Ein verlorener POST-Response ist kein Nachweis eines fehlgeschlagenen Uploads. Ein solcher Auftrag bleibt unklar und darf nicht blind neu eingereicht werden.

## Parallelisierung und Prüfmittel

- [x] Principles-Index und relevante Einzelprinzipien gelesen.
- [x] Ausgangszustand mit reproduzierbaren Gates und Browsernachweisen erfasst.
- [x] Phasen und überprüfbares Endkriterium vor neuen Auth-/Sync-Funktionen festgelegt.
- [x] Szene und Aufnahme integriert.
- [x] Landschaft integriert.
- [x] OIDC-Server geprüft und integriert.
- [x] Browserkonto auf gemeinsamem Stand integriert.
- [x] Profil, Fahrtpersistenz und kontogebundene manuelle Outbox geprüft.
- [x] Reiner Nachrechnungskern und serverseitige Strava-Verbindung gegen lokale Testprovider geprüft.
- [ ] V2-Browseraufzeichnung, V2-HTTP-Annahme und ausdrücklichen Strava-Fahrtupload liefern und prüfen.
- [ ] Integrierten Browserfluss und freigegebenen Deploy geprüft.

Jeder Implementierer arbeitet in einem eigenen Worktree. Gleichzeitige Änderungen an einem Branch, Migrationen oder Indexdateien werden nicht vorausgesetzt. Getrennte Dateien und spätere Integration vermeiden gemeinsame Schreibzustände. Neue Migrationen erhalten bei der Integration eine eindeutige Reihenfolge.

Port 5173 gehört immer nur einem Gate. Andere Browserprüfungen verwenden eigene Ports und externe temporäre Konfigurationen. Produktionsregeln, Timeouts und Assertions werden nicht zum Bestehen einer Prüfung gelockert.

Ein Implementierer erhält jeweils einen unabhängigen Prüfer. Nach einem echten Befund folgt zuerst ein passender roter Regressionstest, dann die kleinste Korrektur. Ein Zweitbericht ohne Ausführung ersetzt keinen Artefaktnachweis.

## Grenzen der Autonomie

Keine Datenlöschung, kein Force-Push, keine kostenpflichtige Buchung und keine Lockerung von Leitplanken. Neue Abhängigkeiten benötigen vorher ADR und Registereintrag. Private Zugangsdaten gehören weder in Repo noch Logs, Redirect-URLs oder Frontend.

Für die Integration werden bestehende Schutzregeln nicht abgeschaltet. Normale Merge-Commits können die bereits geprüfte Abstammung gestapelter Worktrees erhalten. Auf `main` gelangt nur der konkret verifizierte Stand.

Die verworfene automatische Fortsetzungsplanung wird nicht neu eingerichtet. Aktive Tool-/Agentenmeldungen und konkrete CI-Watcher treiben den laufenden Auftrag weiter, kein dauerhafter Scheduler.

## Entscheidungsnachweis

Der append-only Arbeitsnachweis liegt lokal unter `$TMPDIR/opencode/voltonaut-next-decisions.tsv`. Er enthält Entscheidungen und Belegpfade, keine Secret-Werte. Die einzelnen Specs und Commit-/PR-Nachweise halten die übernommenen Ergebnisse fest.

Die gemeinsame OIDC-/Daten-Prozessprobe ist zusätzlich als `$TMPDIR/opencode/combined-owned-proof/verify.mjs` wiederholbar. Der Aufruf `mise exec -- node <Skriptpfad> <gebauter Worktree>` startet ausschließlich lokale Testprozesse. Er prüft signierten Login, Eigentümerzugriff, CORS, Bodygrenzen, Fremdschlüssel, echten Neustart, unveränderte Belege und Widerruf. Jeder Lauf schreibt einen getrennten Beleg und entfernt nur seine eigene synthetische Datenbank.

Die Gegenbeispiele zur warmen Startpose und die vollständige historische Nachrechnung stehen als ausführbare Tests unter `apps/server/src/rides/replay.test.ts` in der E10-02-Einheit. Der zusätzliche lokale Nachweis `replay-parent-proof.log` hält 39 bestandene Vertrags- und Replaytests fest. Diese Nachweise ersetzen keine Hardwareprüfung oder echte Worker-Erfassung.

## Offene Nutzerabnahmen

- Hardwarefahrt und reale Controller-/Widerstandsprüfung.
- Persönliche Anmeldung und Zustimmung bei den echten Anbietern.
- Freigabe neuer Kosten oder destruktiver Schritte, falls sie tatsächlich erforderlich werden.
