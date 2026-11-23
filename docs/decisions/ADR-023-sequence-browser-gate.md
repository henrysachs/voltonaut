# ADR-023 – Browserprüfung nach CPU-schweren Gate-Aufgaben

**Status:** Von Henry am 23.11.2026 ausdrücklich freigegeben. Die Freigabe umfasst genau die Reihenfolge in `mise.toml` und dieses ADR, keine gelockerten Prüfungen oder zusätzlichen Ressourcenänderungen.

## Kontext

Issue [#26](https://github.com/henrysachs/voltonaut/issues/26) betrifft den ersten echten Renderframe im Menü-E2E. `mise run check` startete Coverage, Typecheck und Browserprüfung gleichzeitig. Chromium nutzt in den nativen x86-CI-Containern SwiftShader und damit dieselben CPU-Ressourcen wie diese Prüfungen.

Der ursprüngliche 5000-ms-Poll scheitert in [Lauf 44900740106](https://github.com/henrysachs/voltonaut/actions/runs/44900740106/job/136835896390) mit fehlendem `data-calls`, nicht mit tatsächlich gemeldeten null Draw Calls. Init und Snapshot-ACK sind im gemessenen Fehler vorhanden. Chromiums erster Readback bleibt offen, während vier Threads des Software-GPU-Prozesses laufbereit auf CPU warten. Eine temporäre Kontrolle auf demselben Rechner besteht den vollständigen identischen Testkörper in einem neuen Browserprozess nach Ende von Coverage und Typecheck. Der ursprüngliche Fall bleibt dabei rot.

Der tatsächliche CI-Checkout war `86edc641a5c6ced4c23ba330186f6e2f5319befd`, mit Eltern `3afcfc5` und `6ad2c76`. Beide Messungen verwenden dieselben 423 Anwendungsquelldateien und dasselbe Manifest `fcb3c2786a825d592e0ca11da2a162c3baed2f4b4bf89ea87c78138b5b1fcae6`. Das ist ein Kapazitätsbefund in diesem Lauf, keine allgemeine Geschwindigkeits- oder FPS-Messung.

## Entscheidung

`check` behält `fmt:check`, `lint`, `typecheck`, `depcruise`, `guard` und `test` als Abhängigkeiten. Erst nach deren erfolgreichem Abschluss führt es die vorhandene unveränderte Aufgabe `mise run test:e2e` aus. Ein Fehler einer Phase lässt weiterhin das gesamte Gate fehlschlagen. Direkte Aufrufe von `test:e2e` bleiben unverändert.

Henrys Antwort **Freigeben (Recommended)** und der anschließende Auftrag **kannst du das dann machen?** am 23.11.2026 erlauben genau diese geschützte Änderung mit ADR-023. Workflows, Tools, Abhängigkeiten und alle übrigen Leitplanken bleiben unverändert.

## Folgen und Grenzen

- Alle ursprünglichen Browserfälle und die vollständige Unit-Prüfung mit Coverage bleiben Pflicht. Assertions, Fristen, Grafikqualität, Engine-Uhr und Datenfrische bleiben unverändert.
- Es gibt keine CPU-Grenze, Prioritätsänderung, zusätzliche Bereitschaftswartezeit oder vorgeschaltete Spielseite. Der Browser startet weiterhin eine kalte Spielsession.
- Die Änderung korrigiert die CI- und lokale Gate-Orchestrierung. Sie ist keine Reparatur des Anwendungsrenderers und kein Hardwareattest.
- Das Gate kann länger dauern, weil sich CPU-schwere Prüfungen und Browserprüfung nicht mehr überlappen. Das wird zugunsten einer aussagekräftigen unveränderten Browserprüfung akzeptiert.
- Die native Gegenprüfung muss denselben tatsächlichen Anwendungsstand verwenden. PR-Mergerefs und Teilbaumhashes werden geprüft; unterschiedliche CPU-Modelle gelten nicht als Beschleunigungsnachweis.
- Temporäre Diagnose-Fixtures, Zusatzfälle und Instrumentierung werden vor dem endgültigen Artefakt entfernt. Der finale Head benötigt erneut das vollständige Gate und den Build.

## Verworfene Alternativen

Längere Fristen, ein verschobenes Sim-Bereitschaftsfenster, vorzeitige Renderdiagnosen, geringere Qualität, Retries und Warmups würden den ursprünglichen Nachweis verändern. CPU-Limits, neue Runner und weitere Workflowänderungen sind nicht freigegeben und für diese Entscheidung nicht erforderlich.
