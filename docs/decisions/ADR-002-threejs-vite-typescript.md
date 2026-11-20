# ADR-002 – three.js + Vite + TypeScript, statisch gehostet

**Status:** Angenommen (2026-11-19)

## Kontext

Henry will ein echtes 3D-Spiel mit animiertem Fahrer, im Browser (Web Bluetooth, Chrome/Edge am Laptop), Code öffentlich auf GitHub, damit mehrere Coding-Agenten mitarbeiten können.

## Entscheidung

- **three.js** als 3D-Engine (direkt, ohne React-Three-Fiber).
- **Vite** als Build/Dev-Server (schnelles HMR, `localhost` = secure context für Web Bluetooth, Multi-Page-Entry für `debug/ble.html`).
- **TypeScript strict** für alle Module; Protokoll-Parser und Engine als reine, testbare Funktionen.
- Hosting des Clients als statische Seite (HTTPS). Anbieter: **Cloudflare Pages** – siehe ADR-009 (ursprünglich GitHub Pages geplant, am 2026-11-19 geändert).

## Konsequenzen

- - Riesiges Ökosystem, viele Beispiele (Agenten kennen three.js gut), volle Kontrolle über Render-Loop und Performance.
- - Kein Framework-Overhead im Hot Path; UI-Overlays mit schlankem DOM/TS (ggf. später Preact für Garage-Screens).
- − Kein Editor/Szenengraph-Tooling wie bei Game-Engines; Welt-Tools selbst bauen.
- − Typen für Web Bluetooth via `@types/web-bluetooth`.

## Alternativen

Babylon.js (stärker „Engine", gute Physik/Inspector – valide Alternative, aber weniger verbreitet), PlayCanvas (Editor-zentriert, Cloud), Unity/Godot WebGL-Export (schwer, Web-Bluetooth-Brücke umständlich), React Three Fiber (zusätzliche Abstraktion im Render-Loop).
