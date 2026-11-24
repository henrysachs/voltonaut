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
| [009](ADR-009-hosting-cloudflare-pages.md) | Web auf Cloudflare Pages, API auf Hetzner; historische Login-Mail-Auswahl | Hosting angenommen; Login-Mail-Ziel durch 013 ersetzt |
| [010](ADR-010-observability.md) | Observability: OpenTelemetry, strukturierte Logs, vorhandener Grafana-Stack | Angenommen |
| [011](ADR-011-engine-dedicated-worker.md) | Engine im Dedicated Web Worker | Vorgeschlagen, Henrys Freigabe ausstehend |
| [012](ADR-012-server-skiplibcheck-drizzle.md) | `skipLibCheck: true` nur für `apps/server` wegen Drizzle-Deklarationen | Angenommen |
| [013](ADR-013-cloudflare-access-oidc.md) | Cloudflare Access als OIDC-Broker für den Login | App und Pilot-Policy eingerichtet; Laufzeit und echter Pilot offen |
| [014](ADR-014-three-rendering-dependencies.md) | Abhängigkeiten für die erste 3D-Szene | Umsetzung von ADR-002 und ADR-008 |
| [015](ADR-015-oidc-client-library.md) | openid-client für serverseitigen OIDC-Codeflow | Gewählt für E5-06 |
| [016](ADR-016-server-engine-replay.md) | Öffentliche Engine für reine Server-Nachrechnung | Gewählt für E10-02 |
| [017](ADR-017-strava-connection.md) | Strava-Verbindung und verschlüsselte Zugangsdaten | Serverseitiger Teilschnitt integriert; echter Pilot offen |
| [018](ADR-018-actor-recording-and-explicit-delivery.md) | Actor-Aufnahme und ausdrückliche Strava-Auslieferung | Gewählte Softwareform für E10-04 |
| [019](ADR-019-render-worker-isolation.md) | WebGL im getrennten Render-Worker | Softwaregeprüft für E4-04; Hardware-FPS offen |
| [020](ADR-020-explicit-production-provisioning.md) | Einmalige Produktionsprovisionierung und optionales Backup | Angenommen; ausdrückliche Freigabe vom 21.11.2026 |
| [025](ADR-025-fun-mode-trainer-effects.md) | Trainerwirkung von Spaß-Modus-Items: Phase 1 senkt Last nur, Malus erst nach Freigabe | Vorgeschlagen; Henrys Freigabe für Phase 2 ausstehend |
