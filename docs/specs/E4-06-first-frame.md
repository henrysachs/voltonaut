# Spec E4-06 – CI-Lastkorrektur für den ersten Renderframe

## Ziel und Freigabe

Issue [#26](https://github.com/henrysachs/voltonaut/issues/26) durch einen passenden roten nativen x86-Lauf erklären und denselben unveränderten Fall nach der freigegebenen Gate-Sequenzierung grün prüfen. Keine behauptete Reparatur des Anwendungsrenderers und keine allgemeine Geschwindigkeits- oder FPS-Zusage.

Henry hat am 23.11.2026 genau die Änderung von `mise.toml` und [ADR-023](../decisions/ADR-023-sequence-browser-gate.md) freigegeben. Der Korrekturstand verwendet Mitgliedschafts-Main `3afcfc5` als Anwendungsbasis. Produktion, laufender Fahrstand, Geräte und Nutzerdaten bleiben unberührt.

## Umsetzung

`check` führt zuerst seine unveränderten Aufgaben `fmt:check`, `lint`, `typecheck`, `depcruise`, `guard` und `test` aus. Erst deren erfolgreicher Abschluss startet die vorhandene unveränderte Aufgabe `mise run test:e2e`. Jede fehlgeschlagene Phase lässt das gesamte Gate fehlschlagen.

Alle ursprünglichen 49 Browserfälle einschließlich des vollständigen Menü-Testkörpers und des vorhandenen Fehlerhelfers sind bytegleich zu Main `3afcfc5`. Die eigenen temporären Capture-Fixtures, Zusatzfälle, Worker-Wrapper, CPU-Sampler und Trace-Helfer sind entfernt. Ihre Primärlogs, Bilder und Quellarchive bleiben als private Arbeitsartefakte erhalten.

## Abnahmekriterien

- Passender nativer x86-Fehler mit fehlendem `data-calls`, tatsächlichem Init- und Snapshot-ACK sowie lokalisierter Software-GPU-CPU-Verdrängung ist erhalten.
- Derselbe ursprüngliche Menüfall besteht nach der einzigen dauerhaften Laufzeitänderung, der Gate-Sequenzierung, nativ auf identischen Anwendungsquellen.
- Keine Änderung an Assertions, ursprünglichen Fristen einschließlich 5000 ms, Testauswahl, Engine-Uhr, Datenfrische, Grafikqualität, CPU-Limits oder Prioritäten. Keine vorgewärmte Spielseite und kein Bereitschaftsfenster-Reset.
- Das finale Artefakt enthält keine eigene temporäre Instrumentierung. Vollständiges `mise run check`, Build und die ursprünglichen 49 Browserfälle müssen am finalen Head grün sein. Unabhängiges Review erfolgt vor Merge durch den übernehmenden Agenten.

## Roter Befund und Korrekturprüfung

Im [nativen Lauf 44900740106](https://github.com/henrysachs/voltonaut/actions/runs/44900740106/job/136835896390) scheitert der ursprüngliche 5000-ms-Poll. Der rohe Wert bleibt fehlend, nicht tatsächlich null Draw Calls. Init und Snapshot-ACK treffen ein; Chromiums erster Readback wartet auf Software-GPU-Arbeit. Während des beobachteten Readbacks sind die GPU-Prozessthreads überwiegend laufbereit, warten aber auf CPU.

Eine temporäre Kontrolle auf demselben Rechner besteht den vollständigen identischen Testkörper in einem neuen Chromium-Prozess nach Ende von Coverage und Typecheck. Quelle, Konfiguration, GPU-Treiber und CPU-Modell stimmen überein. Das echte erste Weltbild stammt aus dem ursprünglichen Testkörper. Diese Kontrolle allein war keine Reparatur und ließ den ursprünglichen Fehler rot.

Die tatsächliche rote CI-Anwendung verwendete Mergecheckout `86edc641`, Eltern `3afcfc5` und Diagnose `6ad2c76`. Ihr gesamter Git-Baum stimmt mit dem lokalen zusammengeführten Ausgangsstand `6a280bd` überein. Der Korrekturcommit `f9ca298` ändert danach ausschließlich `mise.toml`, ADR-023 und diese Spec.

Die ersten korrigierten nativen Läufe [45196332618](https://github.com/henrysachs/voltonaut/actions/runs/45196332618) und [45196332844](https://github.com/henrysachs/voltonaut/actions/runs/45196332844) bestehen beide mit 850 Unit-Tests und vorübergehend 50 Browserfällen. Tatsächlicher Checkout `4419af19`, Eltern `3afcfc5` und `f9ca298`. Alle 423 Anwendungsquelldateien verwenden unverändert das Manifest `fcb3c2786a825d592e0ca11da2a162c3baed2f4b4bf89ea87c78138b5b1fcae6`. Die Browserphase beginnt nach den CPU-schweren Prüfungen. Die Weltaufnahme wurde geöffnet und zeigt echte Welt, Fahrer, Schatten und HUD.

Die Läufe [45197949967](https://github.com/henrysachs/voltonaut/actions/runs/45197949967) und [45197950322](https://github.com/henrysachs/voltonaut/actions/runs/45197950322) bestätigen zusätzlich den nativen x86-Build im temporären Diagnoseabschluss. Checkout `9dc6478c`, Eltern `3afcfc5` und `95f3804`, unverändertes Anwendungsmanifest. Die erzeugten Worker-Bundles sind bytegleich zum lokalen Build nach Entfernung der Instrumentierung. Der endgültige Quell- und Testbestand entspricht vollständig Main, nur die freigegebene Gate-Orchestrierung bleibt geändert.

Die abschließenden Prüfungen ohne Instrumentierung sind den Checks und Nachweisen des exakten finalen Heads in [PR #29](https://github.com/henrysachs/voltonaut/pull/29) zuzuordnen. PR-Head, tatsächlicher CI-Mergecheckout und Anwendungsmanifest dürfen nicht gleichgesetzt werden. Unterschiedliche CPU-Modelle gelten nicht als Beschleunigungsnachweis.

## Grenzen

Implementiert ist eine CI- und lokale Gate-Lastkorrektur, keine Änderung des Renderers. Hardwareabnahme, physische GPU-FPS, Bereitstellung und Merge bleiben getrennte Schritte. An echter Hardware getestet: nein. Bereitgestellt: nein.
