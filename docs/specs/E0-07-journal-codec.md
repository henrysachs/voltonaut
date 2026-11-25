# Spec E0-07 – Ein Fahrtjournal-Codec für Worker und Server

- **Roadmap-Bezug:** E0, Architekturpflege; keine Roadmap-Checkbox. Grundlage: [E10-02](E10-02-replay-consistency.md), [E10-04](E10-04-complete-ride-delivery.md)
- **Status:** Review
- **Betroffene Module:** `packages/engine` (neu `src/journal/`), `apps/web/src/game`, `apps/server/src/rides`, `apps/server/src/testing`, `apps/server/scripts`

## Ziel

Die Übersetzung zwischen `DeviceEvent`, `RecordingEntryV2`, Engine und Replay-Snapshot war von Hand gespiegelt: Kodierung im Worker-Recorder, Dekodierung im Server-Replay, eine dritte Kopie im Server-Testhelfer, die Physikrevision als Literal an fünf Stellen. Danach besitzt ein reines, öffentliches Modul in `packages/engine` diese Übersetzung. Worker und Server rufen dasselbe Modul auf. Eine neue Eingabe erzwingt eine Entscheidung beim Kompilieren. Verhalten und Wire-Format bleiben unverändert.

## Abnahmekriterien

- [x] AK1 – `packages/engine/src/journal/` exportiert über `@voltonaut/engine`: `encodeJournalInput` (Geräteereignis → Journalentscheidung inkl. abgelehnter Messwerte), `applyJournalEntry` (Eintrag → Engine), `projectReplaySnapshot`, `replaySnapshotEqual`, `replayNumberEqual` und `PHYSICS_REVISION`. Das Modul ist rein: kein DOM, kein Node, keine Uhr; dependency-cruiser bleibt grün.
- [x] AK2 – `encodeJournalInput` unterscheidet erschöpfend über alle `DeviceEvent`-Typen und alle `ControllerButton`-Werte (`switch` mit `never`-Prüfung). `applyJournalEntry` unterscheidet erschöpfend über alle Eintragsarten. `powerUp` ist ausdrücklich als `unrecordable_mode_intent` entschieden (ADR-028), nicht stillschweigend verworfen.
- [x] AK3 – Kopien gelöscht: `apps/web/src/game/recordingObservation.ts`, `validCaptureReading`, `applyEntry`/`trainerFields` in `apps/server/src/rides/replay.ts`, `replaySnapshotEqual`/`replayNumberEqual` in `replayComparison.ts`, `claim`/`applyLive` in `apps/server/src/testing/replay.spec.ts`, die Snapshot-Projektion in `apps/server/scripts/verify-owned-journal.ts`. Es gibt keine Weiterleitungsfassade.
- [x] AK4 – Das Literal `"engine-v1"` steht im Produktions- und Skriptcode nur noch in `PHYSICS_REVISION` und im Vertragsschema `packages/shared/src/api/rides.ts`. Worker-Actor, Worker-Progress, Server-Replay und Verify-Skript nutzen die Konstante.
- [x] AK5 – Verhalten identisch: Kodierungsgrenzen (Leistung 0–2000 W, Kadenz 0–200 rpm, Tempo 0–100 m/s, Puls 1–250 bpm), Journal-Invalidierung `invalid_input`, Track-Invalidierung je Kanal (Tempo ohne Trackkanal), Snapshot-Felder und Vergleichstoleranzen (1e-6 absolut / 1e-9 relativ; `tS`, `dataAgeS`, `lap`, `paused`, `gearIndex` exakt). Alle bestehenden Recorder-, Replay-, Golden- und Fixture-Tests laufen unverändert grün.
- [x] AK6 – Property-Test: Für beliebige vertragskonforme Geräteereignis- und Advance-Folgen und Takt 1–20 liefert die Nachrechnung des kodierten Journals nach jedem Advance dieselben Snapshots, Ride-Events und Trainerkommandos wie die Live-Engine.
- [x] AK7 – `mise run check` und `mise run check:mutation` grün; Mutationsschwelle ≥ 80 % gehalten.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene                              | Datei / Fixture                                                                                    |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| AK1, AK2 | Unit                               | `packages/engine/src/journal/encode.test.ts`, `apply.test.ts`, `replaySnapshot.test.ts`            |
| AK3, AK4 | Typecheck, Lint                    | `mise run check` (tsc, Oxlint, dependency-cruiser), `rg '"engine-v1"' apps packages`               |
| AK5      | Regression                         | `apps/web/src/game/rideRecorder.test.ts`, `engineWorkerCapture.test.ts`, `apps/server/src/rides/*` |
| AK6      | Property (fast-check, fester Seed) | `packages/engine/src/journal/codec.property.test.ts`                                               |
| AK7      | Gate, Mutation                     | `mise run check`, `mise run check:mutation`                                                        |

## Nicht-Ziele

- Kein Umbau von `WorkerDriver`/Recorder-Orchestrierung oder `engineWorkerCore`; Journal-Puffer, Fenster und Grenzbestätigung bleiben in `apps/web/src/game` (ADR-018).
- Keine Vertrags- oder Formatänderung an `RecordingEntryV2`, `ReplaySnapshotV2` oder `physicsRevision` im Schema.
- Kein Vergleich von Ride-Events/Trainerkommandos im Engine-Paket: `replayEventEqual`/`replayCommandEqual` bleiben unverändert im Server.
- Fun-Modus bleibt nicht aufnehmbar (ADR-028).

## Offene Fragen / Risiken

- `PHYSICS_REVISION` und das Schema-Literal in `packages/shared` müssen bei einer neuen Revision gemeinsam wechseln; `shared` darf die Engine nicht importieren.
- Softwaregeprüft am Code; an echter Hardware nicht geprüft und für diese reine Umstrukturierung nicht nötig. Replay-Konsistenz ist kein Hardwareattest.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Keine Roadmap-Checkbox · [x] `docs/01-architecture.md`, `docs/03-engine-physics.md`, `docs/10-testing.md`, `GLOSSARY.md` · [x] kein ADR nötig (setzt ADR-016 um, keine neue Abhängigkeit)
