# Spec E7-06: Garage-Showroom, Orbit-Kamera und Fotomodus

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E7, Checkbox „Garage-Showroom (Studio-Licht, Drehteller, Fotomodus), Shop mit Preisen in ⚡, gesperrte Items mit Bedingung“
- **Issue:** #122 · Abhängigkeiten: [E7-05](E7-05-garage-loadout.md) und [E4-11](E4-11-in-ride-menu-redesign.md) sind gemergt. Der Preview-Worker aus #154 ist die aktuelle Render-Grenze.
- **Status:** Implementiert und softwaregeprüft. Review, vollständiges Gate, visuelle Abnahme und Bereitstellung bleiben offen.
- **Betroffene Module:** `apps/web/src/ui/garage`, `apps/web/src/styles.css`, `apps/web/e2e`, `docs/05-avatar-customization.md`, `docs/07-roadmap.md`

## Ziel

Die Garage zeigt den Fahrer und das Rad als Studio-Szene. Die Nutzer drehen die Ansicht per Maus, Touch und Tastatur. Der Fotomodus blendet HUD und Menü aus und lädt nur die sichtbare Vorschau als PNG herunter.

## Abnahmekriterien

- [x] AK1: Die Vorschau zeichnet Studio-Licht, einen Boden und einen Drehteller im bestehenden Preview-Worker. Ein Screenshot der tatsächlich gerenderten Szene ist als Test-Anhang beigefügt.
- [x] AK2: Ziehen mit Maus, Touch oder Stift ändert die Orbit-Kamera. Die Neigung bleibt innerhalb festgelegter Grenzen. Die bestehenden Drehknöpfe bleiben als Tastatur-Alternative nutzbar.
- [x] AK3: Die fokussierte Vorschau reagiert auf Pfeiltasten. Horizontal dreht, vertikal neigt und `Home` setzt die Ansicht zurück. Die Tasten lösen keine globalen Fahr- oder Menükürzel aus.
- [x] AK4: Bei `prefers-reduced-motion: reduce` dreht sich die Vorschau nicht automatisch. Manuelle Orbit-Eingaben bleiben möglich.
- [x] AK5: Der Fotomodus blendet HUD, Menükopf, Tabs, Item-Auswahl und Menüfuß aus. Die Vorschau füllt die Fläche. „PNG herunterladen“ und „Fotomodus beenden“ bleiben per Tastatur erreichbar. Escape beendet den Fotomodus, ohne die Fahrt zu unterbrechen.
- [x] AK6: Der PNG-Download enthält genau die Pixel des Preview-Canvas. Die PNG-Maße entsprechen dem Canvas-Backing-Store. Die sichtbare Canvas-Fläche ist kleiner als der Viewport. Die Datei enthält keine Konto- oder DOM-Daten.
- [x] AK7: Ohne WebGL bleibt die Garage bedienbar. Der Fotomodus ist ohne verfügbare Vorschau deaktiviert und der bestehende Hinweis „3D nicht verfügbar“ bleibt sichtbar.
- [x] AK8: Die bestehenden Garage- und Menü-E2Es bleiben grün. Neue E2Es prüfen Maus-, Touch- und Tastatur-Orbit, reduzierte Bewegung, Fotomodus und Download. Screenshots sind als Test-Anhänge für Henrys Sichtprüfung beigefügt.

## Testplan (`docs/10-testing.md`)

| AK   | Ebene                     | Datei / Fixture                                                                                          |
| ---- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1    | E2E mit Screenshot-Anhang | `apps/web/e2e/garage-showroom.spec.ts`                                                                   |
| 2, 3 | Unit und E2E              | `apps/web/src/ui/garage/previewOrbit.test.ts`, `apps/web/e2e/garage-showroom.spec.ts`                    |
| 4    | E2E                       | `apps/web/e2e/garage-showroom.spec.ts`                                                                   |
| 5, 6 | Unit und E2E              | `apps/web/src/ui/garage/previewDownload.test.ts`, `apps/web/e2e/garage-showroom.spec.ts`                 |
| 7    | E2E                       | `apps/web/e2e/garage-shop.spec.ts`, `apps/web/e2e/garage-showroom.spec.ts`                               |
| 8    | Regression                | `apps/web/e2e/garage-shop.spec.ts`, `apps/web/e2e/game-menu.spec.ts`, `apps/web/e2e/menu-layout.spec.ts` |

## Entscheidungen

- `GaragePreviewPanel` besitzt auf dem Hauptthread genau ein unveränderliches `PreviewOrbit`. Zeiger, Knöpfe, Tastatur und `Home` laufen durch `previewOrbit.ts`. Pitch ist auf -0,08 bis 0,65 Radiant begrenzt. Yaw wird auf [-π, π) normalisiert. Nicht-endliche Eingaben lassen den Orbit unverändert.
- Das alte `preview.rotate` und `rotateBy` ist vollständig entfernt. Alle Aufrufer senden ein absolentes `preview.orbit`. Der Worker validiert und normalisiert die Nachricht erneut.
- Der Worker behält den Avatar-Winkel und die Auto-Drehung getrennt von der Kamera. `ThreePreviewScene.render(angleRad, orbit)` setzt beide Werte unabhängig.
- Die Studio-Szene nutzt einen deckenden Hintergrund, matten Boden, eine zurückhaltende Plattform mit Ring sowie Key-, Fill- und Rim-Licht. Neue Geometrien und Materialien werden entsorgt. DPR bleibt auf 1,5 begrenzt. ADR-032 bleibt unverändert.
- Der Capture läuft im Worker. `OffscreenCanvas.convertToBlob()` liefert nach einem expliziten Draw das PNG. `PreviewLink` ordnet Antworten über Request-IDs zu und lehnt offene Promises bei Fehler oder Dispose ab.
- ADR-032 beschreibt den Preview-Worker zum Zeitpunkt der Migration. Issue #122 ändert bewusst den deckenden Clear-Farbraum und ersetzt `rotateBy` durch `setOrbit` und `capture`. Die Besitzgrenze aus ADR-032 bleibt unverändert.
- `downloadPreviewPng()` akzeptiert nur `image/png`, nutzt den festen Namen `voltonaut-garage.png` und entfernt Anker und Object-URL.
- Der Fotomodus nutzt denselben modalen Menudialog als bildschirmfüllende Bühne. Der Canvas wird weder verschoben noch erneut transferiert. Escape verlässt zuerst den Fotomodus. Fokus, Auto-Drehung, Body-Klasse und Dialog-Attribut werden beim Schließen oder Preview-Fehler bereinigt.
- Reduced Motion deaktiviert die Auto-Drehung und den Drehschalter. Manuelle Orbit-Eingaben bleiben aktiv. Medienwechsel werden überwacht.

## Nicht-Ziele

Keine echten visuellen Baselines mit `toHaveScreenshot`. `mise run visual:update` bleibt ein geschützter Platzhalter. Keine neue Abhängigkeit, kein WebGL-Fallback auf dem Hauptthread und keine Änderung an Fahrt, Geräten oder Ausrüstungsspeicherung.

## Offene Fragen / Risiken

- Henrys Sichtprüfung der Studio-Szene und des Fotomodus bleibt offen.
- Eine echte GPU-Bildratenmessung bleibt offen. Die Chromium-Softwareprüfung ist kein Hardwareattest.
- Review, vollständiges `mise run check`, Merge und Bereitstellung stehen aus.

## Nachweis

### Implementiert

Orbit-Helper, absolutes Worker-Protokoll, Studio-Szene, Worker-Capture, PNG-Download, Pointer- und Tastatursteuerung, Reduced-Motion-Behandlung und Fotomodus sind im Branch `feat/issue-122-garage-showroom` enthalten.

### Softwaregeprüft

- `pnpm --filter @voltonaut/web exec vitest run src/ui/garage`: 9 Dateien, 57 Tests grün.
- `pnpm exec tsc -b packages/shared packages/rules packages/ble packages/engine apps/web --pretty false`: grün.
- `pnpm --filter @voltonaut/web build`: grün.
- Typisierter Oxlint mit `--deny-warnings --report-unused-disable-directives` auf allen geänderten Web-Dateien: grün.
- `CI=1 E2E_PORT=5197 pnpm --filter @voltonaut/web exec playwright test e2e/garage-showroom.spec.ts e2e/garage-shop.spec.ts e2e/overlay-states.spec.ts --workers=1`: 16 Tests grün.
- `CI=1 E2E_PORT=5197 pnpm --filter @voltonaut/web exec playwright test e2e/garage-loadout.spec.ts e2e/garage-purchase.spec.ts e2e/game-menu.spec.ts e2e/menu-layout.spec.ts --workers=1`: 65 Tests grün.
- Der Download-Test prüft bei DPR 2 PNG-Signatur, IHDR, Canvas-Backing-Store, sichtbare CSS-Fläche und mindestens ein deckendes Pixel nach dem Decode im Browser.

Die Tests hängen `garage-showroom.png`, `garage-photo-mode.png`, `voltonaut-garage.png` und die drei bestehenden Garage-Screenshots an den Playwright-Bericht.

### Echte Hardware

Nicht geprüft. Die Softwareprüfung belegt kein Hardwareverhalten und keine GPU-Leistung auf Henrys Laptop.

### Bereitgestellt

Nein. Dieser Auftrag erzeugt weder PR noch Merge noch Deploy.

## Doku-Updates

- [x] Roadmap-Text aktualisiert. Die vollständige E7-Checkbox bleibt bis zur visuellen Abnahme offen.
- [x] `docs/05-avatar-customization.md` aktualisiert.
- [x] Keine neue ADR nötig. ADR-032 bleibt die Grenze für den Preview-Worker.
