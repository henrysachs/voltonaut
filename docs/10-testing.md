# 10 – Verifikationsstrategie

Grundsatz: **Was ein Agent nicht maschinell beweisen kann, gilt als nicht erledigt.** Jede Ebene unten hat einen Befehl, einen Ort für Testdaten und eine Regel, wer Baselines ändern darf. Werkzeuge: Vitest, fast-check, Playwright, Stryker, dependency-cruiser (ADR-007).

## 1. Ebenen im Überblick

| Ebene               | Werkzeug                                                    | Ziel                                                               | Läuft in                                                        |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Unit                | Vitest                                                      | reine Funktionen (Parser, Physik, Gänge, Regeln)                   | `mise run check`                                                |
| BLE-Replay          | Vitest + `fixtures/ble/*.json`                              | echte Mitschnitte von Henrys Hardware → Decoder-/Adapter-Verhalten | `check`                                                         |
| Golden              | Vitest + `fixtures/rides/*`                                 | feste Fahrt → exaktes Ergebnis (Physik, XP, Volts)                 | `check`                                                         |
| Property-based      | **fast-check**                                              | Invarianten über Zufallseingaben                                   | `check`                                                         |
| Contract            | Zod-Schemas `packages/shared` + `fixtures/api/*`            | Client und Server sprechen dieselbe API                            | `check`                                                         |
| Integration Server  | `@nestjs/testing` + Supertest + echte WS + SQLite in-memory | Module zusammen, inkl. Transaktionen                               | `check`                                                         |
| Progress            | Vitest + Nest/SQLite + Memory-IDB + Playwright              | Consent, Offline-Outbox, Checkpoint-Annahme, Idempotenz            | `check`; echte IDB-Offlineprüfung bleibt offen                  |
| E2E                 | Playwright, Sim-Modus                                       | Nutzerflüsse im echten Browser                                     | `check` (Chromium headless)                                     |
| Visuelle Regression | Playwright `toHaveScreenshot`                               | 3D-Szenen, HUD, Garage                                             | `check`                                                         |
| Performance-Budget  | Playwright + `renderer.info` + Frame-Timing                 | Draw Calls, Dreiecke, Speicher, JS-Frame-Zeit                      | `check` (deterministische Teile), `mise run perf` (fps manuell) |
| Coverage            | Vitest v8                                                   | Schwellen auf Kernpaketen                                          | `check`                                                         |
| Mutation            | **Stryker** (Vitest-Runner)                                 | Testqualität der Kernlogik                                         | eigener CI-Job `mutation`                                       |

## 2. BLE-Replay-Tests

- Quelle: Sniffer-Exporte der Hardware-Session (`02-bluetooth.md` §5) → `fixtures/ble/<gerät>-<firmware>-<datum>.json` (`{ meta, gatt, log: [{tMs, char, dir, hex, marker?}] }`).
- `packages/ble` hat einen **ReplayTransport**, der die GATT-Schnittstelle des Adapters implementiert und die aufgezeichneten Notifications zeitgetreu (oder beschleunigt) abspielt. Getestet wird der **echte Adapter-Code**, kein Mock (passt zu anti-slop `no-module-mocking`).
- Erwartungen kommen aus den Markern: „RS gedrückt" im Log ⇒ genau ein `controller.button {shiftUp, pressed:true}` und ein `released`. Trainer-Log ⇒ Watt/Kadenz-Folge gleich der dekodierten Referenz (`*.expected.json`).
- Jeder neu entdeckte Protokollfall (z. B. Play FW 2.0.1) = neue Fixture + Test, bevor der Decoder geändert wird.

## 3. Golden-Tests

- `fixtures/rides/<name>.input.json`: Route-ID, RiderProfile, Gang-Wechsel und 1-Hz-Leistungs-/Kadenz-Reihe (z. B. 60 min Henry-typisches Profil, 10 min Bergsprint, 5 min Abfahrt ohne Treten).
- `<name>.golden.json`: Distanz, Höhenmeter, kJ, Segmentzeiten, Endgeschwindigkeit, XP, Volts, Badges, Trainer-Kommando-Folge (Hash). Zahlen auf 6 Nachkommastellen gerundet (plattformstabil); Vergleich **exakt**.
- Gleiche Fixtures laufen gegen `packages/engine`/`rules` direkt **und** gegen den Server-Endpunkt `POST /v2/rides` (Server muss identisch rechnen).
- Aktualisieren nur mit `mise run golden:update` + Begründung im PR; Dateien sind CODEOWNERS-geschützt.

## 4. Property-based Tests (fast-check)

| Paket                                                                   | Eigenschaft                                                                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| engine/physics                                                          | Mehr Watt ⇒ nie langsamer (gleiche Ausgangslage, Steigung, Masse)                                           |
| engine/physics                                                          | Steilere Steigung ⇒ bei gleicher Leistung nie schneller; Geschwindigkeit nie negativ, nie NaN/∞             |
| engine/physics                                                          | Windschatten ⇒ bei gleicher Leistung nie langsamer als ohne                                                 |
| engine/gears                                                            | Höherer Gang ⇒ nie leichter (effektive Steigung/Zielleistung monoton steigend bei gleicher Kadenz/Steigung) |
| engine/gears                                                            | Gang bleibt in [1, 24]; n× hoch dann n× runter = Ausgangsgang                                               |
| engine/trainer                                                          | FTMS-Encoder: Dekodieren(Enkodieren(x)) ≈ x innerhalb Auflösung; Clamping statt Überlauf                    |
| ble/parsers                                                             | Beliebige Bytefolgen ⇒ Parser wirft nicht, liefert `null`/Fehlerobjekt                                      |
| rules/economy                                                           | Volts-Kontostand nie negativ bei beliebiger Folge aus Verdienst/Käufen; Ledger-Summe = Kontostand           |
| rules/xp                                                                | XP monoton in Distanz/Höhenmetern; Level monoton in XP                                                      |
| engine/segments                                                         | Segmentzeit ≤ Fahrzeit; Start vor Ende                                                                      |
| engine/journal                                                          | Kodiertes Journal nachgerechnet ⇒ nach jedem Advance gleiche Snapshots, Events, Kommandos wie live (E0-07)  |
| Seeds werden bei Fehlschlag ausgegeben und als Regressionstest fixiert. |

## 5. Contract-Tests

- Alle Requests/Responses/WS-Nachrichten sind Zod-Schemas in `packages/shared/src/api|ws`.
- `fixtures/api/*.json`: Beispielnachrichten pro Endpunkt. Client-Test: API-Client parst jede Fixture. Server-Test: In Tests prüft ein Interceptor **jede ausgehende Antwort** gegen ihr Schema; zusätzlich E2E-Requests gegen die Fixtures.
- Breaking Change eines Schemas ⇒ beide Seiten rot; Versionierung über `/v1` → `/v2`.

### Progress

- Shared-Tests prüfen lokale Batches mit höchstens 120 Facts/6 Sekunden und Serverbereiche mit höchstens 1200 Checkpoints/1200 Facts/60 Sekunden. Der Worker liefert gerundete Unix-Zeiten in Millisekunden; die Serverprüfung lehnt worker-relative Zeiten ab.
- Memory-IDB-Tests prüfen Kapazität, Widerruf, Retry, Quittungen und den deterministischen 1200-Append-Probelauf. Der Probelauf läuft in einem eigenen Vitest-Projekt nach den übrigen Tests, damit fremde Builds seine 25-ms-p95- und 50-ms-Max-Schwelle nicht verfälschen. Ein Append validiert den offenen Batch nur einmal an der IndexedDB-Grenze; Hash, Fortsetzung und neue Zeilen arbeiten danach mit dem bereits geprüften Batch. Ein Playwright-Test prüft Sequenzindex und Persistenz nach Reload in echter IndexedDB. Echte Offline-Reload-Prüfungen bleiben offen.
- Die Lieferung liest höchstens zehn ausstehende Zeilen pro Seite über den Primärschlüssel-Cursor. `prepareDelivery` versiegelt den offenen Batch und entfernt quittierte Zeilen über den Statusindex, ohne den ganzen Store zu lesen. `nextRetryAt` liest den frühesten automatischen Retry über den `account-retry`-Index. Ein ausdrücklicher Consent-Widerruf liest einmal alle ausstehenden Zeilen, um sie vollständig zu blockieren.
- Nest-Tests mit echter SQLite-Datenbank prüfen Consent, Sessionbindung, Tickfolge, Belohnungstag, atomare Volts-Buchung, Konkurrenz und identische Präfix-Wiederholungen.

### Datenbankmigrationen

- Upgrade-Tests nutzen ausschließlich `apps/server/src/testing/migration-harness.spec.ts` ([E0-13](specs/E0-13-migration-harness.md)). Muster: `upgradeFrom("<tag>", seed)` öffnet eine echte SQLite-Datei über `createDatabase` am benannten Tag. Danach legt der Hook den Altbestand an, `open()` migriert auf den Kopfstand und erlaubt ein erneutes Öffnen. Geprüft werden unveränderte Altzeilen und die neuen Invarianten.
- Startpunkte sind Tags aus `drizzle/meta/_journal.json`, keine Indizes. Kopfstand und Migrationszahl liefert nur das Journal (`expectHead`); kein Test schreibt die Anzahl der Migrationen hart.
- Eine neue Migration bekommt einen eigenen Upgrade-Test ab dem vorherigen Tag. Ergänzt sie nur Tabellen oder Indizes, bleiben bestehende Upgrade-Tests unverändert (Tabellen per Probelauf belegt, Indizes per Codelektüre); die Tabellenliste in `database.test.ts` wird bewusst ergänzt. Neue Spalten an geseedeten Tabellen machen deren `SELECT *`-Vergleiche bewusst rot und werden im betroffenen Test nachgezogen.
- Kontoinhaber legt `seedOwners` über die Spaltennamen des Schemas an; übrige Testzeilen nennen ihre Spalten (kein positionsabhängiges `INSERT … VALUES`). Temp-Verzeichnisse kommen aus `scratchDirectory` und werden nach jedem Test entfernt. `onTestFinished` läuft in umgekehrter Registrierungsreihenfolge; Hooks, die vor dem Löschen laufen müssen, werden nach dem Verzeichnis registriert.

## 6. E2E (Playwright, Sim-Modus)

Flüsse (je ein Test): App lädt → Fake-Trainer/HR/Play verbinden → Fahrt starten → 2× hoch, 1× runter (HUD-Gang korrekt, Trainer-Kommandos im Sim-Trainer korrekt) → 2 km fahren (Sim-Zeit beschleunigt) → Blitz-Pickup eingesammelt → Fahrt beenden → Zusammenfassung zeigt Volts → (ab E5, gegen lokalen Testserver) Upload bestätigt, Kontostand gestiegen → (ab E7) Item kaufen, ausrüsten.
Sim-Modus hat eine **Test-Uhr** (`?sim=1&clock=fast`), damit Fahrten in Sekunden laufen.

## 7. Visuelle Regression

- Deterministische Szenen über URL: `?sim=1&scene=fixture&seed=42&time=12:00&weather=clear&camera=chase&freeze=1` (Animationen bei fixer Zeit `t` angehalten, Partikel mit Seed).
- Motive: Startbereich, KOM mit Zuschauern, Nacht + Regen, HUD, Garage-Showroom, Zusammenfassung.
- Rendering in CI: Chromium headless mit SwiftShader/ANGLE (Software-GL), feste Viewport-Größe 1280×720, `deviceScaleFactor: 1`, im offiziellen Playwright-Docker-Image (gleiche Fonts/Treiber) → Baselines **nur dort** erzeugen.
- Toleranz: `maxDiffPixelRatio: 0.01`, `threshold: 0.2`. Baselines unter `apps/web/e2e/__screenshots__/`, CODEOWNERS-geschützt; Update via `mise run visual:update` mit Begründung.

## 8. Performance-Budget-Test

- Skript-Szene „Peloton am KOM": 30 Bots, Zuschauer, Regen, Abend, alle Effekte auf High, 60 s Sim.
- **In CI (deterministisch):** `renderer.info` – Draw Calls ≤ 150, sichtbare Dreiecke ≤ 500 k, Geometrien/Texturen ohne Leak (Anzahl nach 60 s = nach 5 s), GPU-Texturspeicher-Schätzung ≤ 64 MB, Asset-Gesamtgröße ≤ Budget (`04-world-3d.md`), JS-Zeit pro Frame (CPU, ohne GPU) p95 ≤ 4 ms.
- **Manuell auf Henrys Laptop:** `mise run perf` öffnet die Szene, misst fps p5/p50 und Frame-Time p95 und schreibt `perf-report.json`; Ziel ≥ 60 fps p50, ≥ 50 fps p5 auf „High" oder „Medium". Headless-CI kann echte GPU-fps nicht messen – ehrlich so dokumentiert.

## 9. Coverage & Mutation

- Coverage (Vitest v8), Fehlschlag unter Schwelle: `packages/engine`, `packages/rules`: Lines/Statements/Functions ≥ 90 %, Branches ≥ 85 %; `packages/shared`, `packages/ble` (Parser): ≥ 85/80 %; `apps/server`: ≥ 75/70 %; `apps/web`: ≥ 60 % (Rendering wird visuell/E2E geprüft).
- Mutation (Stryker, Vitest-Runner, `incremental`): Die Konfiguration prüft alle Produktionsdateien unter `packages/engine/src/**` und `packages/rules/src/**`, außer den jeweiligen `index.ts`-Einstiegspunkten. Damit sind ab E3 auch `elevation/`, Routendaten und `internal/` enthalten. **Mutation Score ≥ 80 % (break-Schwelle)**, Ziel 90 %.
- CI: Job `mutation` läuft auf PRs, die diese Pfade ändern (Pfadfilter), und nächtlich; ist dann **zusätzlicher Required Check**. `mise run check` bleibt das universelle Gate; `mise run check:mutation` lokal verfügbar. (Bewusste Ausnahme von „CI = genau `mise run check`", weil Mutationstests zu langsam für jeden Lauf sind.)

## 10. Regeln für Agenten (Prozess)

1. **Spec pro Aufgabe:** Jede Aufgabe startet mit `docs/specs/<Etappe>-<nr>-<slug>.md` (Vorlage `docs/specs/_template.md`): Ziel, Bezug zur Roadmap-Checkbox, **Abnahmekriterien** (aus `07-roadmap.md` übernommen/verfeinert), Testplan (welche Ebenen oben), betroffene Module.
2. **Geschützte Dateien:** Lint-/TS-/depcruise-/Formatter-Config, `tools/oxlint/**`, `scripts/guard.mjs`, CI, Golden-Dateien, Screenshot-Baselines, BLE-Fixtures, ADRs → CODEOWNERS (`@henrysachs`) **und** CI-Check `guard` (Änderung an Leitplanken ohne ADR-Änderung im selben PR ⇒ rot; Baseline-/Golden-Änderung ohne PR-Label `baseline-update` ⇒ rot).
3. **Neue Abhängigkeiten nur mit ADR** (+ Eintrag `docs/dependencies.md`).
4. **Zweiter Agent reviewt jeden PR** gegen die Abnahmekriterien der Spec (Checkliste `docs/specs/_review-checklist.md`: Kriterien erfüllt? Tests decken Kriterien ab? Keine Lockerungen? Doku aktualisiert?). Merge erst nach Review + grünem `check` + Henrys Freigabe für geschützte Dateien.
5. **Modulübergreifende PRs sind erlaubt.** Es gibt keine Ein-Paket-pro-PR-Regel; Grenzen setzt dependency-cruiser durch, nicht der PR-Zuschnitt. PRs sollen trotzdem eine Spec abdecken.
6. „Fertig" heißt: `mise run check` grün (+ `mutation` falls betroffen), Spec-Kriterien abgehakt, Review bestanden.
