# Spec E4-05 – Ingame-Menü

- **Roadmap-Bezug:** E4, Spiel-HUD (`04` §9); E3, Rider-Profil-Screen; E1, Verbinden-Dialog im Spiel.
- **Status:** Implementiert und unabhängig softwaregeprüft, einschließlich Kombination mit Render-Worker und FTMS-Steuerung. Hardwareabnahme offen.
- **Betroffene Module:** `apps/web/index.html`, `src/styles.css`, `src/ui/gameMenu.ts`, mechanische Verdrahtung in `src/main.ts` und Geräte-Button-Attribut.

## Ziel

Welt und HUD bilden die Spieloberfläche ohne lange Scrollseite. Profil, Aufnahmen, Konto und der Strava-Status sind über ein zugängliches Ingame-Menü erreichbar. Die Fahrt läuft bei geöffnetem Menü weiter.

## Form und Zuständigkeit

Zwei Formen wurden geprüft:

1. Native Dialog-Überlagerung mit benannten Tabs. Vorhandene Formulare bleiben einmalig gemountet. Der Browser übernimmt Modalität und Escape. Fokusgrenzen halten Tab im Menü, ohne dessen Standardaktion zu unterdrücken.
2. Eigene Routenseiten für Profil, Konto und Aufnahmen. Navigation kann Geräteverbindungen und laufende Aufnahmen verlieren. Ein zusätzlicher Router würde den Umfang vergrößern.

Gewählt ist die Dialog-Überlagerung. `mountGameMenu(): void` verdrahtet ausschließlich Darstellung und Navigation nach der Geräteinitialisierung. Das Menü besitzt nur den aktiven Tab. Profil, Konto, Aufnahme, Geräte und Renderer behalten ihre bisherigen Besitzer. Der bestehende Geräte-Button wird verschoben, nicht kopiert. Die Menüaktion öffnet nur dessen bestehenden Dialog. Die native Geräteauswahl bleibt am ausdrücklichen Klick auf **Gerät wählen**.

## Abnahmekriterien

- [x] AK1: Bei 1280 × 720 passen Welt, HUD und Header ohne Body-Scroll ins Fenster. Die horizontale App-Einrückung bleibt 20 px. Bei kleinen Fenstern scrollt der Menüinhalt intern.
- [x] AK2: Ein öffentlicher Menü-Button und Escape öffnen das native Dialog-Menü. Benannte Tabs erschließen Profil, Aufnahmen, Konto und Strava. Escape schließt das Menü und stellt den Fokus wieder her. Ein anderer offener Dialog wird nicht überlagert.
- [x] AK3: Alle vorhandenen Formulare, IDs und Aktionen bleiben einmalig vorhanden. Lokales Speichern, TCX, Gastmodus, verweigerter Storage und Navigationswarnungen bleiben erhalten. Strava meldet die fehlende Browserintegration ohne vorgetäuschten Upload.
- [x] AK4: Tastendrücke im Menü erreichen keine globalen Schalt- oder Kamerakürzel. Native Texteingabe, Pfeiltasten in Zahlenfeldern und Tab funktionieren weiter.
- [x] AK5: Distanz und Renderer laufen bei geöffnetem Menü weiter. Die Budgets bleiben bei höchstens 150 Draw Calls und 500.000 Dreiecken, ohne Qualitätsänderung.
- [x] AK6: Der vorhandene Shortcut **Geräte verbinden** bleibt sichtbar. Menü und Tabwechsel öffnen keinen Picker. Erst **Gerät wählen** erreicht die vorhandene native Auswahl mit Nutzeraktivierung.

## Testplan

Die vereinbarte öffentliche Testgrenze ist die echte Browseroberfläche. Ergänzende DOM-Vertragstests ersetzen den Browsernachweis nicht. Die Anwendung erhält keine Test-API.

| AK                      | Ebene                                                                          | Datei                                                    |
| ----------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| AK1, AK2, AK4, AK5, AK6 | Playwright, echte App mit Sim-Geräten oder vorhandenem BLE-Fake                | `apps/web/e2e/game-menu.spec.ts`                         |
| AK3                     | Bestehende Profil- und Aufnahmetests mit echter Menünavigation                 | `apps/web/e2e/profile.spec.ts`, `ride-recording.spec.ts` |
| AK3                     | Bestehende synthetische OIDC- und Sync-Verifikation mit echter Menünavigation  | `apps/web/verification/*.spec.ts`                        |
| AK1, AK5                | Sichtprüfung echter Desktop- und kleiner Browserbilder, keine Baselineänderung | Externe Artefakte des Arbeitslaufs                       |

Ergänzende DOM-Vertragstests in `apps/web/src/ui/gameMenu.test.ts` prüfen Auswahl, Escape-Freigabe und den unveränderten Geräte-Button.

Zuerst scheitert ein Browsertest am noch fehlenden Menü-Button. Danach laufen derselbe Test, alle bisherigen Assertions, `CI=true E2E_PORT=5235 mise run check` und `mise run build`.

## Nicht-Ziele

Keine Änderung an Physik, Trainersteuerung, Geräteauswahl, Aufnahmeformat, Kontosynchronisierung oder API. Keine neuen Abhängigkeiten, Assets, Fonts, Router oder Frameworks. Keine Produktionsbereitstellung.

## Offene Fragen und Risiken

Keine offenen Produktfragen. Hardwarezuverlässigkeit, reales Widerstandsgefühl, echte GPU-fps und Strava-Upload bleiben außerhalb dieses Nachweises.

## Doku-Updates

- [x] Begrenzter Abschnitt in `docs/04-world-3d.md`.
- [x] Roadmap nennt den begrenzten Teilschritt. Eine neue Architekturentscheidung ist nicht erforderlich. Die umfassenden E4-Kriterien bleiben offen.

## Nachweisstatus

- Implementiert: ja. Die bestehenden Hosts `#account-panel`, `#account-data`, `#ride-recording` und `#profile-form` bleiben erhalten. `#strava-panel` liegt einmalig im Strava-Tab und enthält bis zur getrennten Browserintegration nur den ehrlichen Hinweistext.
- Am tatsächlichen Artefakt softwaregeprüft: ja. `mise run check` mit `CI=true E2E_PORT=5235`, Build, 13 Browserfälle gegen den gebauten Client, fünf synthetische OIDC-Fälle und 14 Sync-Fälle. Native Provider, Bluetooth-Hardware und produktive Daten wurden nicht verwendet. Screenshots zeigen 1280 × 720 und 390 × 844. Die gebaute Desktop-Menüaufnahme zeigt 131 Draw Calls und 168.166 Dreiecke.
- Unabhängige Standards- und Laufzeitreviews bestanden. Der frische kombinierte Produktionsbuild bestätigt genau einen Engine- und Render-Worker, sichtbare Welt und HUD, fortlaufende Distanz sowie tatsächliche Play-/FTMS-Schaltung bei offenem Menü. Profilpfeile und C bleiben ohne Gang-, Kamera- oder Trainerwirkung. Das kombinierte Parent-Gate besteht mit 690 Unit-Tests, 44 Browserfällen und Build. Die beiden neuen Profiltest-Aufrufer verwenden echte Menünavigation; ursprüngliche Assertions und Zeitlimits bleiben erhalten.
- An echter Hardware geprüft: nein.
- Bereitstellung wird getrennt mit tatsächlichem Commit, URL und Betriebsart gemeldet.
