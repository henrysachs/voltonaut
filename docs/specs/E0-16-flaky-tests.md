# Spec E0-16 – Wackelnde Tests

- **Roadmap-Bezug:** E0, Gate-Stabilität (`mise run check` blockiert PRs)
- **Status:** In Arbeit (Teilstand, Draft-PR)
- **Betroffene Module:** `apps/web/src/game`, `apps/web/src/pwa` (nur Tests), `apps/web/e2e`

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
- [x] AK3 – `pwa.build.test.ts:263`: in drei Einzelschritte aufgeteilt, jede alte Assertion genau einmal. Unter Last: vorher 14/20 Dateiläufe mit rotem Update-Test, nachher Update-Tests 60/60 grün (20 Läufe × 3). A/B: alt 11/14 rot, neu 0/14.
- [x] AK4 – `fun-mode.spec.ts:25`: Modus im Stand gewählt, keine App-Reihenfolgeursache. Vorher unter Last 7/20 rot (alter Test allein). A/B im selben Lauf: alt 8/20 rot, neu 20/20 grün.
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
- AK3/AK4 (Branch `fix/flaky-pwa-funmode`): `fmt:check`, `lint`, `typecheck`, `depcruise` und `guard` grün. `vitest run apps/web/src/pwa/` ohne Last 26/26 grün. Playwright `fun-mode` + `ride-recording` mit `--workers=1 --repeat-each=3` ohne Last 21/21 grün. Ein lokaler Lauf von `mise run check` fand nicht statt, weil Henrys Rechner während der Lastmessung nicht bedienbar war. Das volle Gate ist die CI des PR.

Implementiert und softwaregeprüft: AK1–AK4. An echter Hardware geprüft: nein (nicht nötig). Bereitgestellt: nein.
