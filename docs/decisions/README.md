# Architecture Decision Records

Format: Kontext → Entscheidung → Konsequenzen → Alternativen. Neue ADRs fortlaufend nummerieren; ersetzte ADRs auf „Ersetzt durch ADR-xxx" setzen, nicht löschen. Änderungen an Leitplanken (Lint-, TS-, depcruise-Regeln, neue Abhängigkeiten) brauchen ein ADR.

| ADR | Titel | Status |
|---|---|---|
| [001](ADR-001-virtual-shifting-via-ftms.md) | Virtuelles Schalten in der App über FTMS | Angenommen |
| [002](ADR-002-threejs-vite-typescript.md) | three.js + Vite + TypeScript, Client statisch gehostet | Angenommen |
| [003](ADR-003-local-only-persistence.md) | Spielfortschritt nur lokal (IndexedDB) | ⛔ Ersetzt durch 005 |
| [004](ADR-004-multiplayer-server-hetzner.md) | Backend-Server: TypeScript/NestJS (+ Drizzle/SQLite) auf Hetzner-VPS | Angenommen |
| [005](ADR-005-server-authoritative-accounts-economy.md) | Server-autoritative Accounts & Ökonomie, offline-first Client | Angenommen |
| [006](ADR-006-monorepo-pnpm-workspaces.md) | Monorepo mit pnpm workspaces (Nx verworfen) | Angenommen |
| [007](ADR-007-guardrails-tooling.md) | Strikte Leitplanken: mise, Oxlint + anti-slop, strengstes TS, dependency-cruiser, Oxfmt | Angenommen |
| [008](ADR-008-scene-structure.md) | Szenenstruktur: three.js-Szenengraph + System-Scheduler, kein ECS | Angenommen |
| [009](ADR-009-hosting-cloudflare-pages.md) | Web auf Cloudflare Pages, API auf Hetzner, Login-Mails über Cloudflare Email Sending (Fallback Resend) | Angenommen |
| [010](ADR-010-observability.md) | Observability: OpenTelemetry, strukturierte Logs, vorhandener Grafana-Stack | Angenommen |
| [011](ADR-011-engine-dedicated-worker.md) | Engine im Dedicated Web Worker | Vorgeschlagen, Henrys Freigabe ausstehend |
