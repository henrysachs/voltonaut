# Spec E0-16 – Wackelnde Tests

- **Roadmap-Bezug:** E0, Gate-Stabilität (`mise run check` blockiert PRs)
- **Status:** Teilstand: AK1–AK4 und AK6 umgesetzt. AK5 offen; Fixpfade siehe Abschnitte.
- **Betroffene Module:** `apps/web/src/game`, `apps/web/src/world`, `apps/web/src/pwa` (nur Tests), `apps/web/e2e`, `apps/server`

## Ziel

Für jeden wackelnden Test die echte Ursache finden und beheben, ohne Timeouts, Assertions, Sim-Uhr, Retries oder Skips zu ändern. Wo nur Ressourcenbegrenzung hilft oder die Ursache offen ist, steht das hier ausdrücklich.

## Messumgebung

- Lokal: macOS, 14 Kerne, Node 24.22.3. Last: 14 × `yes > /dev/null`. Dazu kam Fremdlast durch parallel laufende Agenten (Load 30–150) und den Echtzeitscanner Microsoft Defender. Die Fremdlast ist nicht steuerbar. Lastangaben stehen deshalb pro Messung.
- CI-nah: Container `mcr.microsoft.com/playwright:v1.65.1-noble` (CI-Image), Node 24.22.3, `--cpus=4`, `CI=true`, voller `vitest run --coverage`.
- Basen: ride-recording, pwa und fun-mode `0d3951a` (Fix rebased auf `a9fba9e`, PR #136). ride-menu, progress, Garage und Server `aacd0cd` (Fix rebased auf `e8818a2`).
- Gate: Die lokale Maschine ist überlastet. Der volle `mise run check` läuft in CI. Lokal laufen nur gezielte Prüfungen.

## Befunde pro Test

### `apps/web/e2e/ride-recording.spec.ts:158` „rejects an empty capture …“ – behoben

- **Ursache (Test-Race):** Der Test startet und beendet die Aufnahme mit dem verbundenen Sim-Trainer. Der Recorder lehnt nur Fenster unter 1000 ms ab. Unter Last liegen zwischen „starten“ und „beenden“ mehr als 1000 ms Echtzeit. Dann enthält das Fenster echte Trainerdaten und wird korrekt als Fahrt gespeichert („Lokal gespeichert …“). Kein App-Fehler: ein Fenster mit Daten ist nicht leer.
- **Zweiter Befund (App):** Ein Fenster über 1000 ms **ohne** Trainerdaten scheiterte im Recorder an `RideTrackSchema.parse` und zeigte dem Nutzer rohes Zod-JSON statt der Meldung „leer oder ungültig“. Die Aufnahme blieb verwerfbar.
- **Rot vorher:** lokal `--repeat-each=10` (mit fun-mode parallel, 50 % Worker): 3/10 rot. Unverändertes Spec von `a9fba9e` unter Last (14 × `yes`) `--repeat-each=20`: 5/20 rot, jeweils „Lokal gespeichert …“. Neuer Unit-Test ohne Recorder-Fix: rot mit Zod-JSON.
- **Fix:** E2E trennt vor dem Start den Sim-Trainer über den Gerätedialog (`e2e/helpers/simTrainer.ts`). Damit ist das Fenster unabhängig von der Klickdauer leer. Recorder (`apps/web/src/game/rideRecorder.ts`) meldet ein Fenster ohne Trainerdaten als „Aufnahme leer oder ungültig …“. Unit-Test `recordedRide.journal.test.ts` „rejects a long window without trainer data as empty …“.
- **Nachher:** `--repeat-each=20` ohne Last 20/20 grün, unter derselben Last (14 × `yes`) 20/20 grün. Unit-Test grün.
- **Zwischenstand:** Eine erste Helper-Fassung wartete auf Sichtbarkeit des Rohstatus, der in eingeklappten Details liegt; ein Gate-Lauf scheiterte daran (30-s-Testtimeout). Korrigiert auf „attached“ mit Text.

### `apps/web/src/pwa/pwa.build.test.ts:263` „announces a waiting release …“ – behoben (aufgeteilt)

- **Ursache:** Kein Race, sondern Laufzeit nahe am 5-s-Vitest-Limit. Gemessen pro Schritt (Instrumentierung, nicht committet): `shortcut.click()` wartet unter Last 1,5–2,5 s auf „stable“, weil der Renderer keine Frames liefert (rAF-Lücke 1,1–2,3 s; auch ein leerer `about:blank`-Tab hatte 0,2–1,5 s). Nach „Jetzt aktualisieren“ dauert es weitere 1,7–2,7 s bis `load`: `skipWaiting` → `controllerchange` sofort, `activate` des neuen Workers kommt aber erst ~1 s später (Chromium verzögert `ContinueActivation` um 1 s, wenn der alte Worker keine Kontrollierten mehr hat, `service_worker_registration.cc`), danach Neuladen. Summe unter Last 4–7 s.
- **Rot vorher:** lokal unter Last 1/10 (Einzeldatei), Debug-Lauf 4/15. Container `--cpus=4`, voller Lauf: 1/10. CI: `68ce4f7`, `3262951` (5012–5021 ms). Grüne CI-Läufe lagen bei 2,3–5,0 s (`0d3951a`: 4996 ms). Basis `aacd0cd` unter Last (14 × `yes`, Load ~50), Einzeldatei 20 × in Schleife: 14/20 rot am 5-s-Timeout. In 9 davon scheiterte zusätzlich der Offline-Folgetest.
- **Folgefehler:** Wenn dieser Test hängt, scheitert „reloads the app shell offline“ mit „Not attached to an active page“, weil die Seite noch mitten im Neuladen ist.
- **Entscheidung (Henry):** Test aufteilen. Kein `maxWorkers`, kein längerer Timeout, keine Konfigurationsänderung.
- **Fix:** Drei unabhängige Tests unter `built PWA > release update`, je ein Schritt. Jeder Schritt läuft auf einer eigenen installierten Shell (eigener Port und Origin, eigener Browser-Kontext, `pwaReleaseKit.ts`). Ein Release wird nicht mehr in `dist` geschrieben, sondern pro Shell vom Testserver ausgeliefert. Damit beeinflusst kein Schritt einen anderen Test, und der Folgefehler im Offline-Test entfällt. Installieren, Ankündigen (Schritt 2) sowie Ankündigen und Öffnen des Hinweises (Schritt 3) gehören zum Setup, je Schritt ein eigener `beforeAll`-Block. Die Shell registriert den Worker von einer leeren Seite aus. Die Registrierung durch die App selbst prüft weiterhin „registers the worker …“. Klicks auf „Neue Version“ und „Jetzt aktualisieren“ nutzen `force`. Das ist weiterhin ein echter Mausklick, entfällt ist nur Playwrights Warten auf Frame-Stabilität (unter Last 1,5–2,5 s). Alle sichtbaren und zugänglichen Prüfungen bleiben unverändert.
- **Zuordnung alt → neu** (jede Assertion genau einmal):

  | Alte Assertion (`verifyUpdateShortcut`)                                  | Neuer Test                                                   |
  | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
  | „Neue Version“ vor dem Release unsichtbar                                | `announces a waiting release … keeps the old version`        |
  | „Neue Version“ nach Release, Reload und Update-Prüfung sichtbar          | `announces a waiting release … keeps the old version`        |
  | `update-marker` nach Ankündigung 0 (alte Version läuft)                  | `announces a waiting release … keeps the old version`        |
  | Klick öffnet Dialog „Fahrtmenü“                                          | `opens the focused warning notice … repeated Enter`          |
  | Shortcut `aria-haspopup="dialog"`                                        | `opens the focused warning notice … repeated Enter`          |
  | Fokus liegt auf der Gruppe mit dem Warntext                              | `opens the focused warning notice … repeated Enter`          |
  | Warntext sichtbar                                                        | `opens the focused warning notice … repeated Enter`          |
  | „Jetzt aktualisieren“ ist per `aria-describedby` mit dem Warntext belegt | `opens the focused warning notice … repeated Enter`          |
  | Zweimal Enter: `update-marker` bleibt 0                                  | `opens the focused warning notice … repeated Enter`          |
  | Zweimal Enter: Dialog bleibt offen                                       | `opens the focused warning notice … repeated Enter`          |
  | „Jetzt aktualisieren“ → `load` → `update-marker` 1                       | `applies the waiting release on request and reloads onto it` |

- **Nachher:** Unter Last (14 × `yes`, Load 33–60) `vitest run pwa.build.test.ts` 20 × in Schleife: Die drei Update-Tests sind in 60 von 60 Ausführungen grün. Laufzeiten: Ankündigung 1,7–3,0 s, Hinweis 20–51 ms, Anwenden 2,0–3,7 s. Danach lief ein verschachtelter A/B-Lauf unter derselben Last, alter Test (`HEAD`) und neue Datei abwechselnd. Er war auf 20 Runden angelegt und wurde nach 14 abgebrochen, weil die Maschine nicht mehr bedienbar war. Ergebnis: alter Update-Test 11/14 rot, neue Update-Tests 0/14 rot (höchstens 4,1 s). Danach keine weiteren Lastläufe mehr. Die Bestätigung kommt aus der CI. In beiden Läufen scheiterten vereinzelt die **unveränderten** Tests „registers the worker …“, „hard reload …“ und „offline …“ an 5 s (Schleife: 1/20; A/B: 3/14). Das ist dieselbe Laufzeitgrenze unter Last, aber nicht Teil dieses Auftrags und nicht behoben.
- **Zwischenstand:** Eine erste Fassung installierte jede Shell durch Laden der App und kündigte im Test an. Unter Load ~100 überschritten die Schritte dabei 5 s, die Hooks 10 s (17/20 rot). Korrigiert: Die App-Boots liegen jetzt im `beforeAll`-Setup mit 120 s, und jeder Test enthält nur noch seinen Schritt.
- **CI-Rot nach Merge von `main` (`8bf67bd`, Run 45831079844):** Der Test „applies …“ scheiterte an 5009 ms. Fremdlast gab es dort nicht. Lokal gemessen, ohne Last (Instrumentierung, nicht committet): Klick auf den Shortcut 18 ms, Apply-Button sichtbar 3 ms. Nach dem Apply-Klick wechselt der Worker sofort auf `activating`, `controllerchange` und die Navigation folgen. `activated` kommt genau 1000 ms später (Chromium-Verzögerung), danach `load` nach ~150 ms. Gesamt 1,3 s. In der CI lief derselbe Test auf `b6c0e37` in 4231 ms, auf `8bf67bd` mit dem neuen Menülayout aus `e8818a2` über 5 s. Das CI-Log enthält keine Schrittzeiten. Wie viel davon auf den Shortcut-Teil entfiel, ist nicht gemessen. Belegt ist nur: Die feste 1-s-Aktivierung und das Neuladen gehören zum geprüften Schritt, alles davor nicht. Außerdem lebten bis dahin alle drei Shells gleichzeitig im `beforeAll` des Blocks. Beim Apply renderten also noch zwei weitere App-Instanzen mit Fahrt und WebGL im selben Browser.
- **Korrektur:** Das Öffnen des Hinweises (Shortcut-Klick, Apply-Button sichtbar) liegt jetzt im Setup des Apply-Tests (`openUpdateNotice`). Dieselbe Bedienung ist im Test „opens …“ geprüft. Der Apply-Test macht nur noch Klick → `load` → `update-marker` 1. Jede Shell hat einen eigenen `describe`-Block mit eigenem `beforeAll`/`afterAll`. Damit lebt während eines Schritts nur seine eigene App-Instanz neben der Fixture-Seite. Assertions, Timeout und Konfiguration bleiben unverändert. Lokal ohne Last einmal `vitest run apps/web/src/pwa/`: 26/26 grün, Apply 1,8 s. CI-Ergebnis steht noch aus.

### `apps/web/e2e/fun-mode.spec.ts:25` – behoben

- **Ursache (Test-Race gegen die Fahrt):** Mit `clock=fast` (20×) fährt der Sim-Fahrer ab Seitenaufruf. Die erste Box liegt bei 300 m. Bis das Menü den Modus gesetzt hat, ist der Fahrer unter Last schon über 300 m hinaus. Dann sammelt er sofort eine Box, und die Assertion auf den leeren Slot (`EMPTY_SLOT`) sieht „Leichtgewicht bereit · Taste P“.
- **Rot vorher:** lokal `--repeat-each=10`: 1/10 (Fehlertext „Leichtgewicht bereit · Taste P“). Reviewer: 2/6. Basis `aacd0cd` unter Last (14 × `yes`), `--repeat-each=20`: 7/20 rot, jeweils derselbe Fehlertext.
- **App-Reihenfolge geprüft, kein App-Fehler:** `Engine.setMode` puffert den Wunsch, der nächste Tick wendet ihn an (`enterMode` in `modeTick.ts`). Das Menü zeigt bis dahin den Wunsch (`bindRideMode`). Eine Messsonde unter Last (nicht committet) las die Distanz an drei Punkten ab. Beim Anhaken lag der Fahrer bei 0–40 m, beim Klick auf „Zurück zur Fahrt“ bei 470–730 m. Der Slot zeigte bereits „Leichtgewicht bereit“. Der Spaßmodus galt also vor der 300-m-Box, und die Box wurde korrekt im Spaßmodus gesammelt. Nur der Test liest den leeren Slot zu spät.
- **Fix (Test):** Der Test trennt den Sim-Trainer über den Gerätedialog. Er wartet auf „Paused (auto)“: Ohne Daten rollt der Fahrer aus und pausiert. Erst dann wählt er den Spaßmodus und prüft den leeren Slot. Danach verbindet er den Trainer wieder („Gerät wählen“, neuer Helfer `connectSimTrainer` in `e2e/helpers/simTrainer.ts`) und fährt zur nächsten Box (alle 800 m ab 300 m). Sim-Uhr und Assertions bleiben unverändert. Eine erste Fassung wartete auf „0.0 km/h“. Das scheiterte 19/20, weil die Geschwindigkeit beim Ausrollen unter 0,5 m/s einfriert, sobald die Auto-Pause greift (1,1 km/h). Korrigiert auf den Pausenstatus.
- **Nachher:** Verschachtelter A/B-Lauf unter Last (14 × `yes`), alter Test (`HEAD`) und neuer Test im selben Playwright-Lauf, `--repeat-each=20`: **alt 8/20 rot** („Leichtgewicht bereit · Taste P“), **neu 20/20 grün**. Ein früherer Lauf unter Load 72–108 hatte 21/40 rot. Darunter waren 10/20 im unveränderten zweiten Test (`page.goto`-/Klick-Timeouts nach 30 s) und eine „Paused (auto)“-Zeitüberschreitung. Gewertet ist dieser Lauf als Überlast der Maschine, nicht als Befund zum Fix.

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

### `apps/web/e2e/progress-panel.spec.ts:25` – neu beobachtet, offen

- **Beobachtung (Zweitreview zu #144):** 1× unter Fremdlast stand nach 5 s noch „Waiting for devices“ statt „Sim connected“. Die Sim-Verbindung beim Mount war in dieser Zeit nicht fertig.
- **Ursache:** nicht untersucht. Ein Fix ist nicht umgesetzt. Kein Rückschluss auf `frame.ts` oder den Helper, weil die Zeile vor beiden liegt.

### `apps/web/e2e/garage-shop.spec.ts:37/153` – Ursache belegt, Korrektur in E4-12

- **Rot vorher (14 × `yes`, `--repeat-each=10`, `aacd0cd`):** Im Messlauf beider Tests waren mindestens 8/20 rot. Die Ausgabe war gekürzt, die genaue Zahl fehlt. In der Gegenprobe war :153 10/10 rot. Im Gate-Lauf `E2E_PORT=5194` (Fremdlast) waren :37, :86 und :153 rot. Fehler: Klick oder `check` wartet 30 s auf „visible, enabled and stable“ (Item-Button, Farb-Radio).
- **Ursache (App, Main-Thread-WebGL):** Die Garage-Vorschau (`ui/garage/preview.ts`) zeichnet mit Three.js auf dem Main-Thread bei jedem `requestAnimationFrame`. ADR-019 deckt nur die Fahrtwelt ab. Unter Last misst der Main-Thread mit offener Garage Long Tasks von 1,5–2,5 s, also nur 3–4 Frames in 5 s. `renderer.render` selbst kostet in JS 0–1 ms, die Zeit liegt im synchronen Software-GL-Pfad. Ohne Garage hat derselbe Tab 60 fps. Playwright prüft „stable“ über aufeinanderfolgende rAF-Frames. Mit ~2 s pro Frame reichen 30 s nicht für mehrere Aktionen. Das Element bewegt sich nicht (Rechteck über 6 Frames identisch).
- **Gegenprobe (gleiche Last):** WebGL nur auf Main abgeschaltet (Weltrenderer im Worker unberührt): :153 10/10 grün, unverändert 10/10 rot. Mit stillgelegtem Weltrenderer und laufender Garage gibt es weiter Long Tasks von 0,5 s. Die Ursache ist die Garage, nicht der Welt-Worker.
- **Korrektur:** Die Garage-Vorschau rendert wie ADR-019 in einem Worker mit `OffscreenCanvas`: [E4-12](E4-12-garage-preview-worker.md) / [ADR-032](../decisions/ADR-032-garage-preview-worker.md). Nachher-Messung unter Last offen. Eine Drosselung der Vorschau-Bildrate allein zum Bestehen wäre verbogene Grafikqualität und bleibt ausgeschlossen.

### Server `check-config.test.ts`, `main.shutdown.test.ts`, `admin.test.ts` – Graph-Ursache behoben, Wiederholung des roten Lastszenarios offen

- **Rot vorher (14 × `yes` + Fremdlast, die drei Dateien, 3 Läufe):** 3/3 Läufe rot, je 7/7 Tests (5-s-Timeouts). Im Gate-Lauf (Fremdlast Load 30–70, ohne eigene Last) zusätzlich rot: `database.test.ts`, `strava-migrations.test.ts`, `ledger-migrations.test.ts`. Diese starten **keine** Kindprozesse. In CI nie rot (0 von 34 untersuchten roten `check`-Läufen).
- **Messung pro Schritt:**
  - Kein Kompilieren pro Test. `buildServerProcess` baut einmal pro Datei in `beforeAll` (0,25 s ohne, 1,1 s mit Last).
  - Ein CLI-Kind lädt 1026 ESM-Module aus `node_modules`.
  - Ohne Last braucht ein Kind 0,5–1,2 s Wandzeit bei ~0,5 s CPU.
  - Unter Last braucht es 6,9–9,1 s Wandzeit bei nur ~1,25 s CPU. Davon entfallen 5,5–7,2 s auf das Laden der Module (Sample: überwiegend `__open`, `__psynch_cvwait`). Einzelne Läufe hingen 60–93 s fast ohne CPU.
  - Parallel lief der Echtzeitscanner von Microsoft Defender (`wdavdaemon`) mit über 300 % CPU.
  - `node -e 0` braucht unter Last 0,2–5 s.
- **Ursache, Graph (belegt):** `main.ts` importierte `reflect-metadata`, `@nestjs/core`, `AppModule`, `app.setup` und `admin` statisch. ESM wertet alle statischen Importe vor der argv-Weiche aus. Damit lud auch `check-config` die ganze Nest-App samt Drizzle, better-sqlite3 und openid-client.
- **Ursache, Dateizugriff (Hypothese):** Lokal verlangsamt der Echtzeitscanner von Microsoft Defender vermutlich jedes Öffnen einer Datei. Gestützt wird das durch die `__open`-Samples und die Defender-CPU oben. Ein direkter Nachweis, etwa ein Lauf ohne Scanner, ist nicht möglich. Defender ist verwaltete Rechnerkonfiguration; eine Ausnahme für Temp- oder `node_modules`-Verzeichnisse steht nicht zur Verfügung.
- **Fix (Graph):** `main.ts` ist nur noch Weiche und lädt per `await import()` entweder `check-config.js`, `admin.js` oder das neue `server-boot.ts` (`bootstrap` + `reflect-metadata`). Verhalten, Exit-Codes, Ausgaben, Signale und Shutdown bleiben unverändert, Einstieg bleibt `dist/main.js`. Vite/Rollup legt die Ziele als Chunks unter `dist/assets/` ab. Dockerfile (`pnpm deploy --prod` kopiert ganz `dist/`), `deploy.sh` und `test-docker.sh` rufen weiter `node dist/main.js` auf und brauchen keine Änderung.
- **Messung** (`registerHooks`-Lade-Zähler auf gebautem `main.js`, ohne Test-Hooks, je ein kurzer Lauf, Rechnerlast 50–100):

  | Einstieg       | Module vorher | Module nachher |
  | -------------- | ------------- | -------------- |
  | `check-config` | 971           | 13             |
  | `admin list`   | 971           | 571            |
  | Server-Start   | 971           | 974            |

  Zeiten schwanken unter dieser Last stark (`check-config` vorher 1,4–8,1 s, nachher 0,09 s) und sind nur als Größenordnung zu lesen.

- **Regressionstest:** `check-config.test.ts` „loads only the configuration graph …“ zählt die geladenen Module per Loader-Hook. Er verlangt keine Nest-, Drizzle-, better-sqlite3-, openid-client-, rxjs- oder reflect-metadata-Module und weniger als 30 Module insgesamt.
- **Paketprüfung:** `apps/server/scripts/verify-package.ts` gegen `pnpm --filter @voltonaut/server deploy --prod` grün: gepackte Migrationen, WAL, Health, Bearer-Guard, SIGTERM, fail-closed Mode/Mail. Damit laufen die dynamischen Chunks im echten Paket. Vorher war das Skript schon auf `main` rot, weil `AUTH_TOMBSTONE_HMAC_KEY` fehlte (Pflicht in Produktion seit #96); der Schlüssel ist jetzt wie in `deploy/test-docker.sh` gesetzt.
- **Offen – Wiederholung:** Das rote Lastszenario oben (14 × `yes` + Fremdlast, 3 Läufe) ist mit dem Fix nicht wiederholt. Henrys Rechner war dafür zu stark ausgelastet. Die Migrationstests ohne Kindprozess berührt der Fix nicht.
- **Offen – `admin`:** Der Graph enthält weiter `@nestjs/common` (185 Module) und rxjs (226), weil `AuthDirectory`, `AccountsService`, `EconomyService`, `api-error.ts` und `drizzle.provider.ts` Nest-Dekoratoren, `HttpException` und Injection-Tokens importieren. Option: Dienste und Fehler ohne Nest-Laufzeitimport schreiben und die Nest-Bindung in Module/Provider verlagern. Das ist ein Umbau der Dienste und nicht Teil dieses Fixes.
- **Offen – `main.shutdown`:** startet die volle App absichtlich; der Graph bleibt dort bei rund 970 Modulen.
- **Verworfen:** `node_modules` ins Testartefakt bündeln. Das ändert das geprüfte Artefakt gegenüber Produktion.

## Abnahmekriterien

- [x] AK1 – `ride-recording.spec.ts:158`: Ursache belegt, Fix ohne gelockerte Assertion, 20/20 grün.
- [x] AK2 – Leeres Fenster > 1 s ohne Trainerdaten zeigt „leer oder ungültig“ statt Zod-JSON (Unit-Test, vorher rot).
- [x] AK3 – `pwa.build.test.ts:263`: in drei Einzelschritte aufgeteilt, jede alte Assertion genau einmal. Unter Last: vorher 14/20 Dateiläufe mit rotem Update-Test, nachher Update-Tests 60/60 grün (20 Läufe × 3). A/B: alt 11/14 rot, neu 0/14.
- [x] AK4 – `fun-mode.spec.ts:25`: Modus im Stand gewählt, keine App-Reihenfolgeursache. Vorher unter Last 7/20 rot (alter Test allein). A/B im selben Lauf: alt 8/20 rot, neu 20/20 grün.
- [ ] AK5 – übrige Tests: Ursache belegt. Teilweise erfüllt: ride-menu-dismissal/progress-panel:18 zwei Ursachen behoben, Rest Ressourcenbegrenzung. Garage: Ursache belegt, Fix in [E4-12](E4-12-garage-preview-worker.md) / PR #154 (ADR-032), Nachher-Messung unter Last offen. Server: Graph-Ursache behoben (PR #153), Wiederholung des Lastszenarios offen. progress-panel:25 offen.
- [x] AK6 – `FrameSampler` zeichnet nach einer Frame-Lücke den neuesten Snapshot (Unit-Test, vorher rot).

## Testplan

| AK  | Ebene       | Datei                                                                                                              |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| AK1 | E2E         | `apps/web/e2e/ride-recording.spec.ts` (`--repeat-each=20`)                                                         |
| AK2 | Unit        | `apps/web/src/game/recordedRide.journal.test.ts`                                                                   |
| AK3 | Build       | `apps/web/src/pwa/pwa.build.test.ts` (Schleife, Last, Container)                                                   |
| AK4 | E2E         | `apps/web/e2e/fun-mode.spec.ts` (`--repeat-each=10`)                                                               |
| AK5 | E2E         | `ride-menu-dismissal.spec.ts:49`, `progress-panel.spec.ts:18`, `garage-shop.spec.ts` (`--repeat-each=10/20`, Last) |
| AK5 | Integration | `apps/server/src/check-config.test.ts` „loads only the configuration graph …“ (Modulzahl per Loader-Hook)          |
| AK6 | Unit        | `apps/web/src/world/frame.test.ts`                                                                                 |

## Nicht-Ziele

Keine Änderung an Timeouts, Retries, Sim-Uhr, Vitest-/Playwright-Konfiguration oder Leitplanken.

## Nachweisstand

- **Nachweis PR #136 (AK1, AK2):** `E2E_PORT=5191 mise run check` auf dem damaligen Endstand grün (1918 Unit/Integration, 81 E2E). Vorherige Gate-Läufe unter hoher Rechnerlast scheiterten an den offenen Tests (Server-Timeouts ×6; progress-panel ×1).
- **Nachweis PR #144 (AK6, Teil von AK5):**
  - Lokal unter Fremdlast war `mise run check` nicht grün. Format, Lint, Typecheck, depcruise und guard waren grün. Rot waren Server-Timeouts und Garage-/Welt-Worker-Tests, alle in den offenen Ursachen oben.
  - Das unabhängige Zweitreview bestätigt den Teilumfang. Unter Fremdlast war Base 9/10 rot, nur App-Fix 6/10 rot, beide Fixes 19/20 grün.
  - Nach dem Rebase auf `e8818a2` liefen lokal gezielte Prüfungen, siehe PR. Der volle Gate läuft in CI auf dem exakten Head.
- **Nachweis PR #149 (AK3, AK4):** `fmt:check`, `lint`, `typecheck`, `depcruise` und `guard` grün. `vitest run apps/web/src/pwa/` ohne Last 26/26 grün. Playwright `fun-mode` + `ride-recording` mit `--workers=1 --repeat-each=3` ohne Last 21/21 grün. Ein lokaler Lauf von `mise run check` fand nicht statt, weil Henrys Rechner während der Lastmessung nicht bedienbar war. Das volle Gate ist die CI des PR.
- **Nachweis PR #153 (Server-Teil von AK5):** Server-Build, `check-config`/`main.shutdown`/`admin` einmal grün, `fmt:check`, `lint`, `typecheck`, `depcruise`, `guard` grün. `verify-package.ts` gegen das gepackte Server-Artefakt grün. `deploy/test-docker.sh` nicht gelaufen (Docker-Daemon aus). Kein lokales `mise run check`; das volle Gate ist die CI des PR.

Implementiert und softwaregeprüft: AK1–AK4, AK6. An echter Hardware geprüft: nein (nicht nötig). Bereitgestellt: AK1, AK2, AK6.
