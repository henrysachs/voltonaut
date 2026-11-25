# Spec E0-14 – Fahrtsitzung im Hauptthread vertiefen

- **Roadmap-Bezug:** E0, Architekturpflege (kein eigener Roadmap-Punkt; Kandidat 9 der Architekturprüfung)
- **Status:** Review
- **Betroffene Module:** `apps/web/src/game` (`rideSession`, `engine-link`), `apps/web/src/ui/rideMode.ts`, `apps/web/src/{main,app,rideViews}.ts`

## Ziel

Die laufende Fahrt hat im Hauptthread genau einen Besitzer. `main.ts` wählt nur noch Sim- oder Echtgeräte und hängt Ansichten ein. Initialisierungsreihenfolge, Bus-Weiterleitung, Verbindungsstatus, Segmente und Aufräumen liegen in `game/rideSession.ts`. Für Nutzer ändert sich nichts: Fahrt, HUD, Aufnahme und Spielmodus verhalten sich wie vorher.

## Ausgangslage

- `rideSession.ts` gab nur `{ link, segments }` zurück; Aufrufer griffen über `session.link` durch.
- `main.ts` besaß die Init-Reihenfolge, vier Bus-Abos für `link.ingest`, den Verbindungsmonitor und eine tote Dispose-Kette in `startHud` (die App wurde nie gestoppt).
- Die Route-ID wurde zweimal übergeben (`createRideSession` und `link.init`).
- `ingest`/`setMode` vor `init` verwarf der Link still; die richtige Reihenfolge war Wissen des Aufrufers.
- `ui/rideMode.ts` hielt eine eigene Moduskopie und riet, wann der Worker eine Anfrage ignoriert hatte, obwohl die Engine den Modus besitzt (ADR-028 §5) und `snapshot.mode` existiert.
- `ridePresentation.ts` (41 Zeilen) und `rideRecording.ts` im Wurzelordner (18 Zeilen) bestanden den Löschtest nicht; `rideRecording.ts` kollidierte namentlich mit `ui/rideRecording.ts`.

## Abnahmekriterien

- [x] AK1 – `createRideSession(options, newPort?, newId?)` erhält Bus, Route, Profil, Quelle, Uhrfaktor, optionale Trainer-Senke und `onProgress`. Unbekannte Routen werfen, bevor ein Port entsteht.
- [x] AK2 – Eine Engine-Verbindung existiert nur initialisiert: `createEngineLink(port, init, …)` sendet `engine.init` beim Erzeugen. `init()` gibt es nicht mehr. Jede spätere Nachricht trägt dieselbe Actor-ID.
- [x] AK3 – Die Sitzung leitet genau `ENGINE_INPUT_TYPES` (`trainer.data`, `hr.data`, `controller.button`, `device.status`) vom Bus weiter. Das entspricht dem, was Engine (`ingest`) und Recorder (`device.status`) konsumieren. `controller.battery` und `trainer.controlResult` gehen nicht zum Worker.
- [x] AK4 – Pro Worker-Update ruft die Sitzung in dieser Reihenfolge auf: Trainer-Snapshot, Segmentvorschau, Trainer-Kommandos, Fortschritt. Bei Worker- oder Init-Fehler wird die Segmentvorschau ungültig, ohne erfundenen Snapshot.
- [x] AK5 – Lesemodell: `snapshot()`, `connected()`, `segments()`, `mode()` (aus `snapshot.mode.kind`), `recording`, `subscribe()`. Absicht: `requestMode()`.
- [x] AK6 – `dispose()` beendet Bus-Abos, Verbindungsmonitor und Worker-Actor und macht die Segmentvorschau ungültig. Der Worker stoppt sein Intervall.
- [x] AK7 – `ui/rideMode.ts` führt keine eigene Moduskopie. Es zeigt den Modus des letzten Engine-Ticks oder eine noch unbeantwortete Anfrage. Eine durch eine laufende Aufnahme unzulässige Anfrage verfällt; der Picker sendet dafür keine Korrekturanfrage mehr. Die Worker-Ablehnung bleibt als zweite Verteidigung (ADR-028).
- [x] AK8 – `ridePresentation.ts` und Wurzel-`rideRecording.ts` sind in `rideViews.ts` aufgegangen (HUD, Aufnahmepanel, Moduswahl, 3D-Szene). `RideHudSource` hat kein `dispose` mehr; die Sitzung besitzt die Lebensdauer.
- [x] AK9 – Ein zweiter echter Adapter an der Worker-Naht: `game/testdata/loopbackWorker.ts` verbindet `EngineWorkerPort` in-process mit dem echten Worker-Treiber (`bindEngineWorker`), manueller Uhr und strukturiertem Klonen. Damit laufen Sim-Geräte → Snapshot/Segmente/Modus/Kommandos und Aufnahme Start → Abschluss → Freigabe ohne Playwright.
- [x] AK10 – Sim-Modus und alle bestehenden E2E-Fälle bleiben grün (`mise run check`, `E2E_PORT=5189`).

## Testplan (`docs/10-testing.md`)

| AK       | Ebene                   | Datei                                                               |
| -------- | ----------------------- | ------------------------------------------------------------------- |
| AK1, 3–6 | Vitest, Fake-Port       | `apps/web/src/game/rideSession.test.ts`                             |
| AK2      | Vitest, Fake-Port       | `apps/web/src/game/engine-link.test.ts`, `engine-link.mode.test.ts` |
| AK5–6, 9 | Vitest, Loopback-Worker | `apps/web/src/game/rideSession.loopback.test.ts`                    |
| AK7      | Vitest, Fake-Ansicht    | `apps/web/src/ui/rideMode.test.ts`                                  |
| AK8      | Vitest + E2E            | `apps/web/src/app.test.ts`, `apps/web/e2e/*.spec.ts`                |
| AK10     | Playwright (Sim)        | `mise run check`                                                    |

## Nicht-Ziele

- Keine Änderung am Worker-Protokoll, an `engineWorkerCore`, `engineWorkerActor`, `rideRecorder` oder am Journal-Codec.
- Keine Änderung an `rideDevices.ts` und seiner Trainer-Kommandosenke; die Sitzung reicht `onSnapshot`/`onCommands` nur durch.
- ADR-011 (Engine im Dedicated Worker) bleibt unverändert.

## Offene Fragen / Risiken

- `onProgress` hat einen Produktionsverbraucher (`account.progress.accept` aus `browserAccount.ts`). Es bleibt deshalb Teil der Sitzungsoptionen.
- `mode()` liefert den Modus des letzten Ticks. Zwischen `requestMode` und dem nächsten Update zeigt der Picker die ausstehende Anfrage. Kommt nie ein Update (Worker tot), bleibt die Anfrage sichtbar; die Fahrt ist dann ohnehin unverfügbar.
- Die Moduswahl aktualisiert sich jetzt bei jedem Worker-Update statt nur bei Aufnahmeänderungen. Der Hinweistext wird nur bei Änderung geschrieben, damit die Live-Region nicht erneut ansagt.
- Implementiert und am Artefakt softwaregeprüft (Vitest, Sim-E2E). An echter Hardware geprüft: nein. Bereitgestellt: nein.

## Doku-Updates (Pflicht beim Abschluss)

- [ ] Roadmap-Checkbox (entfällt, kein Roadmap-Punkt) · [x] `docs/01-architecture.md` (Composition Root, Fahrtsitzung) · [ ] ADR (nicht nötig: keine neue Entscheidung, Leitplanke oder Abhängigkeit)
