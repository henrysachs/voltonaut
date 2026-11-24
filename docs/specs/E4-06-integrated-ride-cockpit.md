# Spec E4-06 – Integriertes Fahrt-Cockpit

- **Auftrag:** Henry beanstandet am 24.11.2026 nach eigener Nutzung den formularartigen Aufbau und wünscht stärker ins Spiel integrierte Bedienung. Hardware steht derzeit nicht zur Verfügung und blockiert die Softwarearbeit nicht.
- **Roadmap-Bezug:** E4, Spiel-HUD und Ingame-Menü aus `04-world-3d.md` §9.
- **Status:** Implementiert, regulär und unabhängig am tatsächlich gebauten Artefakt softwaregeprüft. Exakte PR-CI, Merge und Bereitstellung stehen aus.
- **Basis:** `9a9652e0736ab112a2e6a5388b05006766e2fdf5`.
- **Betroffene Module:** `apps/web/index.html`, `src/styles.css`, Browserprüfungen und diese Dokumentation. Zustandsbesitzer und Netzwerkverträge bleiben unverändert.

## Ziel und Form

Die Welt ist die bildschirmfüllende Spieloberfläche. Kompakte Fahrinstrumente liegen darüber, statt die Welt zwischen Seitenkopf und Wertetabelle einzuklemmen. Das Menü gehört optisch zum selben Cockpit; technische Details verdrängen keine primären Aktionen.

Zwei Formen wurden betrachtet:

1. **DOM-Cockpit über dem bestehenden Canvas:** zugängliche Messwerte und echte native Formulare, unveränderte Worker und Zustandsbesitzer. Diese Form wird gewählt.
2. **Menüs und Instrumente im 3D-Renderer:** würde Texteingabe, Tastaturbedienung und Kontoverträge mit dem Renderer vermischen. Kein zweiter UI-Besitzer und keine Nachbildung nativer Formulare.

Die 20-px-Seiteneinrückung aus E4-05 wird durch Henrys neuen Gestaltungsauftrag ausdrücklich abgelöst. Die bestehenden Sicherheits-, Aufnahme-, Fokus- und Geräteauswahlgrenzen bleiben erhalten.

Die bisherige Resize-Prüfung erwartet bei 800 px Fensterbreite deshalb nicht mehr 760 px Canvasbreite. Sie prüft nun exakt 800 × 900 px für ein 800 × 900 px großes Fenster. Das ändert die beauftragte Geometrie, nicht Uhr, Fristen, Auflösungsskalierung oder Renderbudgets.

## Abnahmekriterien

- [x] AK1 – Bei 1440 × 900, 1280 × 720 und 390 × 844 füllt das Welt-Element das Fenster. Kein Body-Scroll; sichtbare Kernwerte und primäre Bedienelemente liegen innerhalb des Viewports. Eine zusätzliche Gegenprobe bei 800 × 900 prüft, dass Segmentvorschau und Bedienfeld sich nicht überlagern.
- [x] AK2 – Leistung, Kadenz, Puls und Gang bilden ein kompaktes Instrument. Tempo, Distanz, Höhe und mechanische Arbeit bleiben lesbar. Keine erfundenen Kontostände, Fortschrittsbuchungen oder Kartendaten.
- [x] AK3 – Native Menüdialoge und vorhandene Formular-/Archiv-/Kontohosts bleiben einmalig erhalten. Aufnahmen und Fahrt laufen bei Menüwechsel weiter. Nicht handlungsrelevante Aufnahmeerklärungen sind per benannter Detailansicht erreichbar; die Reload-Warnung bleibt sichtbar.
- [x] AK4 – Bestehende Fokus-, Escape-, Tab- und Eingabegegenproben bestehen unverändert. Geräteauswahl bleibt unmittelbar an ihren vorhandenen Nutzerklick gebunden. Bedienelemente mindestens 44 px hoch.
- [x] AK5 – Bestehende Softwarefahrten, Renderbudgets und echte Aufnahme-/TCX-Prüfungen bestehen ohne geänderte Uhr, Frische, Grafikqualität, Grenzwerte oder Baselines. Sichtprüfung eigener neuer Desktop-/Kleinbildaufnahmen.
- [x] AK6 – Reguläres `mise run check`, Build und unabhängiges Review bestanden. Keine neue Abhängigkeit, kein Frameworkwechsel und keine Leitplankenänderung.

## Testplan

| AK  | Ebene                               | Nachweis                                                                           |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| 1–3 | Playwright, echte App im Sim-Modus  | Neue Cockpit-Geometrie- und Detailbedienungsfälle                                  |
| 3–5 | Bestehende Browserprüfungen         | `game-menu`, Profil, Aufnahme, FTMS-/Menükombination und gebaute Kontoverifikation |
| 4   | Browser und bestehende DOM-Tests    | Fokusgrenzen, Menütastatur, Gerätepicker und Eingaben                              |
| 5   | Sichtprüfung                        | Neue isolierte Screenshots, keine Baselineänderung                                 |
| 6   | Gesamtes Gate, Build, zweiter Agent | Exakter Kandidat                                                                   |

## Nicht-Ziele und Nachweisgrenzen

Keine neue 3D-Welt, kein anderer Renderer, keine Änderung an Physik, BLE, Trainersteuerung oder persönlichen Konten. Kein automatischer Upload. Keine Umdeutung des Cockpit-Umbaus in eine Hardware- oder Leistungsabnahme.

Henrys zusätzlicher Auftrag zu fortlaufend verdientem und abschnittsweise bestätigtem Fortschritt ist eine eigene Änderung an Engineprojektion, Spielsession und Serverbuchungen. Diese Oberfläche erfindet dafür weder einen bestätigten Kontostand noch ein Vergabesystem. Ein bloß live animiertes Endangebot würde den Auftrag nicht erfüllen.

## Software- und Reviewnachweise

Die neuen Geometrie- und Detailfälle scheiterten zuerst am bisherigen Aufbau. Die eigene Bildsicht fand anschließend Zahlenüberlappungen. Zusätzliche Überlaufprüfungen waren rot und bestehen nach der Korrektur. Ein weiterer Tabletfall fand eine reale Überschneidung zwischen Segmentvorschau und Bedienfeld. Dieselbe Schnittflächenprüfung besteht nach der Positionskorrektur mit exakt null Überlagerung.

Der abschließende reguläre Gesamtlauf besteht nach der Tablet-Korrektur mit 1061 Unit- und Integrationstests sowie 55 Browserfällen. Der normale Build besteht ebenfalls. Die bisherige Resize-Erwartung für den ausdrücklich abgelösten Seitenrand wurde pixelgenau auf die neue Fensterbreite geändert und um die volle Höhe ergänzt. Fristen und Renderbudgets bleiben unverändert.

Das unabhängige Quellreview liest alle acht Dateien. Ein zusätzlicher eigener Browserlauf des Reviewers prüft vier Fenstergrößen, native Fokus- und Texteingabe, Profilspeicherung, fortlaufende gewöhnliche Sim-Fahrt sowie Aufnahme über Menüwechsel und tatsächlichen Sim-TCX-Download. Neun eigene Bilder wurden geöffnet. Alle 17 ausgelieferten Build-Dateien stimmen bytegleich mit `dist` überein. Quellen und Build bleiben vor und nach dem Lauf unverändert. Keine persönlichen Sitzungen, Hardware oder HTTP-Schreiboperationen wurden verwendet.

## Offene Fragen und Dokumentation

Keine offene Produktfrage für diesen begrenzten Oberflächenumbau. Lesbarkeit vor der tatsächlichen Welt und auf kleinen Fenstern wird an Bildern geprüft, nicht aus CSS abgeleitet.

- [x] `04-world-3d.md` ergänzt.
- [x] Roadmap nennt den begrenzten Teilschritt ohne vollständige E4-Abnahme.
- [x] Fortschrittspräzisierung in `06-gamification.md` als Ziel, nicht als Lieferung, festgehalten.
