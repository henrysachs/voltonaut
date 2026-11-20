# Abhängigkeiten (Register)

Jede **installierte** direkte Abhängigkeit hat einen Eintrag (geprüft von `scripts/guard.mjs`). Versionen stehen exakt in der jeweiligen `package.json`; hier nur Zweck und ADR. Neue Einträge nur mit ADR.

E3 ergänzt `@voltonaut/shared` als direkte Workspace-Abhängigkeit der Engine (ADR-006, ADR-011). Worker und IndexedDB nutzen native Browser-APIs; neue externe Abhängigkeiten gibt es nicht.

## Installiert (E0, ergänzt in E3)

| Paket                                                      | Workspace                                                          | Zweck                                                  | ADR      |
| ---------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ | -------- |
| typescript                                                 | root (dev)                                                         | Typecheck                                              | 002, 007 |
| oxlint, @oxlint/plugins (gleiche Version), oxlint-tsgolint | root (dev)                                                         | Lint (type-aware) + vendorte anti-slop-Regeln          | 007      |
| oxfmt                                                      | root (dev)                                                         | Format                                                 | 007      |
| dependency-cruiser                                         | root (dev)                                                         | Modulgrenzen                                           | 007      |
| vitest, @vitest/coverage-v8                                | root (dev)                                                         | Unit/Integration-Tests + Coverage                      | 007      |
| fast-check                                                 | root (dev)                                                         | Property-based Tests                                   | 007      |
| @stryker-mutator/core, @stryker-mutator/vitest-runner      | root (dev)                                                         | Mutationstests (engine/rules)                          | 007      |
| wrangler                                                   | root (dev)                                                         | Cloudflare-Pages-Deploy (`deploy-web.yml`)             | 009      |
| @types/node                                                | root, apps/web, apps/server (dev)                                  | Node-Typen für Tools/Tests                             | 007      |
| vite                                                       | apps/web, apps/server (dev)                                        | Dev-Server/Build (Server als SSR-Bundle)               | 002      |
| @playwright/test                                           | apps/web (dev)                                                     | E2E im Sim-Modus                                       | 007      |
| zod                                                        | packages/shared                                                    | Zod-Schemas (API/WS/Upload, Health)                    | 004      |
| @voltonaut/shared                                          | packages/engine, packages/ble, apps/server, apps/web (workspace:*) | geteilte Typen/Schemas/Event-Bus                       | 006      |
| @voltonaut/engine                                          | packages/rules, apps/web (workspace:*)                             | Gangmodell, Physik, Fahrten                            | 006      |
| @voltonaut/rules                                           | apps/web (workspace:*)                                             | HUD-Labels (Katalog)                                   | 006      |
| @voltonaut/ble                                             | apps/web (workspace:*)                                             | Sim-Geräte + Keyboard-Adapter                          | 006      |
| @nestjs/common, @nestjs/core, @nestjs/platform-express     | apps/server                                                        | Server-Framework                                       | 004      |
| reflect-metadata                                           | apps/server                                                        | Nest-Decorator-Metadaten zur Laufzeit                  | 004      |
| rxjs                                                       | apps/server                                                        | Observable-Interop von Nest                            | 004      |
| @nestjs/testing, supertest                                 | apps/server (dev)                                                  | Server-Integrationstests                               | 004, 007 |
| @types/supertest                                           | apps/server (dev)                                                  | Typen für Supertest                                    | 004, 007 |
| unplugin-swc, @swc/core                                    | apps/server (dev)                                                  | Decorator-Metadaten für Vitest/Vite (Nest-DI in Tests) | 004, 007 |

## Freigegeben, aber noch nicht installiert

ADR-010 gibt die Observability-Pakete frei; sie werden in **E0-opt** (erstes VPS-Deploy) mit exakten Versionen gepinnt und hier in die Tabelle oben verschoben: `@opentelemetry/sdk-node`, `@opentelemetry/api`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-prometheus`, `nestjs-pino`, `pino`, `pino-http` (Details `11-observability.md`).

Später (eigenes ADR nötig): `three` + Loader (E4, `04-world-3d.md`), `@gltf-transform/cli` (Asset-Pipeline, E4), `@nestjs/websockets` + `@nestjs/platform-ws` (E5), `drizzle-orm` + `better-sqlite3` + `drizzle-kit` (E5), `@nestjs/throttler` + `nestjs-zod` (E5), `@simplewebauthn/server` (Passkeys, E5+), Mail-SDK (falls nicht per fetch/SMTP), `idb`.
