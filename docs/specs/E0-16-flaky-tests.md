# Spec E0-16 – Wackelnde Tests

- **Roadmap-Bezug:** E0, Gate-Stabilität (`mise run check` blockiert PRs)
- **Status:** In Arbeit (Teilstand, Draft-PR)
- **Betroffene Module:** `apps/web/src/game`, `apps/web/e2e`

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

### `apps/web/e2e/ride-menu-dismissal.spec.ts:49` – Ursache offen

- **Rot vorher:** lokal (Stand `a9fba9e`) `--repeat-each=10` zusammen mit progress-panel und garage-shop: 1/10. Fehler: `data-distance-m` stieg in 5 s nur um 0,025 m statt > 2 m.
- **Hypothese (unbelegt):** Die Fahrt startet mit realer Uhr (ohne `clock=fast`) aus dem Stand; unter Last erreicht der Fahrer in 5 s keine 2 m, oder die Render-Diagnose liefert unter Last keine frischen Werte. Nicht verifiziert.

### `apps/web/e2e/progress-panel.spec.ts:18` – Ursache offen

- **Rot vorher:** lokal `--repeat-each=10` (Stand `a9fba9e`): 0/10. Im Gate-Lauf unter hoher Rechnerlast (Load ~50): 1 rot mit demselben Muster wie `ride-menu-dismissal.spec.ts:49` (`data-distance-m` stieg in 5 s nur um 0,008 m statt > 2 m).
- **Hypothese (unbelegt):** gemeinsame Ursache mit `ride-menu-dismissal.spec.ts:49` (Fahrt mit realer Uhr erreicht unter Last in 5 s keine 2 m oder Diagnosewerte veralten). Nicht verifiziert.

### `apps/web/e2e/garage-shop.spec.ts:37/153` – Ursache offen

- **Rot vorher:** lokal `--repeat-each=10` (Stand `a9fba9e`): 0/20. Nicht reproduziert; keine Aussage zur Ursache.

### Server `check-config.test.ts`, `main.shutdown.test.ts`, `admin.test.ts` – Ursache offen

- **Rot vorher:** lokal voller `vitest run --coverage` unter parallelem Debug-Last-Lauf: 1/3 mit 6 Server-Timeouts (5 s) gleichzeitig (`check-config` ×3, `main.shutdown`, `admin` ×2). Ohne Fremdlast 0/2, isoliert 0/1.
- **Hypothese (unbelegt):** Diese Tests starten Kindprozesse (`execFile`), deren Start unter CPU-Sättigung allein mehrere Sekunden dauert. Das wäre Ressourcenbegrenzung, kein Code-Fehler. Nicht pro Schritt gemessen.

## Abnahmekriterien

- [x] AK1 – `ride-recording.spec.ts:158`: Ursache belegt, Fix ohne gelockerte Assertion, 20/20 grün.
- [x] AK2 – Leeres Fenster > 1 s ohne Trainerdaten zeigt „leer oder ungültig“ statt Zod-JSON (Unit-Test, vorher rot).
- [ ] AK3 – `pwa.build.test.ts:263` stabil (offen, siehe oben).
- [ ] AK4 – `fun-mode.spec.ts:25` stabil (offen, siehe oben).
- [ ] AK5 – übrige Tests: Ursache belegt (offen).

## Testplan

| AK  | Ebene | Datei                                                            |
| --- | ----- | ---------------------------------------------------------------- |
| AK1 | E2E   | `apps/web/e2e/ride-recording.spec.ts` (`--repeat-each=20`)       |
| AK2 | Unit  | `apps/web/src/game/recordedRide.journal.test.ts`                 |
| AK3 | Build | `apps/web/src/pwa/pwa.build.test.ts` (Schleife, Last, Container) |
| AK4 | E2E   | `apps/web/e2e/fun-mode.spec.ts` (`--repeat-each=10`)             |

## Nicht-Ziele

Keine Änderung an Timeouts, Retries, Sim-Uhr, Vitest-/Playwright-Konfiguration oder Leitplanken.

## Nachweisstand

- `E2E_PORT=5191 mise run check` auf dem Endstand: grün (1918 Unit/Integration, 81 E2E). Vorherige Gate-Läufe unter hoher Rechnerlast scheiterten an den offenen Tests (Server-Timeouts ×6; progress-panel ×1).

Implementiert und softwaregeprüft: AK1, AK2. An echter Hardware geprüft: nein (nicht nötig). Bereitgestellt: nein.
