# Spec E10-13 – Zusammenhängende Welt, Schritt 4: Aufnahme- und Replay-Vertrag mit Welt und Weg

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, „Zusammenhängende Welt: Straßennetz, Höhenraster, Biome als Regionen“, Schritt 4
- **Issue:** [#150](https://github.com/henrysachs/voltonaut/issues/150), Entscheidung [ADR-033](../decisions/ADR-033-connected-worlds.md) §7 und §8 (angenommen am 2026-11-27); baut auf [E10-11](E10-11-connected-world.md) (Schritt 1) auf
- **Status:** Implementiert und lokal softwaregeprüft; CI und Review offen
- **Betroffene Module:** `packages/shared` (Verträge), `packages/engine/src/world` (Wegauflösung), `apps/web/src/game` (Worker-Aufnahme und Progress), `apps/server/src/rides` (Nachrechnung), `apps/server/src/progress` und Drizzle-Migration `0015`

## Ziel

Neue Aufnahmen, lokale Fahrtspuren und Progress-Journale verweisen auf Welt, Weltrevision und gefahrenen Weg statt auf eine Einzelstrecke. Der Server löst die Welt intern auf und rechnet den Weg mit derselben Engine nach. Bestehende Aufnahmen und Progress-Journale mit `routeId`/`routeRevision` bleiben unverändert lesbar und werden nicht neu bewertet.

## Vertrag

### Fahrtverweis (`packages/shared/src/rideReference.ts`)

Ein Fahrtverweis hat genau eine von zwei Formen. Beide stehen flach in derselben Ebene wie bisher `routeId`/`routeRevision`:

| Form                | Felder                               | Wer schreibt                                  |
| ------------------- | ------------------------------------ | --------------------------------------------- |
| Weltweg (neu)       | `worldId`, `worldRevision`, `pathId` | jede neue Fahrt aus dem Engine-Worker         |
| Einzelstrecke (alt) | `routeId`, `routeRevision`           | niemand mehr; nur gespeicherte Altdaten lesen |

Jede Form ist strikt. Ein Objekt mit Feldern beider Formen, mit nur einem Teil einer Form oder ohne Verweis ist ungültig. Es gibt kein Diskriminatorfeld, weil gespeicherte Altdaten keines haben und unverändert lesbar bleiben müssen.

Die Form gilt gleich in:

- `RecordingV2.initialization` (Journal-Beleg, IndexedDB und `rides.payload_json`),
- `LocalRideMetadata` (lokale Spur, Altaufnahme `CompletedLocalRide`, TCX-Projektion),
- `RideProgressCheckpoint` samt Batch und Progress-Kontoexport.

### Entscheidung: Weg als `pathId`, nicht als Schrittliste

ADR-033 §7 verlangt die „gefahrene Abschnittsfolge“, §3 „der Tick bekommt den Weg“. Die Aufnahme speichert die Abschnittsfolge **als Verweis** `pathId` innerhalb von `worldId`@`worldRevision`, nicht als kopierte Schrittliste.

- Eine Weltrevision ist unveränderlich: Jede Geometrieänderung erzeugt eine neue Revision (`WorldData.revision`). `worldId` + `worldRevision` + `pathId` bestimmt damit genau eine Folge von Abschnitten mit Fahrtrichtung, dazu Schleife und Segmente. Die Engine baut daraus dieselbe `RouteData`, die der Tick bekommt (§3).
- Segmente und Schleifenangabe hängen am Weg. Eine reine Schrittliste reichte zur Nachrechnung nicht, weil Segmentereignisse Teil der Beobachtungen sind.
- Der Server rechnet nach (ADR-016, AGENTS.md §3.5). Eine vom Client mitgeschickte Schrittliste wäre eine Behauptung, die der Server nur gegen den Weg vergleichen könnte. Der Verweis lässt keine abweichende Behauptung zu.
- Abbiegen (Schritt 5) ändert den Weg während der Fahrt. Diese Entscheidungen sind Eingaben und gehören dann als eigene Journaleinträge in die Aufnahme. Die tatsächlich gefahrene Folge ist ein Ergebnis der Nachrechnung, keine Kopfangabe. Bis dahin ist die gefahrene Abschnittsfolge vollständig durch `pathId` bestimmt.

### Welten im Client und auf dem Server

Der Client fährt den Weg `test-loop` der Welt `test-loop` in Revision `1` (die Einzelstreckenwelt aus Schritt 1, AK6 E10-11). `packages/engine` löst Verweise mit `worldPathRoute(TEST_WORLDS, verweis)` auf. Das Rendering bekommt weiterhin die Routen-ID des aufgelösten Wegs (`RouteData.id` = `pathId`); Rendering ändert sich erst mit Schritt 3.

Der Server hält eine eigene Freigabeliste nachrechenbarer Weltrevisionen. Sie enthält zunächst genau `test-loop`@`1`. Jede weitere Weltrevision braucht eigene Nachrechnungstests (ADR-033 „Folgen“). Unbekannte Welt, Revision oder Wege ergeben `unverified/unknown_revision`, nie eine Näherung an die neueste Welt.

### Nachrechnung und Revision

- **Weltweg:** Die Nachrechnung löst die Welt intern auf und rechnet mit derselben Engine und `applyJournalEntry`. Ein bestandenes Ergebnis ist `replayed` mit `physicsRevision: "engine-v1"` und der neuen expliziten Nachrechnungsrevision `replayRevision: "world-path-1"`.
- **Einzelstrecke:** Die bisherige Nachrechnung bleibt bitgleich: nur `test-loop`@`1`, Ergebnis ohne `replayRevision` in der bisherigen Form (ADR-033 §8: die alte Revision bleibt als Einzelstrecke nachrechenbar). Das betrifft nur noch nicht hochgeladene lokale Altaufnahmen.
- Gespeicherte Bewertungen (`rides.assessment_json`) werden weder gelesen und neu berechnet noch umgeschrieben. Identische Wiederholungen liefern wie bisher den gespeicherten Beleg.

### Datenhaltung und Migration

- `rides` speichert die Nutzlast als JSON. Es braucht keine Spaltenänderung; Altnutzlasten bleiben bytegleich.
- `ride_progress_journals` bekommt mit `0015_world_ride_reference.sql` die Spalten `world_id`, `world_revision`, `path_id`. `route_id` und `route_revision` werden nullbar. Eine Prüfregel erzwingt genau eine vollständige Form. Die Tabelle wird wie in `0011` neu aufgebaut; alle Altzeilen werden unverändert übernommen, Indizes und die beiden Löschschutz-Trigger werden wiederhergestellt. Altzeilen bekommen **keine** Weltfelder nachgetragen.
- Lokale IndexedDB-Daten (Aufnahmen, Spuren, Progress-Outbox) werden nicht migriert. Sie bleiben in ihrer gespeicherten Form gültig.

## Abnahmekriterien

- [x] AK1 – `RecordingV2Schema`, `LocalRideMetadataSchema`, `RideProgressCheckpointSchema` und der Progress-Kontoexport akzeptieren genau eine der beiden Verweisformen. Gemischte, unvollständige, leere und fehlende Verweise sowie unbekannte Felder werden abgewiesen.
- [x] AK2 – Gespeicherte Altformen bleiben lesbar: Das unveränderte Vertragsbeispiel `fixtures/api/progress-checkpoints.request.json` und bestehende Beispiele mit `routeId`/`routeRevision` parsen weiter; ihre Felder bleiben erhalten.
- [x] AK3 – `worldPathRoute` löst `worldId`, `worldRevision` und `pathId` in einer Weltliste zur `RouteData` des Wegs auf; jede abweichende Angabe ergibt `undefined`. Für `test-loop`@`1` ist die Route feldweise die bisherige `TEST_LOOP`.
- [x] AK4 – Der Engine-Worker schreibt für jede neue Aufnahme, Spur und jeden Progress-Checkpoint nur den Weltweg (`test-loop`@`1`, Weg `test-loop`). Unbekannte Weltverweise werden vor dem Start einer Fahrt abgewiesen.
- [x] AK5 – Der Server rechnet eine Weltweg-Aufnahme nach und liefert `replayed` mit `replayRevision: "world-path-1"`. Dieselben Journale ergeben als Weltweg und als Einzelstrecke dieselbe Fensterzusammenfassung und Quellenbewertung.
- [x] AK6 – Unbekannte Welt, Weltrevision oder unbekannter Weg ergeben `unverified/unknown_revision`. Eine Weltweg-Aufnahme mit abweichender Beobachtung ergibt `rejected/observation_mismatch`.
- [x] AK7 – Eine Einzelstrecken-Aufnahme `test-loop`@`1` wird weiter in der bisherigen Form ohne `replayRevision` bewertet; andere Einzelstrecken bleiben `unknown_revision`. Gespeicherte Fahrten behalten Nutzlast und Bewertung über eine Wiederholung hinweg.
- [x] AK8 – Migration `0015`: Progress-Journale, Bereiche und übrige Tabellen sind nach dem Upgrade zeilengleich; Altzeilen haben keine Weltfelder; Indizes und Löschschutz-Trigger bestehen; Zeilen mit beiden, keinem oder unvollständigen Verweisen scheitern an der Prüfregel.
- [x] AK9 – Progress-Annahme speichert Weltweg-Journale, exportiert sie im Kontoexport und weist Fortsetzungen mit anderem Verweis als Metadatenkonflikt ab. Alt-Journale mit Einzelstrecke werden weiter fortgesetzt.
- [x] AK10 – TCX-Notizen nennen den Fahrtverweis: Welt, Revision und Weg für neue Fahrten; der bisherige Text „Route …, revision …“ bleibt für Altspuren gleich.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene       | Datei / Fixture                                                                                                                                                                                                                                                                                                                |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AK1      | Vertrag     | `packages/shared/src/rideReference.contracts.test.ts` (vier Verträge × beide Formen, 15 ungültige Verweise, Schlüsselreihenfolge)                                                                                                                                                                                              |
| AK2      | Vertrag     | unverändertes `fixtures/api/progress-checkpoints.request.json` in `apps/server/src/progress/progress.validation.test.ts` und `apps/web/src/game/recordedRide.progress.timestamps.test.ts`; Altbeispiele in `packages/shared/src/recordingV2.test.ts`, `localRide.test.ts`, `rideProgress.test.ts`, `api/progressBatch.test.ts` |
| AK3      | Unit        | `packages/engine/src/world/registry.test.ts`                                                                                                                                                                                                                                                                                   |
| AK4      | Unit/Worker | `apps/web/src/game/recordedRide.test.ts`, `recordedRide.progress.test.ts`, `engineWorkerCore.test.ts`, `rideSession.test.ts`                                                                                                                                                                                                   |
| AK5, AK6 | Replay      | `apps/server/src/rides/replay.world.test.ts`                                                                                                                                                                                                                                                                                   |
| AK7      | Replay/HTTP | `apps/server/src/rides/replay.world.test.ts`, `rides.world.test.ts`, `rides.upgrade.test.ts` (Altzeile über alle Migrationen bis `0015`)                                                                                                                                                                                       |
| AK8      | Migration   | `apps/server/src/database/world-reference-migrations.test.ts`                                                                                                                                                                                                                                                                  |
| AK9      | Integration | `apps/server/src/progress/progress.world.test.ts`                                                                                                                                                                                                                                                                              |
| AK10     | Unit/HTTP   | `packages/shared/src/rideReference.test.ts`, `apps/server/src/rides/rides.world.test.ts`                                                                                                                                                                                                                                       |
| AK3      | Mutation    | Stryker auf `packages/engine/src/world/registry.ts` (100 %)                                                                                                                                                                                                                                                                    |

## Nicht-Ziele

- Kein Abbiegen und keine Journaleinträge für Wegwechsel (Schritt 5).
- Keine Welt `voltonaut` und keine neue Weltrevision (Schritt 3). Kein Umbau des Render-Protokolls.
- Keine Änderung der Golden-Eingaben unter `fixtures/rides/`: Sie sind Testeingaben mit stabilen Routen-IDs (ADR-033 §8), keine Aufnahmen.
- Keine Neubewertung, kein Nachtragen von Weltfeldern und kein Löschen gespeicherter Fahrten, Spuren oder Progress-Journale.
- Keine Belohnungsänderung: Progress-Annahme und Volts rechnen unverändert.

## Offene Fragen / Risiken

- **Weltrevision der Einzelstreckenwelt (Henry):** Die Welt `test-loop` trägt Revision `1` wie die alte Route (Entscheidung aus Schritt 1). Weltrevisionen und Routenrevisionen sind getrennte Namensräume; die Form des Verweises unterscheidet sie. ADR-033 §8 sagt „Die Welt-Fassung derselben Strecke bekommt eine neue Revision“. Ist damit schon diese geometriegleiche Übergangswelt gemeint, muss sie vor dem Merge auf Revision `2` wechseln. Die Freigabeliste des Servers wäre dann entsprechend anzupassen.
- **Schrittliste zusätzlich speichern (Henry):** Gewählt ist der Verweis `pathId` (Begründung oben). Soll die Aufnahme die Abschnittsfolge zusätzlich ausgeschrieben tragen, wäre das ein zusätzliches, vom Server zu prüfendes Feld.
- **Altzeilen nachtragen (Henry):** Alte Progress-Journale und Fahrten bekommen keine Weltfelder, obwohl `test-loop`@`1` geometriegleich zur Welt `test-loop`@`1` ist. Ein Nachtragen wäre eine stille Umdeutung gespeicherter Belege und bleibt ohne ausdrückliche Freigabe aus.
- **Freigabeliste klein:** Nur `test-loop`@`1` ist auf dem Server nachrechenbar, wie bisher bei Einzelstrecken. `flat-loop` und `kom-climb` fährt der Client nicht.
- **Migration mit Tabellenneubau:** SQLite kann `NOT NULL` nicht entfernen. Der Neubau folgt dem Muster aus `0011`; der Migrationstest sichert Zeilengleichheit und Trigger.

## Nachweisstand

- **Implementiert:** ja (Vertrag, Engine-Auflösung, Worker, Server-Nachrechnung, Progress, Migration, Doku).
- **Am tatsächlichen Artefakt softwaregeprüft:** lokal Format, Lint, Typecheck, depcruise, guard, Vitest mit Coverage, gezielte Mutation von `registry.ts` (100 %), Playwright im Sim-Modus. CI und Review stehen aus.
- **An echter Hardware geprüft:** nein (keine Hardwarewirkung; die Trainersteuerung ist unverändert).
- **Bereitgestellt:** nein.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Roadmap-Unterpunkt · [x] `docs/01-architecture.md` · [x] `docs/08-backend.md` · [x] ADR-033 Freigabe (Henry, 2026-11-27)
