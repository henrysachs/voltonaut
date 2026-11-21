# ADR-019 – WebGL im getrennten Render-Worker

**Status:** Gewählte und implementierte Softwareform. Unabhängige Ownership- und Runtime-Reviews sowie erneutes Gesamtgate grün. Hardware-FPS bleiben offen.

## Kontext

Issue #20 betrifft blockierte BLE-, HUD- und Eingabe-Callbacks. Ein gematchter TEMP-Gegenversuch zeigte einen nativen Chromium-Readback von 5123 ms auf Main. Die Engine lieferte währenddessen 87 Snapshots, Main empfing keinen davon. Derselbe direkte OffscreenCanvas-Pfad verschob das native Warten in einen Render-Worker. Die beiden ursprünglichen Tests bestanden dort. Das war ein begrenzter Gegenversuch, keine Produktionsfreigabe.

Die Engine läuft bereits getrennt nach ADR-011. Das schützt nicht vor blockierten Geräte- und HUD-Callbacks auf Main. Ein weiterer Engine-Timer löst dieses Problem nicht.

## Entscheidung

- Main überträgt den DOM-Canvas genau einmal, vor jedem Kontextzugriff, an `world/render-worker.ts`.
- Der Render-Worker besitzt WebGL2, Three, Ressourcen, Scheduler, FrameSampler und den Render-Loop.
- `world/scene-core.ts` baut dieselbe Welt mit den bestehenden Environment-, Landscape-, Road-, Rider- und Camera-Systemen. Es gibt keinen zweiten Weltgenerator.
- `RideSceneOptions` erhält die erforderliche `routeId`. Der Worker rekonstruiert die Route über `TEST_ROUTES` und `createRoute`. Unbekannte IDs schlagen fehl. Funktionen werden nicht geklont.
- Main besitzt DOM, ResizeObserver, Kamera-Button und Tastatur. Formulareingaben wechseln die Kamera nicht.
- Die Darstellung überträgt höchstens einen unbestätigten Snapshot und hält höchstens einen ersetzbaren aktuellen Snapshot zurück. Diese Regel gilt nicht für Geräteereignisse, Engine-Ereignisse oder Aufnahmen.
- Der FrameSampler verwendet ausschließlich die lokale Render-Worker-Uhr für Interpolation. Engine-Zeit, Gerätefrische und EMA bleiben unverändert.
- Medium, DPR-Grenze 1,25, Schatten, Geometrie, Materialien, Perspektive, SRGB und ACES bleiben erhalten.
- Fehlende Unterstützung, Initialisierungsfehler und Kontextverlust zeigen den bisherigen Hinweis `3D unavailable`. Es gibt keinen Main-WebGL-Fallback und keine CPU-Bildkopie.

## Start und Lebensdauer

Während des Starts zeigt ein zugänglicher Status an, dass die Fahrt bereits bedienbar ist. `render.ready` bestätigt ausschließlich den Aufbau. Erst ein echter Renderaufruf mit Draw Calls und Dreiecken sowie eine folgende Worker-Task beenden den Ladestatus.

`render.frame` trägt den Zustand `after-render-task`. Das bestätigt keine sichtbaren Pixel. Der Browser besitzt die Präsentation. Ein Screenshot bleibt der Nachweis einer sichtbaren Welt.

Dispose stoppt Snapshot-Pull, Observer und DOM-Listener sofort. Der Worker beendet den Loop und gibt Systeme und Renderer frei. Main beendet den Worker nach dessen Bestätigung. Bleibt die Bestätigung aus, fordert ein Main-Timer die Terminierung nach einer Sekunde an. Ein nativ blockierter Render-Worker verhindert diesen Timer nicht. Späte Nachrichten ändern weder DOM noch Lifecycle. Kontextverlust durch Dispose löst keinen neuen Fehler aus.

## Grenzen und Alternativen

Kein FPS-, Hardware-, allgemeiner CI- oder dauerhafter Reconnect-/EMA-Nachweis. Initiale Präsentation kann weiterhin langsam sein. Ein Worker garantiert keinen Fortschritt bei Betriebssystemschlaf oder Browser-Freezing. Die Korrektur verschiebt den Besitzer des nativen Wartens, sie entfernt das Warten nicht.

Ein CPU-Pfad über `getImageData` und `putImageData` sowie ein paralleler Main-Renderer sind ausgeschlossen. Sie ändern die gemessene Besitzgrenze oder verdoppeln die Implementierung. Neue Abhängigkeiten entstehen nicht.

Testplan und aktuelle Nachweisgrenzen stehen in [E4-04](../specs/E4-04-render-worker-isolation.md).
