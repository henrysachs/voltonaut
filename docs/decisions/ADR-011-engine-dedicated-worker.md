# ADR-011 – Engine im Dedicated Web Worker

**Status:** Vorgeschlagen (2026-11-20). Implementiert in E3, Freigabe durch Henry ausstehend.

## Kontext

Die Fahrt darf beim Tabwechsel nicht vom Render-Loop abhängen. Web Bluetooth bleibt auf dem Main Thread. Die Engine muss ohne Browser-APIs auch auf dem Server laufen.

## Entscheidung

- `apps/web/src/game/engine-worker.ts` startet einen Dedicated Web Worker. Der Worker besitzt die laufende Engine.
- `engine-link.ts` überträgt typisierte `DeviceEvent`s zum Worker. Snapshots, Fahrt-Events und Trainer-Kommandos gehen zurück zum Main Thread.
- `packages/engine` bleibt frei von DOM, Worker-APIs und Wanduhrzugriffen. `advance(elapsedS)` integriert mit einem Akkumulator feste Schritte von 0,05 s.
- Pro Aufwachung verarbeitet die Engine höchstens 120 Ticks. Größere Lücken erzeugen `ride.clockSkipped`; die Datenausfall-Regel setzt Leistung und Kadenz nach mehr als 3 s ohne neue Trainerdaten auf null.
- BLE-Schreibzugriffe und deren Serialisierung bleiben Aufgabe des Main Threads und des E2-Trainer-Adapters.

## Konsequenzen

Tabwechsel blockieren die Integration nicht durch ein ausbleibendes `requestAnimationFrame`. Unit-Tests prüfen den Akkumulator und das Catch-up-Limit. Ein Playwright-Test prüft wachsende Distanz nach dem Tabwechsel.

Ein Worker garantiert kein Weiterlaufen bei Chrome Page Freezing oder Betriebssystem-Ruhezustand. Henry prüft mehr als fünf Minuten Hintergrundbetrieb mit aktiver BLE-Verbindung. Verlorene Zeit wird nicht unbegrenzt nachgerechnet.

Es gibt keine neue externe Abhängigkeit. Die Engine importiert Typen und Profil-Schemas aus `@voltonaut/shared` über `workspace:*`, entsprechend ADR-006.

## Alternativen

- Main-Thread-Engine mit Worker-Timer. Ein eingefrorener Main Thread könnte die Wecknachrichten nicht verarbeiten.
- Engine im Render-Loop. Hintergrund-Tabs erhalten keine verlässlichen Render-Callbacks.
- Unbegrenztes Catch-up. Veraltete Wattwerte würden lange Uhr-Lücken als gefahrene Zeit verbuchen und die Verarbeitung blockieren.
