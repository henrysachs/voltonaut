# Spec E0-08 – Aufgezeichnete Fahrt hinter einer Worker-Schnittstelle

- **Roadmap-Bezug:** E0, Architekturpflege; keine Roadmap-Checkbox. Baut auf [E0-07](E0-07-journal-codec.md) auf.
- **Status:** Review
- **Betroffene Module:** `apps/web/src/game` (`recordedRide`, `engineWorkerCore`, `rideCaptureProtocol`, Tests und `testdata/`)

## Ziel

Bisher ordnete `WorkerDriver` Recorder- und Enginezugriffe selbst: Recorder vor Engine beim Eingang, Scharfschalten ohne Advance beim ersten Aufwachen, Recorder-Advance vor Engine-Advance, einmaliges Leeren der Ausgaben, Progress nur in passenden Modi und danach Ausgaben, Sample und Ansicht. `rideRecorder.test.ts` baute dieselbe Reihenfolge nach. Danach besitzt ein Modul `recordedRide` Engine, Recorder und Progress. Es nimmt Geräteereignis, Aufwachen, Moduswunsch und Aufnahmebefehl mit Workeruhr an und liefert Update oder Antwort. Die Reihenfolge aus ADR-018 ist seine Implementierung. `WorkerDriver` verteilt nur noch Nachrichten und plant Aufwachungen. Verhalten und Nachrichtenprotokoll bleiben gleich.

## Abnahmekriterien

- [x] AK1 – `recordedRide.ts` exportiert `startRecordedRide(init, atMs, timeOriginMs, newId)` mit der Rückgabe `{ ride, update }` und die Schnittstelle `RecordedRide` mit `ingest`, `wake`, `setMode`, `capture`, `stop` und `closed`. `RideRecorder`, Engine und Progress kommen in `engineWorkerCore` nicht mehr vor. Den mutierbaren Actor-Struct (`lastWakeMs`, `lastRequestId`, `intervalId`) gibt es nicht mehr. Uhr und Anfragezähler liegen privat in `recordedRide`. Die Uhr ist eine Union `unarmed | armed | stopped`.
- [x] AK2 – ADR-018 gilt weiter: Aufnahmebefehle machen keinen Advance und schalten nicht scharf. Ereignisse und Kommandos werden einmal geleert und danach an Journal und Update verteilt. Ein ungesicherter Abschluss bleibt nach `engine.dispose` bestehen, bis er passend freigegeben wird, und blockiert solange ein neues `engine.init`.
- [x] AK3 – ADR-011 und ADR-028 gelten weiter: Der erste Aufwachvorgang schaltet nur scharf. Pro Aufwachvorgang laufen höchstens 120 Ticks (`ride.clockSkipped`). Ein Modus ohne `progress` liefert keine Checkpoints. Ein Start in einem nicht aufnehmbaren Modus wird abgelehnt, auch direkt nach dem Wunsch und noch vor dem ersten Tick. Ein solcher Moduswechsel wird bei gehaltener Aufnahme ignoriert und macht danach alle späteren Aufnahmen `local_only` (`ride_mode`).
- [x] AK4 – Nachrichtenprotokoll und Aufnahmen bleiben unverändert: Typen und Felder von `EngineWorkerRequest`/`EngineWorkerResponse`, Journaleinträge, Beobachtungen, Fortschrittszeitstempel und Fehlermeldungen. Alle früheren Erwartungen an Einträge, Snapshots und Progress gelten weiter.
- [x] AK5 – Tests steuern `recordedRide` direkt über eine manuelle Uhr (`testdata/recordedRideHarness.ts`), ohne gefälschten Worker-Scope, ohne gefälschte Timer und ohne Protokollliterale. Ein dünner Test `engineWorkerCore.test.ts` prüft nur Verteilung, Actor-Filter, Timer und die Freigabe nach Dispose. `requireLatestUpdate` und die Setup-Duplikate sind entfernt.
- [x] AK6 – Keine Parallelfassade: `engineWorkerActor.ts` ist gelöscht. `isNewCaptureRequest` bleibt als Protokollregel in `rideCaptureProtocol.ts`, nur `recordedRide` ruft sie auf. Es gibt keine neue Abhängigkeit und keine geänderte Leitplanke. `mise run check` ist grün.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene         | Datei                                                                             |
| -------- | ------------- | --------------------------------------------------------------------------------- |
| AK1, AK6 | Typecheck     | `mise run check` (tsc, Oxlint, dependency-cruiser)                                |
| AK2, AK4 | Unit          | `apps/web/src/game/recordedRide.test.ts`, `recordedRide.journal.test.ts`          |
| AK3      | Unit          | `recordedRide.modes.test.ts`, `recordedRide.progress*.test.ts`                    |
| AK2, AK5 | Unit (Worker) | `engineWorkerCore.test.ts`                                                        |
| AK4      | Integration   | `engine-link.test.ts`, `rideSession.test.ts`, E2E im Sim-Modus (Teil von `check`) |

## Nicht-Ziele

- Keine Änderung am Fahrtjournal-Codec (E0-07), an `RecordingJournal`, am Recorderinhalt oder an der Server-Nachrechnung.
- Keine Änderung an `engine-link.ts` oder am Mainthread-Protokoll.
- Kein Umbau von `engineWorkerProgress.ts`.

## Offene Fragen / Risiken

- `RideRecorder` bleibt als schmale interne Schnittstelle in `rideCaptureProtocol.ts`. Nur `recordedRide` ruft sie auf.
- Am Code softwaregeprüft. An echter Hardware nicht geprüft. Für diese reine Umstrukturierung ohne Protokolländerung ist das nicht nötig.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Keine Roadmap-Checkbox · [x] `docs/01-architecture.md`, `GLOSSARY.md` · [x] Kein ADR nötig, setzt ADR-011, ADR-018 und ADR-028 unverändert um.
