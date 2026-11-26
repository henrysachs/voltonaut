# Spec E10-02 – Reine Replay-Konsistenz für Aufnahme V2

- **Roadmap-Bezug:** E10 und E5, Voraussetzung für spätere geprüfte Aufnahmen. Keine abgeschlossene Strava- oder Uploadfunktion.
- **Status:** Isolierte Einheit mit grünem lokalem Gesamtgate und unabhängigem Review. CI und Integration stehen aus. Browseraufnahme und HTTP-Annahme bleiben unverändert.
- **Module:** `shared/recordingV2`, neue reine Module unter `server/rides`, Workspace-Abhängigkeit nach ADR-016.

## Ziel und Entscheidung

Der Server kann einen begrenzten V2-Beleg mit derselben öffentlichen Engine nachrechnen. Das Ergebnis heißt ausschließlich **Replay-Konsistenz**. Es beweist weder echte Hardware noch eine absolvierte Fahrt.

Zwei Formen wurden geprüft.

1. Vollständiges geordnetes Journal ab `createEngine`, mit eingefrorenem Anfangsprofil und Aufnahmegrenzen. Der spätere Worker protokolliert jeden physikwirksamen `ingest` und jeden tatsächlichen `advance`.
2. Öffentlicher Snapshot am Aufnahmestart als Checkpoint. Der Server startet eine neue Engine an dessen Position.

Gewählt ist Form 1. Form 2 verliert Akkumulatorreste, Eingabepuffer, Startzustand, Stillstandszeit, Tickindex, Kommandosperre und aktive Segmente. Schon `advance(0.025)` lässt den öffentlichen Snapshot unverändert. Nach derselben nächsten Eingabe und weiteren 0,025 Sekunden unterscheiden sich warme und kalte Engine. Eine erfundene Anfangspose ist kein Ersatz für das Journal.

## Vertrag und nächste Aufrufer

`RecordingV2Schema` und daraus abgeleitete Typen bilden einen additiven Vertrag. `parseRecordingV2Json(json)` begrenzt UTF-8-Bytes vor JSON-Parsing. Die spätere Transportgrenze muss zusätzlich den eingehenden Byte-Stream begrenzen. `CompletedLocalRide`, TCX und vorhandene V1-API bleiben unverändert.

Die Initialisierung enthält Physikrevision, Route mit Revision, vollständiges eingefrorenes Profil, Quelle, Physikzeitfaktor, UTC und Worker-Uhranker. Die erste Revision erlaubt ausschließlich die heutigen Worker-Defaults mit Position und Tempo null, Gangindex 11 und angenommener Trainermasse 83 kg. Es gibt keine frei wählbare Anfangspose.

Einträge sind Tupel `[seq, workerMs, operation, ...payload]`. `seq` beginnt bei null und bleibt in tatsächlicher Actor-Reihenfolge lückenlos. Gleiche Zeitpunkte erlauben unterschiedliche Reihenfolgen. Sortieren ist verboten.

- `arm` markiert die erste Worker-Aufwachung ohne `advance`.
- `trainer` enthält Leistung, Kadenz und gemeldetes Tempo. `null` bedeutet abwesend, nie null Watt. Abwesende Felder bleiben beim Engine-`ingest` abwesend.
- `hr` enthält Puls. `shift` enthält nur gedrücktes Hoch- oder Herunterschalten.
- `status` ist ein Quellenmarker. Er verändert den Engine-Puffer nicht.
- `advance` enthält exakt das tatsächlich verwendete `elapsedRealS`. Replay ruft `advance(elapsedRealS * clockScale)` auf. Keine Rundung, Rasterung oder nachträgliche Zusammenfassung.
- `boundary` mit `start`, `sample` oder `finish` bestätigt einen Worker-seitig erreichten Aufnahmezeitpunkt. Beobachtungen referenzieren genau diese Sequenznummern.

Workerzeiten stammen ausschließlich aus derselben monotonen Uhr. `workerTimeOriginMs` plus `initializedWorkerMs` verankert die Initialisierung. Bare `performance.now()`-Werte des Mainthreads dürfen nicht mit Workerwerten verrechnet werden. Jede `advance`-Dauer muss exakt aus dem vorherigen Wake-Anker und ihrem eigenen Workerzeitpunkt entstehen. Eingangs-`DeviceEvent.tS` wird nicht zur Physikzeit umgedeutet, da die Engine diesen Wert ignoriert.

`assessRecordingV2(recording)` liefert `unverified` mit Grund, `rejected` mit Grund oder `replayed` mit Physikrevision und serverberechneter Fensterzusammenfassung. Route und Revision werden ausschließlich serverseitig aufgelöst. Die erste Allowlist enthielt `test-loop` Revision `1`. Seit E10-07 (#138) löst der Server jede in `TEST_ROUTES` registrierte Route mit Revision `1` auf, also auch `coast-loop`, `alpine-pass` und `night-city`. Unbekannte Routen-IDs bleiben `unverified`. Eine Revision pro Route gibt es noch nicht (#161); Geometrieänderungen vor dem ersten Merge einer Route ändern deshalb keine gespeicherten Aufnahmen. Es gibt keinen Näherungs-Fallback und keine Funktionswerte im DTO.

Beobachtungen enthalten öffentliche Snapshotwerte sowie geordnete Engine-Ereignisse und Trainerkommandos seit der vorigen Grenze. Am Start werden die Präfixausgaben ebenfalls verglichen, aber nicht der Fensterzusammenfassung zugerechnet. Jede Engine-Aufrufausgabe wird zeitnah geleert. Warmlaufdistanz, Energie, Höhenmeter, Fahrzeit und Runden zählen nicht zum Aufnahmefenster.

## Grenzen und Semantik

Alle Grenzen gelten gleichzeitig. Sie garantieren keine sechs Stunden nach beliebigem Warmlauf oder bei beliebiger Eingangsrate.

Auch gewöhnliche lange Fahrten können durch vollständige Tickausgaben früher an die Bytegrenze stoßen. Diese Einheit verwendet noch keine kompakte Ausgabesignatur. Der spätere Recorder muss die Größe laufend prüfen und darf Überschreitungen nicht als vollständiges Journal ausgeben.

- Aufnahmefenster mindestens 1 Sekunde, höchstens 6 Stunden echte Zeit.
- Initialisierung bis Ende ebenfalls höchstens 6 Stunden.
- Höchstens 500.000 `advance`, 250.000 Eingaben einschließlich Statusmarkern und 21.602 Beobachtungen.
- Höchstens 8.388.608 UTF-8-Bytes des vollständigen serialisierten Belegs, einschließlich Ausgaben.
- Kein Präfixverwerfen, kein stiller Neustart und keine geratenen Zwischenereignisse. Unvollständige Journale bleiben ungeprüft.

Endliche Snapshot- und Ausgabemesswerte verwenden `abs(a-b) <= max(1e-6, 1e-9 * max(abs(a), abs(b)))`. Diskrete Werte und Ereignisreihenfolgen sind exakt. Enginezeiten, Frischealter und Segmentzeiten werden exakt verglichen. Zeitwerte, die Tick- oder Frischezweige steuern, erhalten keine Toleranz. Die alte 3-Prozent-Zielskizze gilt hier nicht.

Teilnotifications behalten frühere Enginewerte. Jede Trainernachricht setzt Frische, auch ohne neue Leistung. Nur der erste verarbeitete Tick verbraucht diese Frische. Nach mehr als drei virtuellen Sekunden ohne frische Nachricht setzt die Engine Rohwatt und Rohkadenz auf null. Pausierte Ticks altern Daten, erhöhen aber keine Fahrzeit. Mehr als 120 fällige Ticks erzeugen `ride.clockSkipped`.

Eine getrennte reine Export-Eignungsprüfung lehnt mindestens Sim, Zeitfaktor ungleich eins, Lücken, Uhrenübersprünge, fehlende Sequenzen, unvollständiges Journal, unbekannte Revisionen, getrennte oder veraltete Trainerdaten und verzögerte Aufnahme ab. Eignung ist keine Strava-Freigabe. Diese Einheit aktiviert keinen Exportdienst.

## Abnahmekriterien

- [x] Strikter additiver V2-Vertrag mit endlichen Zahlen, Tupelvarianten, Mengen-, Byte-, Zeit-, Reihenfolge- und Referenzgrenzen.
- [x] Unveränderte V1-Roundtrips und ausschließlich `legacy_missing_replay` in bestehender API.
- [x] Reine Nachrechnung mit öffentlicher Engine und interner Revisions-Allowlist.
- [x] Vollständige Historie reproduziert Snapshots und geordnete Ausgaben. Öffentliche Pose genügt nachweislich nicht.
- [x] Fensterzusammenfassung schließt Warmlauf aus. Anfangsprofil bleibt unabhängig vom aktuellen Accountprofil.
- [x] Manipulierte Beobachtungen, Reihenfolge und Uhren werden erkannt. Unbekannte Revisionen bleiben ungeprüft.
- [x] Fokussierte Tests, statische Prüfungen, Build, vollständiges lokales Gate und unabhängiges Review grün. Externe CI bleibt Integrationsvoraussetzung.

## Testplan und Nicht-Ziele

Vitest nutzt generierte synthetische Eingaben und die echte öffentliche Engine. Fälle umfassen Akkumulatorrest, Stillstand, Teilnotifications, mehrere Eingaben zwischen Ticks, Schaltreihenfolge, erste Aufwachung, Warmlauf, 2,5-, 3- und 5-Sekunden-Grenzen, 120 und 121 Ticks, Pause, Ausfall, Route, Runde und Manipulationen. Keine Golden- oder Hardwarefixtures werden verändert.

Nicht enthalten sind tatsächliche Worker-Erfassung, Browseruhr-Synchronisation, API-Annahme von V2, Migrationen, Belohnungen, Strava, UI und physische Hardwareprüfung. Numerisch konsistente erfundene Eingaben bleiben unerkennbar. Ein synthetischer Test beweist keine browserübergreifende Reproduzierbarkeit.

## Offene Fragen

Keine blockierenden Fragen dieser Einheit. Browsererfassung und Anschluss an Persistenz benötigen eine nächste Spec.

## Lokale Ergebnisse

- Tests wurden vor den neuen Produktionsmodulen angelegt. Die ersten Läufe scheitern am noch fehlenden V2- beziehungsweise Replay-Modul. Das ist kein behaupteter Fehlernachweis gegen die bestehende V1-Implementierung.
- `mise run test` besteht mit Coverage, 88 Dateien und 475 Tests. Davon prüfen 39 neue Fälle diese Einheit. Die V2-Vertragsdatei erreicht 100 Prozent Statements und 93,33 Prozent Branches.
- `mise run fmt:check`, `lint`, `typecheck`, `depcruise`, `guard`, `build` und `git diff --check` sind grün. Der Build meldet weiterhin den großen Web-Bundle-Chunk. Es wurden keine Leitplanken verändert.
- Der Akkumulator-Gegenbeweis nutzt `test-loop`. Nach identischen öffentlichen Anfangssnapshots fährt die warme Engine beim nächsten Aufruf, die kalte nicht. Der Stillstandsfall belegt zusätzlich den verlorenen Auto-Pause-Zähler.
- `6.05 / 0.05` ergibt in dieser Laufzeit weniger als 121 ganze Ticks. Dagegen überschreitet `121 * 0.05` die Catch-up-Grenze. Beide unveränderten Binärwerte haben eigene Replayfälle. Es gibt keine Epsilonkorrektur der Tickzahl.
- Die Nachrechnung vergleicht Ausgaben während des Leerens nach jedem Aufruf. Sie sammelt keine zweite vollständige Ausgabehistorie im Server. Der Routenfall überschreitet eine echte `test-loop`-Runde einschließlich Segmentereignissen.
- Der Parent besteht `CI=true mise run check` mit 475 Tests und 17 E2Es sowie den Build. Der unabhängige Prüfer besteht 84 Tests einschließlich zwölf eigener Proben und 33 unveränderter V1-Fälle. Sein wiederholbarer Nachweis samt Quellhashes liegt unter `$TMPDIR/opencode/replay-review-independent/`. Die fehlende ADR-Indexzeile ist ergänzt. Eine private Implementierungserklärung wurde nach Kommentarreview gelöscht; keine Laufzeitlogik geändert. Mutation wurde nicht gestartet, da Engine- und Rules-Code unverändert sind. Keine Hardware-, Anbieter- oder Strava-Anfrage wurde ausgeführt.

## CI-Korrektur des Bytegrenzentests

Der Lauf `44760958962` überschreitet im kanonischen Bytegrenzentest das unveränderte Fünf-Sekunden-Limit. Der ursprüngliche Test parst dafür 200.000 kleine Ereignisse. Sein Ziel ist die Gesamtbytegrenze, nicht diese Ereigniszahl.

Der Test verwendet stattdessen 25.000 gültige Segmentereignisse mit jeweils 100 Unicodezeichen als ID. Der vollständige Beleg hat 8.726.185 UTF-8-Bytes, aber nur 3.726.185 Codeeinheiten. Alle einzelnen Array-, String-, Zeit- und Referenzgrenzen bleiben erfüllt. Die ursprüngliche Fehler-Assertion bleibt unverändert. Eine zusätzliche Assertion stellt sicher, dass eine falsche Codeeinheitenzählung den Beleg nicht ablehnen würde.

Der unabhängige Prüfer bestätigt für beide Datensätze genau einen Schemafehler: die kanonische UTF-8-Bytegrenze. Alle vorherigen Tests bleiben bytegleich. Produktcode, Limits, Wiederholungen und Timeouts werden nicht geändert. Fokussierte Tests, Korrekturreview und erneut das Gesamtgate mit 475 Tests und 17 E2Es sowie der Build sind grün. Die externe CI wird für den korrigierten Stand erneut ausgeführt.

## CI-Korrektur des Rundenbeispiels

Bei der Integration in PR #19 überschreitet der Rundenfall auf `79e8ea9` im Lauf `44797623623` das unveränderte Fünf-Sekunden-Limit. Der Test erzeugt zunächst ein vollständiges Livejournal und rechnet es danach nach. Seine bisherigen 1.400 Sekunden ergeben 29.336,560485 Meter und zwei Runden. Gefordert sind die erlaubte Route, ein Rundenübergang und dessen geordnete Segmentausgaben, nicht diese Dauer oder eine zweite Runde.

Ein unabhängiger Prüfer ermittelt den kürzesten ausreichenden ganzsekündigen Präfix. Nach 479 Sekunden sind 9.978,592457 Meter und noch keine Runde erreicht. Nach 480 Sekunden sind es 10.000,960004 Meter und eine Runde. Alle vier bisherigen Assertions bestehen. Der korrigierte Test verwendet deshalb `durationS = 480` für Journal und Abschlusszeit. Er behält alle vier Assertions und prüft zusätzlich genau eine Runde.

Initialisierung, Eingaben, Tickschritte, vollständige Ereignis- und Kommandoreihenfolge sowie Besitz der Abschlussausgaben bleiben unverändert. Es gibt weiterhin zwei Engine-Durchläufe, keinen zusätzlichen Suchlauf im Repositorytest. Fehlende Runden- oder Segmentausgaben werden weiterhin abgelehnt. Kein Produktcode, Helfer, Schema, physikalischer Parameter oder Timeout wird geändert. Der Beleg liegt unter `$TMPDIR/opencode/replay-lap-standards-probe-1vcwrhrg/`.

Die genaue 1.400-Sekunden-Servernachrechnung entfällt. Lange Engine-Goldens bleiben erhalten, sind aber kein Ersatznachweis für diese längere Servernachrechnung. Der getrennte sporadische Hintergrundfahrt-Startfehler aus Issue #20 wird damit nicht als repariert ausgewiesen. Erst die CI des korrigierten Stands entscheidet über die Übernahme.

Das unabhängige Nachreview genehmigt die tatsächliche Teständerung nach zehn bestandenen Tests in zwei Dateien. Es bestätigt alle vier ursprünglichen Assertions, die zusätzliche Ein-Runden-Assertion und die Ablehnung fehlender Abschlussereignisse. Produkt-, Helfer-, Schema- und Routenhashes bleiben unverändert. Der Reviewbeleg liegt unter `$TMPDIR/opencode/replay-lap-correction-review-qiyc5okw/`. Danach ergänzt der Parent ausschließlich die von der bestehenden Lintregel verlangte Leerzeile vor der Testdatenliste.
