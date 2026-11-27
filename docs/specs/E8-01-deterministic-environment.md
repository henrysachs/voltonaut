# Spec E8-01 – Deterministische Umwelt

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E8, Teilschritt der Checkbox „Day/Night-Zyklus und Wetter"
- **Status:** Implementiert und softwaregeprüft. Unabhängiges Review, vollständiges Gate und Build sind grün; Merge und CI stehen noch aus.
- **Betroffene Module:** `apps/web/src/world`, `apps/web/src/main.ts`, ~~`apps/web/src/ridePresentation.ts`~~ (heute `apps/web/src/rideViews.ts`)

## Ziel

Tageszeit und Wetter entstehen als reiner `EnvironmentState`. Der vorhandene Render-Worker zeigt daraus Himmel, Sonne, Nebel und Regen, ohne Engine-Physik oder Fahrereingaben zu ändern.

## Abnahmekriterien (aus der Roadmap übernommen und präzisiert)

- [x] AK1 – `environmentAt(seed, timeS, script)` liefert für gleiche Eingaben denselben unveränderlichen Zustand mit allen geforderten Feldern. Das Wetterskript wählt unabhängig von der Arrayreihenfolge den größten normalisierten Startzeitpunkt kleiner oder gleich `timeOfDayS`. Bei Duplikaten gewinnt der spätere Eintrag.
- [x] AK2 – Sonnenrichtung und Intensität unterscheiden Tag und Nacht. Die fünf Wetterarten steuern Nebel und Regen innerhalb definierter Grenzen.
- [x] AK3 – `environment` läuft im Render-Worker vor den übrigen Systemen. `FrameInput` enthält den Umwelt-Snapshot. Render-Systeme schreiben keinen Engine-State.
- [x] AK4 – Niedrige Qualität deaktiviert Regen und Schatten. Die Regentropfen sind auf Low 0, Medium 500, High 900 und Ultra 1400 begrenzt. Schatten laufen nur bei positiver Sonnenintensität.
- [x] AK5 – `seed`, `time=HH:MM` und `weather=clear|cloudy|fog|rain|storm` erreichen den Worker. Standard sind `seed=42`, `time=12:00` und `weather=clear`. Ungültige Werte fallen einzeln auf diese Standardwerte zurück.
- [x] AK6 – Tests belegen Umweltzustand, Systemobjekte, Qualitätsverhalten und Integration in den Frame-Sampler. Der Regentest prüft einen vollständigen Wickelzyklus, sichtbare Tropfen in der fahrerzentrierten Säule und den seedabhängigen Betrag für `seed=7`. Ein Browserlauf zeigt die korrigierte Regenszene und erhält HUD sowie Tastaturbedienung.

## Testplan (`docs/10-testing.md`)

| AK  | Ebene                   | Datei / Fixture                                         |
| --- | ----------------------- | ------------------------------------------------------- |
| AK1 | Unit                    | `apps/web/src/world/environment.test.ts`                |
| AK2 | Unit                    | `apps/web/src/world/environment.test.ts`                |
| AK3 | Unit                    | `apps/web/src/world/frame.test.ts`, `scheduler.test.ts` |
| AK4 | Unit                    | `apps/web/src/world/environmentSystem.test.ts`          |
| AK5 | Unit                    | `apps/web/src/world/environment.test.ts`                |
| AK6 | Render-Worker / Browser | `apps/web/e2e/environment.spec.ts`                      |

## Nicht-Ziele

Keine Änderung an Physik, Trainerbefehlen, Wind, Bots, Drafting, Crowds, Audio, Post-Processing, Server oder Deployment. Keine neuen Abhängigkeiten oder Assets. Nasse Straßen, Wolkenmeshes, Sterne, Mond und Radlicht bleiben späteren Aufgaben vorbehalten.

## Nachweise, Grenzen und offene Risiken

Gezielt grün: 40 Unit-Tests, drei Render-Worker-/Browserfälle und ein erneuter Umweltscreenshot-Lauf. Das vollständige Gate besteht mit 1.127 Tests und 63 E2Es. Oxfmt, type-aware Oxlint, Typecheck, dependency-cruiser, Guard und Build sind grün. Das unabhängige Review ist APPROVE. Der korrigierte Screenshot zeigt sichtbaren Regen rund um den Fahrer bei lesbarem HUD.

Echte GPU-Leistung und die visuelle Abstimmung auf Hardware bleiben offen. Die Tageszeit folgt zunächst unverändert der Fahrzeit. Merge, CI und Bereitstellung stehen noch aus.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Roadmap-Teilschritt präzisieren
- [x] `docs/04-world-3d.md` aktualisieren
- [x] ADR geprüft: keine Entscheidungs- oder Leitplankenänderung
