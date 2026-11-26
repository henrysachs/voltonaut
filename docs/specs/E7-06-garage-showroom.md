# Spec E7-06 – Garage-Showroom, Orbit-Kamera und Fotomodus

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E7, Checkbox „Garage-Showroom (Studio-Licht, Drehteller, Fotomodus), Shop mit Preisen in ⚡, gesperrte Items mit Bedingung“
- **Issue:** #122 · Abhängigkeiten: [E7-05](E7-05-garage-loadout.md) und [E4-11](E4-11-in-ride-menu-redesign.md) sind gemergt. Der Preview-Worker aus #154 ist die aktuelle Render-Grenze.
- **Status:** In Arbeit
- **Betroffene Module:** `apps/web/src/ui/garage`, `apps/web/src/styles.css`, `apps/web/e2e`, `docs/05-avatar-customization.md`, `docs/07-roadmap.md`

## Ziel

Die Garage zeigt den Fahrer und das Rad als Studio-Szene. Die Nutzer drehen die Ansicht per Maus, Touch und Tastatur. Der Fotomodus blendet HUD und Menü aus und lädt nur die sichtbare Vorschau als PNG herunter.

## Abnahmekriterien

- [ ] AK1 – Die Vorschau zeichnet Studio-Licht, einen Boden und einen Drehteller im bestehenden Preview-Worker. Ein Screenshot der tatsächlich gerenderten Szene wird als Test-Anhang beigefügt.
- [ ] AK2 – Ziehen mit Maus, Touch oder Stift ändert die Orbit-Kamera. Die Neigung bleibt innerhalb festgelegter Grenzen. Die bestehenden Drehknöpfe bleiben als Tastatur-Alternative nutzbar.
- [ ] AK3 – Die fokussierte Vorschau reagiert auf Pfeiltasten. Horizontal dreht, vertikal neigt und `Home` setzt die Ansicht zurück. Die Tasten lösen keine globalen Fahr- oder Menükürzel aus.
- [ ] AK4 – Bei `prefers-reduced-motion: reduce` dreht sich die Vorschau nicht automatisch. Manuelle Orbit-Eingaben bleiben möglich.
- [ ] AK5 – Der Fotomodus blendet HUD, Menükopf, Tabs, Item-Auswahl und Menüfuß aus. Die Vorschau füllt die Fläche. „PNG herunterladen“ und „Fotomodus beenden“ bleiben per Tastatur erreichbar. Escape beendet den Fotomodus, ohne die Fahrt zu unterbrechen.
- [ ] AK6 – Der PNG-Download enthält genau die Pixel des Preview-Canvas. Seitenmaß und PNG-Maße unterscheiden sich, wenn HUD oder Menü sichtbar wären. Die Datei enthält keine Konto- oder DOM-Daten.
- [ ] AK7 – Ohne WebGL bleibt die Garage bedienbar. Der Fotomodus ist ohne verfügbare Vorschau deaktiviert und der bestehende Hinweis „3D nicht verfügbar“ bleibt sichtbar.
- [ ] AK8 – Die bestehenden Garage- und Menü-E2Es bleiben grün. Neue E2Es prüfen Maus-, Touch- und Tastatur-Orbit, reduzierte Bewegung, Fotomodus und Download. Screenshots werden als Test-Anhänge für Henrys Sichtprüfung beigefügt.

## Testplan (`docs/10-testing.md`)

| AK   | Ebene                     | Datei / Fixture                                                                                          |
| ---- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1    | E2E mit Screenshot-Anhang | `apps/web/e2e/garage-showroom.spec.ts`                                                                   |
| 2, 3 | Unit und E2E              | `apps/web/src/ui/garage/previewOrbit.test.ts`, `apps/web/e2e/garage-showroom.spec.ts`                    |
| 4    | Unit und E2E              | `apps/web/src/ui/garage/previewOrbit.test.ts`, `apps/web/e2e/garage-showroom.spec.ts`                    |
| 5, 6 | Unit und E2E              | `apps/web/src/ui/garage/previewDownload.test.ts`, `apps/web/e2e/garage-showroom.spec.ts`                 |
| 7    | E2E                       | `apps/web/e2e/garage-shop.spec.ts`, `apps/web/e2e/garage-showroom.spec.ts`                               |
| 8    | Regression                | `apps/web/e2e/garage-shop.spec.ts`, `apps/web/e2e/game-menu.spec.ts`, `apps/web/e2e/menu-layout.spec.ts` |

## Nicht-Ziele

Keine echten visuellen Baselines mit `toHaveScreenshot`. `mise run visual:update` bleibt ein geschützter Platzhalter. Keine neue Abhängigkeit, kein WebGL-Fallback auf dem Hauptthread und keine Änderung an Fahrt, Geräten oder Ausrüstungsspeicherung.

## Offene Fragen / Risiken

- `OffscreenCanvas.convertToBlob()` muss im Preview-Worker ein PNG nach dem letzten Draw liefern. Der E2E-Download prüft das echte Format.
- Der Fotomodus teilt sich den modalen Menudialog mit der Garage. Fokus, Escape und das Schließen des Menüs müssen den vorherigen Zustand zuverlässig wiederherstellen.
- Screenshots dokumentieren die Softwareprüfung. Eine Sichtprüfung durch Henry und eine echte GPU-Bildratenmessung bleiben getrennt.

## Doku-Updates (Pflicht beim Abschluss)

- [ ] Roadmap-Text aktualisiert. Die vollständige E7-Checkbox bleibt bis zur visuellen Abnahme offen.
- [ ] `docs/05-avatar-customization.md` aktualisiert.
- [ ] Keine neue ADR nötig. ADR-032 bleibt die Grenze für den Preview-Worker.
