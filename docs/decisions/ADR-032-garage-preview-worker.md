# ADR-032 – Garage-Vorschau im Render-Worker

**Status:** Angenommen (Henrys Freigabe im Chat am 2026-11-26). Erweitert [ADR-019](ADR-019-render-worker-isolation.md) auf die Garage.

## Kontext

`ui/garage/preview.ts` erzeugte einen `THREE.WebGLRenderer` auf dem Main Thread und renderte bei jedem rAF mit Auto-Rotation. Fahrt und Geräte laufen bei offenem Menü weiter (AGENTS.md §9). Unter Last zeigte Main Long Tasks von 1,5–2,5 s und nur 3–4 Frames in 5 s. Damit kommt Playwrights Stabilitätsprüfung nicht zur Ruhe: `garage-shop.spec.ts:37` und `:153` scheitern. Schwerer wiegt, dass derselbe Main Thread HUD-, BLE- und Eingabe-Callbacks verarbeitet. ADR-019 hat dieses Problem für die Fahrtwelt gelöst, die Garage aber nicht abgedeckt.

Beleg aus PR #144: gleiche Last, nur WebGL auf Main abgeschaltet, 10/10 grün statt 10/10 rot.

## Entscheidung

- Main überträgt den Garage-Canvas genau einmal per `transferControlToOffscreen()` vor jedem Kontextzugriff an `ui/garage/previewWorker.ts`.
- Der Worker besitzt WebGL2, three, Szene, `createAvatarPreview` und den rAF-Loop. Szene, Licht, Boden, Kamera, DPR-Grenze 1,5, Antialiasing, Alpha und transparente Clear-Farbe bleiben unverändert.
- Main besitzt DOM, ResizeObserver, Reduced-Motion-Abfrage, Dreh-Buttons und `aria`. `GaragePreviewView` (`setLook`, `setAutoRotate`, `rotateBy`, `dispose`) bleibt gleich und sendet Nachrichten.
- `AvatarConfig` ist reines JSON. Der Worker parst es an der Grenze mit `AvatarConfigSchema`. Ungültige Looks beenden die Vorschau als Fehler.
- Fehlende `Worker`/`OffscreenCanvas`-Unterstützung, fehlendes WebGL2, Initialisierungsfehler, Workerfehler und Kontextverlust zeigen den bisherigen Hinweis „3D nicht verfügbar. Item-Auswahl, Farben und Informationen bleiben nutzbar.“ Es gibt keinen Main-WebGL-Fallback.
- Der Ladestatus (`aria-busy`, `data-preview-ready`) endet erst nach einem echten Draw mit Draw Calls und Dreiecken und einer folgenden Worker-Task, wie in ADR-019.
- Dispose trennt Observer und Canvas sofort. Der Worker gibt Avatar, Geometrie, Material und Renderer frei und bestätigt. Main terminiert nach der Bestätigung oder nach 1 s.
- Die Dateien liegen in `ui/garage`, wo `three` laut dependency-cruiser erlaubt ist. Keine Regeländerung, keine neue Abhängigkeit.

## Konsequenzen

- Natives GL-Warten der Garage gehört nicht mehr dem Main Thread.
- Die Zahl der GL-Kontexte bleibt gleich: Vorher besaß Main einen Garage-Kontext, jetzt besitzt ihn der Preview-Worker. Zusätzlich kostet nur der Worker-Thread. Das Garage-Panel wird beim Start montiert und lebt die ganze Sitzung, also auch der Worker.
- `dispose` wird in Produktion nicht aufgerufen. Das galt schon vor dieser Änderung. Ein Aufrufer (z. B. bei `pagehide` oder beim Abbau des Menüs) ist ein Folgeschritt.
- Die Fehlererkennung ist asynchron. Die Garage wechselt nach einem Worker-Fehler nachträglich in `unavailable3d`.
- E2E-Fehlerinjektionen müssen den Worker treffen (`previewWorkerPrelude`), nicht `HTMLCanvasElement.getContext` auf Main.
- Wie bei ADR-019 verschiebt der Worker das Warten, er entfernt es nicht. Kein FPS- oder Hardwarenachweis.

## Alternativen

- **Nur bei Änderung zeichnen:** verworfen. Das ändert das Produktverhalten der Auto-Rotation.
- **Bildrate senken:** verworfen. Das verbiegt Grafikqualität, um Tests zu bestehen (AGENTS.md §10).
- **Auf Main belassen:** verworfen. HUD-, BLE- und Eingabe-Callbacks bleiben dann von GL-Wartezeiten blockierbar.
- **Gemeinsamer Worker mit der Fahrtwelt:** verworfen. Das verkoppelt zwei Lebensdauern und Protokolle. Die Muster (einmaliger Transfer, Link mit Dispose-ACK und Timer, Loop mit First-Draw-Readiness) sind übernommen.
