# Spec E10-04 – Prüfbare Aufnahme und ausdrückliche Strava-Auslieferung

- **Auftrag:** Henry beauftragt nach PR #19 die zuletzt offenen Arbeiten. Gemeint sind Worker-Aufzeichnung, API-Annahme, Strava-Fahrtupload und das Lastproblem aus Issue #20. Nicht die gesamte weitere Roadmap.
- **Basis:** `bdf5dd3bac5e1adf833dbd5116b14a29d829035a`.
- **Status:** Architekturvergleich entschieden. Verifikationsaufbau vor Featurecode. Noch keine neue Produktfunktion implementiert.
- **Module:** `shared`-Aufnahmeverträge, Web-Worker und lokale Aufnahme, `sync`, Oberfläche, Server `rides` und `strava`. Die Lastuntersuchung arbeitet getrennt am vorhandenen Rendering- und Timerpfad.

## Ziel und Abgrenzung

Der tatsächliche Browser zeichnet die vollständige physikwirksame Reihenfolge im Engine-Worker auf. Er speichert eine ausgewählte Fahrt dauerhaft und ordnet sie ausdrücklich einem angemeldeten Account zu. Der Server prüft und speichert dieselbe Fahrt. Nach getrennter Strava-Verbindung und ausdrücklicher Einwilligung liefert er eine zulässige eigene Fahrt an den lokalen Testanbieter aus. Verlorene Antworten oder Neustarts dürfen keinen blinden Doppelupload auslösen.

Gastfahrt, Offlinebetrieb und TCX bleiben unabhängig verfügbar. Es entsteht kein künstliches paralleles V1/V2-Subsystem. Bestehende Fahrten werden weder gelöscht noch ohne Journal als nachgerechnet ausgegeben. Ein konsistentes Journal ist kein Hardwareattest. Herkunftsaussagen und Uploadzulässigkeit müssen diese Grenze benennen.

Echte Funkfahrt, Trainer-Widerstandsabnahme, persönliche Anbieterzustimmung und produktiver Betrieb benötigen Henry. Das Neuladen laufender Labore ist in diesem Auftrag inzwischen ausdrücklich freigegeben und wird nicht erneut angefragt. Isolierte Entwicklung greift nicht auf reale Geräte zu und verwendet keine echten Anbieterzugangsdaten. Produktionsdeploys, neue Kosten und Datenlöschung bleiben gesondert freigabepflichtig.

## Abnahmekriterien

- [ ] AK1 – Ein Worker-Besitzer erfasst Initialisierung, Eingaben, tatsächliche Advances, geordnete Ausgaben und atomar bestätigte Aufnahmegrenzen. Kein aus Snapshots geratener Anfangszustand.
- [ ] AK2 – Journal-Lebensdauer und ausgewähltes Aufnahmefenster sind getrennt. Ein späterer Aufnahmestart verwirft den Warmzustandspräfix nicht und zählt dessen Strecke oder Zeit nicht zur Fahrt.
- [ ] AK3 – Mengen-, Byte-, Zeit- und Abbruchgrenzen ergeben konkrete vollständige oder unvollständige Zustände. Ein übergelaufenes Journal wird nicht nachträglich als vollständig bezeichnet. Die Oberfläche erklärt die Einschränkung.
- [ ] AK4 – Ein kanonischer Archiv- und Annahmepfad erhält vorhandene Fahrten. Neue Eingaben werden an HTTP- und Speichergrenzen geparst. Keine unnötigen parallelen APIs oder verlorenen lokalen Datensätze.
- [ ] AK5 – Serverannahme prüft Eigentümer, unveränderliche Nutzlast, Revision, vollständige Nachrechnung und ehrliche Quellenpolitik. Gleiche Fahrt wiederholen ist idempotent. Fremde IDs oder abweichende Wiederholung sind keine Überschreibung.
- [ ] AK6 – Die Strava-Oberfläche verbindet und trennt ausdrücklich. Übergaben werden sofort aus der URL entfernt und bleiben an Konto und Browser gebunden. Tokens verlassen das Servermodul nicht.
- [ ] AK7 – Ein Uploadauftrag bindet eigene gespeicherte Fahrt, Einwilligung, Zielathlet, Verbindungsgeneration und Exportversion. Deklarierter Sim, fehlende Einwilligung, fremde Fahrten und unzulässige Journale erzeugen keinen Anbieterupload. Eine vollständig erfundene konsistente BLE-Selbstauskunft wird nicht als erkennbar behauptet.
- [ ] AK8 – Tokenrotation, Widerruf, Parallelität und Neustart erhalten konsistente dauerhafte Zustände. Ein unklarer POST oder verlorener Refresh-Response wird nicht blind wiederholt. Bekannte Upload-IDs bleiben beim Polling erhalten.
- [ ] AK9 – Multipart verwendet einen servererzeugten TCX-Export, `sport_type=VirtualRide`, `trainer=1` und die restriktive Sichtbarkeitsanforderung. Keine erfundenen GPS-Daten oder Fremdhersteller. Anbieterfehler werden nicht als HTML angezeigt. Erst bestätigte fertige Verarbeitung heißt Erfolg.
- [ ] AK10 – Ein ausführbarer Browsernachweis gegen echte Adapter mit nativen GATT-Fakes, tatsächlichen Worker, kompilierten API-Prozess und lokale signierende Testanbieter besteht. Kontowechsel, Offlinebetrieb, Reload, Neustart und verlorene Antworten haben eigene Gegenproben.
- [ ] AK11 – Issue #20 wird anhand eines tatsächlich roten Laufs eingegrenzt. Eine Korrektur erhält Assertions, Zeitgrenzen, Sim-Uhr, Datenfrische und Weltqualität. Eine bloße Ressourcenmitigation oder ein grüner Wiederholungslauf gilt nicht als App-Reparatur.
- [ ] AK12 – Jede Lieferung besteht `mise run check`, Build und unabhängiges Review. Bei Änderungen an Engine oder Rules zusätzlich Mutation. Keine gelockerte Leitplanke und keine neue Abhängigkeit ohne ADR und Registereintrag.

## Arbeitsfolge und Prüfaufwand

Der Auftrag umfasst etwa sechs bis acht getrennte Einheiten mit hohem Prüfaufwand. Vor Featurecode werden zwei unabhängige Typ- und Modulentwürfe verglichen. Jeder Entwurf muss den vollständigen Datenfluss, Besitzer und Zustände sowie entscheidende Gegenproben benennen. Danach wird der kleinere belastbare Vertrag gewählt.

1. Ausgangsstand und öffentliche Anbieterfakten sichern. Bestehende Grenzfälle als ausführbare Prüfungen erhalten.
2. Aufnahmeverträge und Verifikationsaufbau festlegen. Atomare Worker-Aufzeichnung mit lokalem Archiv liefern.
3. Eigene serverseitige Annahme und nachgerechnete Speicherung anschließen.
4. Dauerhafte Strava-Auslieferung einschließlich Rotation, Unsicherheit und Widerruf liefern.
5. Accountgebundene Oberfläche und Gesamtfluss gegen lokale Anbieter nachweisen.
6. Die getrennte Lastuntersuchung nur nach belegter Ursache integrieren.
7. Gesamtergebnis reviewen, grün integrieren und offene reale Abnahmen getrennt aufführen.

Der Architekturvergleich bewertet Actor-Reihenfolge, sichere Auslieferungszustände, kleine Besitzerverträge, nutzbaren Offline-/Gastfluss und wiederholbare Artefaktnachweise. Anbieterübergreifendes Modellreview wird nicht behauptet, wenn die freigegebene Modellkonfiguration es verhindert.

## Gewählte Architektur

[ADR-018](../decisions/ADR-018-actor-recording-and-explicit-delivery.md) hält die Auswahl fest. Basis ist Entwurf A. Er erhält die tatsächlichen Engine-Aufrufe und projiziert pro Aufnahme genau ein Fenster aus dem vollständigen Journal. Zusätzliche Advances durch Aufnahmebefehle und ein Mehrfenster-Wireformat werden verworfen. Aus Entwurf B kommen explizite Abschlussfreigabe, Preparing-CAS, Hinweisrevision und die Trennung von Tokenrevision und Zielgeneration hinzu.

Die neue Aufnahme hat einen Besitzer im Engine-Worker. Der Mainthread bekommt asynchrone Befehle und bestätigte Zustände statt einer zweiten Uhr, eines eigenen Sensorcaches und eines Sampletimers. Gemeinsame Trackprojektion und TCX-Erzeugung bedienen Browser und Server. Alte Daten bleiben historisch lesbar, neue normale Aufnahmen erzeugen keinen V1-Archivdatensatz. Beim HTTP-Vertragswechsel wird der alte Fahrtenpfad vollständig durch einen kanonischen Endpunkt ersetzt.

Eine Fensterpolitik prüft Bereitschaft und rohe Feldfrische am Start sowie jedes relevante Intervall innerhalb der Aufnahme. Der Vorlauf bleibt vollständig nachgerechnet, wird aber nicht rückwirkend als Aufnahmefehler gewertet. Eine frische, bereits empfangene, aber noch gepufferte Messung wird nicht allein wegen eines älteren Snapshots als fehlend bezeichnet. Die Policy heißt ausdrücklich BLE-Selbstauskunft und bleibt für echten Versand deaktiviert, bis diese Vertrauensgrenze und der Anbieterpilot freigegeben sind.

Die Strava-Auslieferung hat höchstens einen externen Upload-POST pro Fahrt. Eine bekannte Upload-ID geht nicht bei Pollfehlern verloren. Unklarer Versand und unklare Rotation bleiben eigene dauerhafte Zustände. Für nur im Speicher gehaltene Anwendungssessions wird die Popup-/Bridge-Mechanik vor der konkreten UI-Umsetzung separat geprüft.

## Verifikationsplan

Die Basis besteht mit 623 Unit-Tests, 26 E2Es und Build. Neue Prüfungen müssen vor der jeweiligen Logik einen passenden roten Fall liefern. Worker-Tests verwenden injizierte Uhren und echte öffentliche Engine-Aufrufe. Serverfälle nutzen echte SQLite und lokale HTTP-Anbieter. Browserfälle fahren die produktiven Pfade mit synthetischen Konten und nativem GATT-Fake statt Modul-Mocking.

Live-Ports 5173 und 5195 bleiben reserviert. Der Produktlauf verwendet isoliert 5230. Die getrennte Lastuntersuchung verwendet 5231 und einen eigenen Cache. Anbieter und Kontrollprozesse verwenden eigene Loopback-Ports. Ein erfolgreicher Fake beweist weder echte Anbieterfreigabe noch Funkzuverlässigkeit.

Kanonischer Entscheidungsnachweis bleibt `$TMPDIR/opencode/voltonaut-next-decisions.tsv`. Entwürfe und Belege dieses Auftrags liegen unter `$TMPDIR/opencode/finish-open-work-QzilnV/`. Die konkreten Modul- und Typentscheidungen werden nach dem Vergleich hier ergänzt, bevor Featurecode entsteht.

## Offene Fragen und reale Abnahmen

- Reale Trainer-/Controllerfahrt, Firmware und Pulsgurt nur mit Henry.
- Echte Anbieterzustimmung, Sichtbarkeits-/Policyprüfung und produktiver Betrieb bleiben separat.
- Die ehrliche Uploadzulässigkeit ohne kryptografisches Hardwareattest ist Teil des Architekturvergleichs. Eine Clientbehauptung wird nicht zum Echtheitsbeweis.
