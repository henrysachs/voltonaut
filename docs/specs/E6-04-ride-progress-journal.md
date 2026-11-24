# Spec E6-04 – HR-freie Ride-Progress-Checkpoints

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E6, serverseitiger Fortschritt aus akzeptierten Fahrten. Diese Lieferung ist nur die projectionsseitige Grundlage.
- **Basis:** `6194e6a1fcb23c69850055a4c5685f3a5e6c561c`.
- **Status:** Implementiert und softwaregeprüft. Gesamtgate, Mutation, Build und unabhängiges Review sind grün; Merge und CI stehen noch aus.
- **Betroffene Module:** `packages/shared`, `packages/engine`, `apps/web/src/game`, Dokumentation. Keine neue Abhängigkeit.

## Ziel und gewählte Form

Gewöhnliches Fahren soll später automatisch Kontofortschritt auslösen, unabhängig vom manuellen Aufnahmefenster. E6-04 erzeugt dafür aus den vorhandenen nativen Tickfakten begrenzte, unveränderliche Checkpoints. Leistung, Kadenz und Physikbeiträge bleiben erhalten; Pulsdaten gehören ausdrücklich nicht in diesen Vertrag.

Ein reiner Shared-Projector konsumiert `NativeTickFacts[]` genau einmal pro Engine-Aufwachen. Der Engine-Worker besitzt ihn zusammen mit einer Journal-UUID je Fahrsitzung. Ein zweiter Recorder würde Zustand und Tickbelege duplizieren. Ein reiner Aggregatzähler würde die nativen Tickbeiträge und späteren Abschnittsgrenzen verlieren. Beide Formen sind verworfen.

`RideRecorder`, `RecordingV2`, bestehende Aufnahmen und Identitäten bleiben unverändert. Die Checkpoints sind weder eine Aufnahme noch ein Upload und berechnen keine Belohnung.

## Abnahmekriterien

- [x] AK1 – `NativeTickFactsSchema` ist strikt und readonly und enthält genau `powerW`, `cadenceRpm`, `timeS`, `distanceM`, `elevationGainM` und `energyKj`. Leistung und Energie sind endlich und signed, Kadenz ist endlich und nichtnegative; Zeit liegt von 0 bis 0,05 s, Strecke und Höhe sind nichtnegative. Leistung und Kadenz erhalten bewusst keine Protokoll- oder Reward-Plausibilitätsgrenzen, da berechnete CPS-Kadenz den FTMS-Wertebereich überschreiten kann. HR-, RR-, Konto- und Gerätefelder sowie unbekannte Felder werden abgewiesen.
- [x] AK2 – `RideProgressCheckpointSchema` ist strikt und readonly, versioniert auf 1 und validiert Journal-UUID, Sequenz, Tickgrenzen, Zeitfenster, Quelle, Takt, Revisionen, enge Physikparameter, 1–120 Fakten und Qualitätsdaten. `endTick === startTick + facts.length` und `endedAtMs >= startedAtMs` sind verbindlich. Unbekannte Felder werden auch in verschachtelten Objekten abgewiesen.
- [x] AK3 – `createRideProgressProjector()` besitzt Sequenz und nächsten Tick. Leere Fakten liefern `undefined` und verändern keine Zähler. Jeder nichtleere Push liefert genau einen eingefrorenen Checkpoint mit kopierten, eingefrorenen Fakten. Mehrere Pushs sind lückenlos und deterministisch; 120 Fakten sind erlaubt, 121 nicht.
- [x] AK4 – `packages/engine` verwendet und exportiert denselben Shared-Typ `NativeTickFacts`. Laufzeitform und Advance-, Physik-, Event- und Kommandoverhalten bleiben identisch.
- [x] AK5 – Der Worker besitzt einen Projector und eine injizierbar erzeugte Journal-UUID je Fahrsitzung. Er ruft `advance()` genau einmal pro regulärem Wake auf und projiziert vorherige/aktuelle Wake-Zeit, Quelle, Takt, Revisionen, `riderParamsFromProfile(profile)`, sowie Pause, Datenalter und `clockSkipped` aus dem Snapshot beziehungsweise den einmal abgeleierten Events.
- [x] AK6 – `engine.update` kann einen Progress-Checkpoint enthalten. Initialisierung und Advances ohne Tick liefern `undefined`. Schnelltakt 20 erzeugt 20 Fakten. HR verändert weiterhin den Snapshot, aber nicht die Progress-Bytes. Aufnahmebefehle erzeugen keine zusätzlichen Advances oder Checkpoints; Dispose stoppt die Projektion. `EngineLink` und `createRideSession` reichen jeden Wert einschließlich `undefined` über den optionalen `onProgress`-Callback weiter.
- [x] AK7 – Bestehende Native-Facts-, Recorder-, Replay- und Golden-Prüfungen bleiben unverändert grün. Gezielte Shared-/Engine-/Worker-Tests, type-aware Oxlint, Oxfmt und `tsc -b` sind grün. Das vollständige Gate besteht mit 1.108 Tests und 62 E2Es. Mutation erreicht 95,84 % bei Schwelle 80, der Build ist grün und das unabhängige Review ist APPROVE.

## Testplan (`docs/10-testing.md`)

| AK  | Ebene                       | Datei / Fixture                                                                                           |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1–3 | Vitest, Shared-Verträge     | `packages/shared/src/rideProgress.test.ts`, `rideProgress.projector.test.ts`                              |
| 4   | Vitest, vorhandene Engine   | `packages/engine/src/internal/native-facts.test.ts` und bestehende Suite                                  |
| 5–6 | Vitest, Worker und Callback | `engineWorkerCore.test.ts`, `engineWorkerProgress*.test.ts`, `engine-link.test.ts`, `rideSession.test.ts` |
| 7   | Vitest, bestehende Aufnahme | `engineWorkerCapture.test.ts`, `rideRecorder.test.ts`, Golden-/Replay-Tests                               |
| 7   | Statik und Typen            | Oxfmt, type-aware Oxlint, `pnpm exec tsc -b --pretty`                                                     |

## Qualität als terminaler Batch-Zustand

`quality` beschreibt das Ende des ganzen Checkpoint-Batches, nicht jeden Tick. Pausierte Ticks sind an den Fakten selbst erkennbar: `timeS === 0`; `timeS`, `distanceM`, `elevationGainM` und `energyKj` sind null. Unter der Engine-Invariante „konstante Eingaben je Advance“ bedeutet terminales `paused: false`, dass dieser Batch keine pausierten Ticks enthält.

Die finale `dataAgeS` und die Faktenzahl rekonstruieren den einzigen Frischewechsel innerhalb des Batches: Frische Trainerdaten setzen den Zähler nur im ersten Tick eines Advances zurück; die folgenden Ticks erhöhen ihn jeweils um 0,05 s. `clockSkipped` gilt für den gesamten Batch, sobald die abgeleierten Events ein `ride.clockSkipped` enthalten.

## Nicht-Ziele

Keine Persistenz, Datenbank, HTTP, Zustimmung, Kontozuordnung, Quellenfreigabe, XP-/Volts-Buchung, Strava, UI oder neue Aufnahme. Keine HR-, RR-, Konto- oder Gerätedaten im Progress-Vertrag. Keine Änderung an Trainersteuerung, Physik, Events, Kommandos, vorhandenen Aufnahmen, Replay-Fixtures oder Golden-Dateien. Keine Hardware- oder Produktionsbehauptung.

## Aufgeschobene Politikfragen

- Transport-Batches und Offline-Kapazität: Welche Abschnittgröße, welcher Speicher- und Wiederholungsfall ist zulässig?
- UTC-Tagesgrenze: Wie werden Abschnitte über Mitternacht und Wochen-/Tageslimits später zugeordnet?
- Quellenassurance: Welche Prüfung unterscheidet Sim, BLE-Selbstauskunft und tatsächlich attestierte Messwerte?
- HR-Umfang künftiger manueller Uploads: Bleiben bestehende manuelle Archive unverändert und welche neuen Exporte dürfen HR enthalten?
- Historiendarstellung: Wie werden bestätigte, unbestätigte, verworfene und überlappende Abschnitte dauerhaft lesbar?

## Nachweise und Grenzen

Gezielt grün: 132 Tests in 16 Dateien, einschließlich nativer Fakten, Recorder, V2-Aufnahme, Callback, Golden und Server-Replay. Das vollständige Gate ist mit 1.108 Tests und 62 E2Es grün. Mutation erreicht 95,84 % bei Schwelle 80, Build, Oxfmt, type-aware Oxlint und `tsc -b` sind grün. Das unabhängige Review ist APPROVE. Echte Hardware, Upload, Vergabe und Deployment sind nicht geprüft oder bereitgestellt.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Spec angelegt.
- [x] `docs/03-engine-physics.md` nennt gemeinsamen Typ und HR-freie Projektion.
- [x] `docs/06-gamification.md` trennt Projektionsgrundlage von Freigabe und Vergabe.
- [x] `docs/07-roadmap.md` nennt den begrenzten Teilschritt.
- [x] ADR: nicht erforderlich; die Architekturform ist in dieser Spec festgehalten.
