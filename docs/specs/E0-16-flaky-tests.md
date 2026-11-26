# Spec E0-16 – Wackelnde Tests

- **Roadmap-Bezug:** E0, Gate-Stabilität (`mise run check` blockiert PRs)
- **Status:** In Arbeit (Teilstand, Draft-PR)
- **Betroffene Module:** `apps/web/src/game`, `apps/web/src/world`, `apps/web/e2e`

## Ziel

Für jeden wackelnden Test die echte Ursache finden und beheben, ohne Timeouts, Assertions, Sim-Uhr, Retries oder Skips zu ändern. Wo nur Ressourcenbegrenzung hilft oder die Ursache offen ist, steht das hier ausdrücklich.

## Messumgebung

- Lokal: macOS, 14 Kerne. Last: 14 × `yes > /dev/null`.
- CI-nah: Container `mcr.microsoft.com/playwright:v1.65.1-noble` (CI-Image), Node 24.22.3, `--cpus=4`, `CI=true`, voller `vitest run --coverage`.
- Basis der Vorher-Messungen: `0d3951a`. Fix rebased auf `a9fba9e`.

## Befunde pro Test

### `apps/web/e2e/ride-recording.spec.ts:158` „rejects an empty capture …“ – behoben

- **Ursache (Test-Race):** Der Test startet und beendet die Aufnahme mit dem verbundenen Sim-Trainer. Der Recorder lehnt nur Fenster unter 1000 ms ab. Unter Last liegen zwischen „starten“ und „beenden“ mehr als 1000 ms Echtzeit. Dann enthält das Fenster echte Trainerdaten und wird korrekt als Fahrt gespeichert („Lokal gespeichert …“). Kein App-Fehler: ein Fenster mit Daten ist nicht leer.
- **Zweiter Befund (App):** Ein Fenster über 1000 ms **ohne** Trainerdaten scheiterte im Recorder an `RideTrackSchema.parse` und zeigte dem Nutzer rohes Zod-JSON statt der Meldung „leer oder ungültig“. Die Aufnahme blieb verwerfbar.
- **Rot vorher:** lokal `--repeat-each=10` (mit fun-mode parallel, 50 % Worker): 3/10 rot. Unverändertes Spec von `a9fba9e` unter Last (14 × `yes`) `--repeat-each=20`: 5/20 rot, jeweils „Lokal gespeichert …“. Neuer Unit-Test ohne Recorder-Fix: rot mit Zod-JSON.
- **Fix:** E2E trennt vor dem Start den Sim-Trainer über den Gerätedialog (`e2e/helpers/simTrainer.ts`). Damit ist das Fenster unabhängig von der Klickdauer leer. Recorder (`apps/web/src/game/rideRecorder.ts`) meldet ein Fenster ohne Trainerdaten als „Aufnahme leer oder ungültig …“. Unit-Test `recordedRide.journal.test.ts` „rejects a long window without trainer data as empty …“.
- **Nachher:** `--repeat-each=20` ohne Last 20/20 grün, unter derselben Last (14 × `yes`) 20/20 grün. Unit-Test grün.
- **Zwischenstand:** Eine erste Helper-Fassung wartete auf Sichtbarkeit des Rohstatus, der in eingeklappten Details liegt; ein Gate-Lauf scheiterte daran (30-s-Testtimeout). Korrigiert auf „attached“ mit Text.

### `apps/web/src/pwa/pwa.build.test.ts:263` „announces a waiting release …“ – Ursache bekannt, nicht behoben

- **Ursache:** Kein Race, sondern Laufzeit nahe am 5-s-Vitest-Limit. Gemessen pro Schritt (Instrumentierung, nicht committet): `shortcut.click()` wartet unter Last 1,5–2,5 s auf „stable“, weil der Renderer keine Frames liefert (rAF-Lücke 1,1–2,3 s; auch ein leerer `about:blank`-Tab hatte 0,2–1,5 s). Nach „Jetzt aktualisieren“ dauert es weitere 1,7–2,7 s bis `load`: `skipWaiting` → `controllerchange` sofort, `activate` des neuen Workers kommt aber erst ~1 s später (Chromium verzögert `ContinueActivation` um 1 s, wenn der alte Worker keine Kontrollierten mehr hat, `service_worker_registration.cc`), danach Neuladen. Summe unter Last 4–7 s.
- **Rot vorher:** lokal unter Last 1/10 (Einzeldatei), Debug-Lauf 4/15. Container `--cpus=4`, voller Lauf: 1/10. CI: `68ce4f7`, `3262951` (5012–5021 ms). Grüne CI-Läufe lagen bei 2,3–5,0 s (`0d3951a`: 4996 ms).
- **Folgefehler:** Wenn dieser Test hängt, scheitert „reloads the app shell offline“ mit „Not attached to an active page“, weil die Seite noch mitten im Neuladen ist.
- **Fix:** offen. Eine App-Ursache ist nicht belegt; die Zeit liegt in Chromium (Frame-Takt, 1-s-Aktivierungsverzögerung). Ehrliche Optionen ohne Leitplankenänderung: Test aufteilen (Ankündigung und Anwenden getrennt, jeder unter 5 s) oder die Build-Tests in eine eigene Vitest-Gruppe mit `maxWorkers: 1` verschieben. Letzteres wäre **Ressourcenbegrenzung (Mitigation, kein Fix)** und braucht Henrys Freigabe, weil es die Vitest-Konfiguration betrifft.

### `apps/web/e2e/fun-mode.spec.ts:25` – Ursache bekannt, nicht behoben

- **Ursache (Test-Race gegen die Fahrt):** Mit `clock=fast` (20×) fährt der Sim-Fahrer ab Seitenaufruf. Die erste Box liegt bei 300 m. Bis das Menü den Modus gesetzt hat, ist der Fahrer unter Last schon über 300 m hinaus. Dann sammelt er sofort eine Box, und die Assertion auf den leeren Slot (`EMPTY_SLOT`) sieht „Leichtgewicht bereit · Taste P“.
- **Rot vorher:** lokal `--repeat-each=10`: 1/10 (Fehlertext „Leichtgewicht bereit · Taste P“). Reviewer: 2/6.
- **Fix:** offen. Ehrlicher Weg: den Modus wählen, solange der Fahrer steht (Sim-Trainer erst nach der Moduswahl verbinden, analog `simTrainer.ts`), dann den Trainer verbinden und die Box sammeln. Noch nicht umgesetzt und nicht gemessen.

### `apps/web/e2e/ride-menu-dismissal.spec.ts:49` und `progress-panel.spec.ts:18` – zwei Ursachen behoben, Rest Ressourcenbegrenzung

Beide Tests messen „die Fahrt läuft weiter“ über `data-distance-m` der Render-Diagnose, also über die zuletzt **gezeichnete** Welt, nicht über die Engine. Messung (Instrumentierung, nicht committet; Basis `aacd0cd`, 14 × `yes`, Fremdlast anderer Agenten, Load 30–60):

- **Die Fahrt selbst läuft.** Die HUD-Distanz und die Engine-Snapshots im Render-Worker wachsen ab dem Start stetig (Sim-Fahrer nach 3 s bei ~11 km/h). Die Hypothese „Fahrt startet zu langsam“ ist widerlegt.
- **Ursache 1 (App, `world/frame.ts`):** Unter Last liegen zwischen zwei Render-Worker-Frames 1,5–3,7 s. Der `FrameSampler` interpolierte beim ersten Frame nach so einer Lücke vom zuletzt **gezeichneten** Snapshot zum neuen mit `alpha = 0`. Er zeichnete also noch einmal den Stand von vor der Lücke. Beleg: Die Diagnose blieb 3,6 s lang bei 0,067 m, während der Worker schon Snapshots mit 7,8–8,9 m hatte. Jeder Frame zeigte damit den Stand des vorigen Frames. Für Spieler zeigt die Welt nach jedem Ruckler einen veralteten Stand.
- **Ursache 2 (Test-Race):** Die Basis wurde gelesen, bevor der Render-Worker zum ersten Mal gezeichnet hatte. Ohne Attribut liefert `Number(null)` den Wert 0, und das 5-s-Fenster begann vor dem ersten Bild.
- **Fix:** `FrameSampler` startet nach einer Frame-Lücke > 250 ms beim neuesten Snapshot. Das ist dieselbe Grenze, bis zu der der Sampler bisher den Snapshot-Abstand glättete. Unit-Test `frame.test.ts` „draws the newest snapshot after a long frame gap …“: ohne Fix rot (`expected +0 to be 15`), mit Fix grün. E2E: `e2e/helpers/rideWorld.ts` wartet vor der Basismessung auf das echte Bereitschaftssignal (`aria-busy="false"` am Canvas, gesetzt erst nach dem ersten Renderaufruf mit Draw Calls, ADR-019). Fenster, Schwelle (+2 m) und Timeouts sind unverändert.
- **Rot vorher (unverändert, 14 × `yes`, je Test `--repeat-each=10`):** 20/20 rot (Load ~56). Werte 0–0,28 m.
- **Gegenprobe (gleiche Last):** Nur mit Testfix waren 20/20 rot. Nur mit App-Fix waren 18/20 und in einem zweiten Lauf 37/40 rot. Es braucht beide Fixes.
- **Nachher (beide Fixes, 14 × `yes`, je Test `--repeat-each=20`):** 40/40 grün (Load ~59). Zweiter Lauf: 33/40 grün, 7 rot. Während dieses Laufs stieg die Fremdlast von 31 auf 97. Die roten Läufe zeigten nach dem ersten Bild 5 s lang **keinen** weiteren Frame (Werte 0–0,13 m).
- **Rest (Ressourcenbegrenzung, nicht behoben):** Ab etwa Load 90 liefert der Render-Worker (SwiftShader, Software-GL) länger als 5 s kein Bild. Dafür ist keine App-Ursache belegt. Eine Mitigation wäre weniger Parallelität, und die braucht eine Konfigurationsänderung mit Henrys Freigabe. Sie ist nicht umgesetzt.

### `apps/web/e2e/garage-shop.spec.ts:37/153` – Ursache belegt, Fix offen

- **Rot vorher (14 × `yes`, `--repeat-each=10`, `aacd0cd`):** Im Messlauf beider Tests waren mindestens 8/20 rot. Die Ausgabe war gekürzt, die genaue Zahl fehlt. In der Gegenprobe war :153 10/10 rot. Im Gate-Lauf `E2E_PORT=5194` (Fremdlast) waren :37, :86 und :153 rot. Fehler: Klick oder `check` wartet 30 s auf „visible, enabled and stable“ (Item-Button, Farb-Radio).
- **Ursache (App, Main-Thread-WebGL):** Die Garage-Vorschau (`ui/garage/preview.ts`) zeichnet mit Three.js auf dem Main-Thread bei jedem `requestAnimationFrame`. ADR-019 deckt nur die Fahrtwelt ab. Unter Last misst der Main-Thread mit offener Garage Long Tasks von 1,5–2,5 s, also nur 3–4 Frames in 5 s. `renderer.render` selbst kostet in JS 0–1 ms, die Zeit liegt im synchronen Software-GL-Pfad. Ohne Garage hat derselbe Tab 60 fps. Playwright prüft „stable“ über aufeinanderfolgende rAF-Frames. Mit ~2 s pro Frame reichen 30 s nicht für mehrere Aktionen. Das Element bewegt sich nicht (Rechteck über 6 Frames identisch).
- **Gegenprobe (gleiche Last):** WebGL nur auf Main abgeschaltet (Weltrenderer im Worker unberührt): :153 10/10 grün, unverändert 10/10 rot. Mit stillgelegtem Weltrenderer und laufender Garage gibt es weiter Long Tasks von 0,5 s. Die Ursache ist die Garage, nicht der Welt-Worker.
- **Fix offen (Architekturentscheidung):** Optionen ohne Leitplankenänderung: (a) die Garage-Vorschau wie ADR-019 in einen Worker mit `OffscreenCanvas` verlegen. Das bedeutet ein neues ADR bzw. eine ADR-019-Erweiterung und Henrys Freigabe. (b) Nur bei Änderung zeichnen. Das ändert aber das Auto-Rotate-Verhalten, ist also eine Produktentscheidung. Eine Drosselung der Vorschau-Bildrate allein zum Bestehen wäre verbogene Grafikqualität und ist ausgeschlossen. Nicht umgesetzt.

### Server `check-config.test.ts`, `main.shutdown.test.ts`, `admin.test.ts` – Ressourcenbegrenzung, kein Code-Fehler belegt

- **Rot vorher (14 × `yes` + Fremdlast, die drei Dateien, 3 Läufe):** 3/3 Läufe rot, je 7/7 Tests (5-s-Timeouts). Im Gate-Lauf (Fremdlast Load 30–70, ohne eigene Last) zusätzlich rot: `database.test.ts`, `strava-migrations.test.ts`, `ledger-migrations.test.ts`. Diese starten **keine** Kindprozesse.
- **Messung pro Schritt:**
  - Kein Kompilieren pro Test. `buildServerProcess` baut einmal pro Datei in `beforeAll` (0,25 s ohne, 1,1 s mit Last).
  - Ein CLI-Kind lädt 1026 ESM-Module aus `node_modules`.
  - Ohne Last braucht ein Kind 0,5–1,2 s Wandzeit bei ~0,5 s CPU.
  - Unter Last braucht es 6,9–9,1 s Wandzeit bei nur ~1,25 s CPU. Davon entfallen 5,5–7,2 s auf das Laden der Module (Sample: überwiegend `__open`, `__psynch_cvwait`). Einzelne Läufe hingen 60–93 s fast ohne CPU.
  - Parallel lief der Echtzeitscanner von Microsoft Defender (`wdavdaemon`) mit über 300 % CPU.
  - `node -e 0` braucht unter Last 0,2–5 s.
- **Bewertung:** Die Zeit liegt im Prozessstart bzw. Dateizugriff unter Sättigung, nicht im Testcode. Dass auch Migrationstests ohne Kindprozess scheitern, stützt das. **Ressourcenbegrenzung, kein Fix.**
- **Optionen (nicht umgesetzt, Freigabe nötig):** (a) die Prozess-Tests in eine eigene Vitest-Gruppe mit begrenzten Workern verschieben (Konfiguration, Mitigation). (b) eine Defender-Ausnahme für das Temp-/`node_modules`-Verzeichnis (Rechnerkonfiguration, Henry). (c) `node_modules` ins Testartefakt bündeln. Das ändert das geprüfte Artefakt gegenüber Produktion und wird nicht empfohlen.

## Abnahmekriterien

- [x] AK1 – `ride-recording.spec.ts:158`: Ursache belegt, Fix ohne gelockerte Assertion, 20/20 grün.
- [x] AK2 – Leeres Fenster > 1 s ohne Trainerdaten zeigt „leer oder ungültig“ statt Zod-JSON (Unit-Test, vorher rot).
- [ ] AK3 – `pwa.build.test.ts:263` stabil (offen, siehe oben).
- [ ] AK4 – `fun-mode.spec.ts:25` stabil (offen, siehe oben).
- [ ] AK5 – übrige Tests: Ursache belegt. Teilweise erfüllt: ride-menu-dismissal/progress-panel zwei Ursachen behoben, Rest Ressourcenbegrenzung. Garage: Ursache belegt, Fix braucht eine Entscheidung. Server: Ressourcenbegrenzung belegt.
- [x] AK6 – `FrameSampler` zeichnet nach einer Frame-Lücke den neuesten Snapshot (Unit-Test, vorher rot).

## Testplan

| AK  | Ebene | Datei                                                                                                              |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| AK1 | E2E   | `apps/web/e2e/ride-recording.spec.ts` (`--repeat-each=20`)                                                         |
| AK2 | Unit  | `apps/web/src/game/recordedRide.journal.test.ts`                                                                   |
| AK3 | Build | `apps/web/src/pwa/pwa.build.test.ts` (Schleife, Last, Container)                                                   |
| AK4 | E2E   | `apps/web/e2e/fun-mode.spec.ts` (`--repeat-each=10`)                                                               |
| AK5 | E2E   | `ride-menu-dismissal.spec.ts:49`, `progress-panel.spec.ts:18`, `garage-shop.spec.ts` (`--repeat-each=10/20`, Last) |
| AK6 | Unit  | `apps/web/src/world/frame.test.ts`                                                                                 |

## Nicht-Ziele

Keine Änderung an Timeouts, Retries, Sim-Uhr, Vitest-/Playwright-Konfiguration oder Leitplanken.

## Nachweisstand

- `E2E_PORT=5191 mise run check` auf dem Endstand: grün (1918 Unit/Integration, 81 E2E). Vorherige Gate-Läufe unter hoher Rechnerlast scheiterten an den offenen Tests (Server-Timeouts ×6; progress-panel ×1).

- Branch `fix/flaky-ride-server`: `E2E_PORT=5194 mise run check` unter Fremdlast (Load 30–150 durch andere Agenten) **nicht grün**. Format, Lint, Typecheck, depcruise und guard waren grün. Rot waren 12 Server-Tests (5-s-Timeouts in Prozess- und Migrationstests, siehe oben). In einem E2E-Einzellauf waren 8 rot: garage-shop/-purchase (Main-Thread-WebGL), ride-scene ×2 und game-menu:66. Bei den beiden letzten kam vom Welt-Worker kein erstes Bild in 5 s. Alle 8 fallen in die offenen Ursachen. Ein grüner Gate-Lauf auf ruhigem Rechner steht aus.

Implementiert und softwaregeprüft: AK1, AK2, AK6. An echter Hardware geprüft: nein (nicht nötig). Bereitgestellt: nein.
