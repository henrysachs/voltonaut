# Abhängigkeiten (Register)

Jede direkte Abhängigkeit braucht einen Eintrag (geprüft von `scripts/guard.mjs`). Versionen exakt in `package.json`; hier nur Zweck und ADR. Neue Einträge nur mit ADR.

| Paket                                                                                                          | Workspace         | Zweck                   | ADR      |
| -------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------- | -------- |
| typescript                                                                                                     | root (dev)        | Typecheck               | 002, 007 |
| vite                                                                                                           | apps/web (dev)    | Dev-Server/Build        | 002      |
| three                                                                                                          | apps/web          | 3D-Rendering            | 002, 008 |
| zod                                                                                                            | packages/shared   | Schemas Client/Server   | 004      |
| @nestjs/core, @nestjs/common, @nestjs/platform-express                                                         | apps/server       | Server-Framework        | 004      |
| @nestjs/websockets, @nestjs/platform-ws                                                                        | apps/server       | Live-Gateway            | 004      |
| @nestjs/throttler, nestjs-zod                                                                                  | apps/server       | Rate-Limit, Validierung | 004      |
| drizzle-orm, better-sqlite3, drizzle-kit (dev)                                                                 | apps/server       | DB                      | 004      |
| oxlint, @oxlint/plugins, oxlint-tsgolint                                                                       | root (dev)        | Lint (+ anti-slop)      | 007      |
| oxfmt                                                                                                          | root (dev)        | Format                  | 007      |
| dependency-cruiser                                                                                             | root (dev)        | Modulgrenzen            | 007      |
| vitest, @vitest/coverage-v8, fast-check, @stryker-mutator/core, @stryker-mutator/vitest-runner                 | root (dev)        | Tests                   | 007      |
| @playwright/test                                                                                               | apps/web (dev)    | E2E/visuell/Perf        | 007      |
| unplugin-swc, @swc/core, @nestjs/testing, supertest                                                            | apps/server (dev) | Server-Tests            | 004, 007 |
| @gltf-transform/cli                                                                                            | root (dev)        | Asset-Pipeline          | 008      |
| wrangler                                                                                                       | root (dev)        | Cloudflare-Pages-Deploy | 009      |
| Später (eigenes ADR nötig): `@simplewebauthn/server` (Passkeys), Mail-SDK (falls nicht per fetch/SMTP), `idb`. |
