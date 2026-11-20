# Spec E0-04 – Aktuelle Implementierungen auf main zusammenführen

- **Auftrag:** Henry beauftragt am 20.11.2026 die Zusammenführung aller aktuellen Änderungen auf `main` und deren Abschluss.
- **Status:** Gesamtstand lokal verifiziert und unabhängig genehmigt. CI und Übernahme sind in PR #19 nachvollziehbar.
- **Bezug:** Aktuelle Teilschnitte E0-03, E1-04, E2-02, E5-08, E5-09, E10-02 und E10-03. Kein Abschluss der gesamten Roadmap.

## Ziel und Umfang

`main` enthält den vollständigen geprüften Integrationsstand statt verteilter Feature-Branches. Dazu gehören Browserkonto, kontogebundener manueller Sync, Replay-Prüfkern, serverseitige Strava-Verbindung, Deploy-Korrekturen und die hardwarebelegte Play-Anbindung samt Mehrgerätelabor.

Die Bestandsaufnahme umfasst 31 Worktrees. Die aktuellen Quellen für Kontosync, Strava und Deploy sind bereits integriert. Abweichungen sind zusammengeführte Dokumentation, Formatierung, zusätzliche Testabdeckung, engere Testverträge und die Verlagerung der Strava-Prüfskripte. Die alten E1- und E5-Prototypen werden durch die inzwischen integrierten BLE-, OIDC- und Datenmodule ersetzt. Sie werden nicht erneut über diese Module kopiert. Alle ursprünglichen Worktrees bleiben erhalten. Private Auditdateien, Testdatenbanken und das verworfene Renderexperiment gehören nicht in den Lieferstand.

## Abnahmekriterien

- [x] Aktuelle Quellstände und offene PRs #10, #12, #16 und #18 sind im Integrationsbranch enthalten.
- [x] Originale Änderungen und laufende Browser-Captures bleiben unberührt.
- [x] `GUARD_DIFF_BASE=origin/main E2E_PORT=5194 CI=true mise run check` und Build bestehen. Keine gelockerte Leitplanke und keine Änderung an Engine oder Rules.
- [x] Kompilierter Server, OIDC-Browserkonto und Kontosync bestehen ihre lokalen Prozess- und Browserprüfungen.
- [x] Unabhängige Reviews gegen Standards und Specs sind abgeschlossen. Der bestätigte Doku-Befund ist korrigiert und erneut geprüft.
- [ ] Die abschließende PR-CI ist grün. Neue Play-Fixtures sind begründet und mit `baseline-update` gekennzeichnet.
- [ ] Der Integrations-PR ist ohne Schutzumgehung gemergt. Lokales und entferntes `main` enthalten denselben Stand. Übernommene PRs sind abgeschlossen.

## Verifikation

Das lokale Gesamtgate besteht mit 623 Unit-Tests und 26 E2Es. Die BLE-Zusammenführung besitzt zusätzlich ein unabhängiges Review mit 35 fokussierten Tests und vier Browserproben. `scripts/verify-browser-oidc.mjs` prüft das Browserkonto. Dessen `--sync`-Suite prüft echte IndexedDB und den kompilierten API-Prozess. `serververification.mjs` prüft die Strava-Verbindung gegen lokale Protokollanbieter. Alle Anbieteridentitäten und Zugangsdaten sind synthetisch.

Die erneuten Prozessprüfungen bestehen fünf OIDC- und 14 Sync-Browserfälle sowie den Strava-Verbindungsablauf mit verschlüsselter Persistenz und Widerruf über Prozessneustarts. `bash deploy/test-deploy.sh` besteht ohne Docker-Daemonzugriff. Das Standards-Review besteht zusätzlich 95 Tests in elf Dateien. Das Spec-Review besteht 115 Tests in 15 Dateien. Der fehlende Strava-Referenzabschnitt in `docs/08-backend.md` ist ergänzt und vom Prüfer bestätigt.

Der erste PR-Lauf auf `4d72986` enthält einen sporadischen Hintergrundfahrt-Fehler vor dem Tabwechsel. Derselbe Commit besteht gleichzeitig das identische zweite Gate. Fünf native und sechs Linux-Wiederholungen reproduzieren den Fehler nicht. Das ist keine Reparatur. [Issue #20](https://github.com/henrysachs/voltonaut/issues/20) hält Fehler, Belege und den nächsten Diagnoseschritt fest. Keine Assertion, Testgrenze, Sim-Uhr oder Weltqualität wird dafür geändert. Die Übernahme verlangt weiterhin grüne Checks des abschließenden Stands.

Der nächste CI-Lauf auf `79e8ea9` scheitert stattdessen am Replay-Rundenfall nach 1.400 virtuellen Sekunden. Dessen zwei Runden sind für die Abnahme nicht erforderlich. Der unabhängig geprüfte Präfix von 480 Sekunden enthält den ersten vollständigen Rundenübergang samt Segmentausgaben. Die Testdatenkorrektur erhält alle bisherigen Assertions und ergänzt genau eine Runde. [E10-02](E10-02-replay-consistency.md#ci-korrektur-des-rundenbeispiels) beschreibt Belege und Abdeckungsgrenze. Die unveränderte Fünf-Sekunden-Grenze bleibt bestehen.

Auf `3fbf764` bestehen beide Unit-Gates mit 623 Tests. Die parallelen Browserläufe scheitern weiterhin an initialer Distanz beziehungsweise Wiederverbindung im HUD. Die Browserkonfiguration verwendet deshalb bei `CI=1` oder `CI=true` einen Worker. Lokal bleibt die bisherige Standardverteilung von 50 Prozent der CPUs erhalten. Das entspricht der [Playwright-Empfehlung für CI](https://playwright.dev/docs/ci#workers).

Diese Maßnahme begrenzt die Konkurrenz unabhängiger Browserfälle. Sie ist kein nachgewiesener Fix für einen Fehler der App oder des Renderers. Alle 26 Fälle, `fullyParallel`, die unveränderten Assertions und Zeitgrenzen bleiben erhalten. Zweite Tabs und parallele Gerätesitzungen innerhalb eines Falls bleiben ausdrücklich Teil der Tests. Weder Weltqualität noch Sim-Uhr, Datenfrische, Retries, Workflows oder das universelle Gate werden geändert. Die gesamte Suite muss innerhalb ihrer bestehenden Grenzen bestehen.

Das unabhängige Konfigurationsreview bestätigt per öffentlicher Playwright-CLI bei `CI=1` und `CI=true` je einen Worker, bei `CI=false` und ohne Variable je sieben auf diesem Host. Alle vier Inventare enthalten dieselben 26 ungeskippten Fälle. Der einzige Konfigurationsdiff ist die Workeranzahl. Das lokale vollständige Gate besteht mit 623 Unit-Tests und allen 26 E2Es auf einem Browserworker. Der Reviewbeleg liegt unter `$TMPDIR/opencode/browser-worker-correction-review-mcolgdei/`.

Der zusätzliche Linuxvergleich liegt unter `$TMPDIR/opencode/main-ci-startup-EcL7Ju/`. Er verwendet den aktuellen Vite-Devserver, unveränderte Testkörper, synthetische Bluetooth-Geräte und das vorhandene Playwright-Image. Auf zwei Container-CPUs bestehen sechs Fälle mit zwei Workern. Auf einer Container-CPU scheitern alle sechs mit zwei Workern, darunter dieselben Distanz- und Wiederverbindungsassertionen. Die JSON-Proben und unveränderten Fehlertraces bleiben erhalten. Ein Vergleich mit einem Worker prüft die Ressourcenbegrenzung unter derselben CPU-Grenze. Das ist eine begrenzte Linux-ARM-Stressprobe, keine Replik der tatsächlichen CI-Hardware und kein Leistungsbenchmark.

Der lokale Entscheidungsnachweis und die Quellinventur liegen unter `$TMPDIR/opencode/`. Der Integrations-PR ist [#19](https://github.com/henrysachs/voltonaut/pull/19). CI führt dasselbe vollständige Gate aus. Mutation ist nicht erforderlich, weil der Diff gegen das bisherige `main` weder `packages/engine` noch `packages/rules` ändert.

## Nicht-Ziele und offene Abnahmen

Kein produktiver Deploy, kein echter Anbieteraufruf und keine Änderung laufender Labore. Strava-Fahrtupload, V2-Browseraufzeichnung und V2-HTTP-Annahme bleiben weitere Implementierungen. Gemeinsame Funkfahrt, Trainersteuerung, Pulsgurt, echte Anbieterzustimmung und externes Backup bleiben getrennte Abnahmen.

## Offene Fragen

Keine Integrationsfragen. Eine Aktualisierung der laufenden Labore braucht weiterhin exportierte Mitschnitte und die Freigabe zum Neuladen.
