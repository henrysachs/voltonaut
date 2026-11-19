# ADR-006 – Monorepo mit pnpm workspaces (Nx verworfen)

**Status:** Angenommen (2026-11-19)

## Kontext
Client (Vite/three.js) und Server (NestJS) teilen Typen, Physik, Gangmodell, Belohnungsregeln und Protokoll-Schemas. Mehrere Coding-Agenten arbeiten parallel; Grenzen zwischen den Teilen müssen maschinell durchgesetzt werden (ADR-007). Henry kennt Nx, will es aber nicht erzwingen.

## Entscheidung
Ein Repo mit **pnpm workspaces**, Layout:
```
apps/
  web/        @voltonaut/web     Vite + three.js Client (world, avatar, game, ui, sync, net, main.ts) + debug/ble.html
  server/     @voltonaut/server  NestJS API + WS-Gateway
packages/
  shared/     @voltonaut/shared  Typen, Einheiten, Zod-Schemas (API, WS, Ride-Upload), Event-Typen – kein DOM, kein Node
  engine/     @voltonaut/engine  Physik, Gangmodell, RideState + tick (rein), Trainer-Mapping – kein DOM, kein Node
  rules/      @voltonaut/rules   XP/Level, Volts-Formel, Badges, Katalog-/Level-Daten – kein DOM, kein Node
  ble/        @voltonaut/ble     Web-Bluetooth-Adapter + Byte-Parser (FTMS, HRS, CPS, Zwift Play) + Sim-Geräte – DOM ok, kein Node
tools/
  oxlint/anti-slop/              vendorte Lint-Regeln (ADR-007)
scripts/                         guard.mjs u. ä.
fixtures/ble/                    Sniffer-Exporte (Testdaten)
docs/
```
- Pakete werden als TS-Quellen über `exports` konsumiert (kein Vorab-Build für Web; Server-Build bündelt sie).
- Interne Abhängigkeiten nur über `workspace:*`. Versionen externer Pakete exakt (`save-exact=true`).
- Orchestrierung ausschließlich über **mise-Tasks** und `pnpm -r`/`--filter`; TypeScript Project References (`tsc -b`) für inkrementelles Typechecking.

## Konsequenzen
- + Minimaler Werkzeug-Stack, Standard-pnpm, wenig Konfiguration; jeder Agent versteht es.
- + Geteilter Code existiert genau einmal; Server-Validierung = Client-Logik.
- − Kein Task-Graph-Caching wie bei Nx/Turborepo; bei der Projektgröße unkritisch (Vitest/tsc inkrementell).
- − Modulgrenzen müssen separat durchgesetzt werden → dependency-cruiser (ADR-007).

## Alternativen
- **Nx:** Caching, Generatoren, `@nx/enforce-module-boundaries`. Verworfen: Die Boundary-Regel ist **nur als ESLint-Regel** verfügbar (wir nutzen Oxlint, kein ESLint), plus zusätzliche Projekt-/Tag-Konfiguration und Nx-Daemon. dependency-cruiser leistet die Grenzprüfung unabhängig vom Linter.
- **Turborepo:** Caching ohne Boundary-Regeln; zusätzlicher Baustein ohne klaren Nutzen bei dieser Größe.
- **Polyrepo:** Doppelpflege geteilter Logik, Versionierungsaufwand.
