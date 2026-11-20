# ADR-014 – Abhängigkeiten für die erste 3D-Szene

**Status:** Umsetzung der angenommenen ADR-002 und ADR-008 (2026-11-20).

## Kontext

E4-02 ergänzt erstmals ausführbares three.js-Rendering. ADR-002 legt three.js fest. ADR-008 legt den lokalen System-Scheduler ohne ECS fest.

## Entscheidung

Nur `apps/web` erhält `three` als Laufzeitabhängigkeit und `@types/three` als Entwicklungsabhängigkeit. Die Registry meldet für beide `0.187.0`. Beide Versionen sind exakt gepinnt. `mise run typecheck` und `mise run build` bestätigen die Kompatibilität mit der unveränderten strikten TypeScript-Konfiguration.

Es gibt keine weiteren direkten Abhängigkeiten. Keine UI-Bibliothek, kein ECS, keine Loader oder Asset-Werkzeuge werden ergänzt. Die erste Szene erzeugt Geometrie und Materialien selbst.

## Konsequenzen

Three-Imports bleiben in `world/` und `avatar/`. Renderer, Geometrien und Materialien besitzen eine explizite Freigabe. Die TypeScript-Konfiguration bleibt unverändert. E4-02 beansprucht weder die vollständige Asset-Pipeline noch die Performance-Abnahme von E4.

## Alternative

Ein Framework oder eine zweite Render-Engine würde ADR-002 widersprechen und den ersten fahrbaren Stand vergrößern.
