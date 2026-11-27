# Architecture Decision Records

Format: Kontext → Entscheidung → Konsequenzen → Alternativen. Neue ADRs fortlaufend nummerieren; ersetzte ADRs auf „Ersetzt durch ADR-xxx" setzen, nicht löschen. Jedes ADR steht genau einmal in der Tabelle. Ihre Statusspalte nennt denselben Entscheidungsstand wie die `Status:`-Zeile des ADR: „Vorgeschlagen …“, „Ersetzt …“/„Abgelöst …“ oder sonst entschieden. `apps/web/src/consistency/adr-index.test.ts` prüft Nummern, Tabelle und Status. Änderungen an Leitplanken (Lint-, TS-, depcruise-Regeln, neue Abhängigkeiten) brauchen ein ADR.

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
| [017](ADR-017-strava-connection.md) | Strava-Verbindung und verschlüsselte Zugangsdaten | Vorgeschlagen; serverseitig aktiviert, echter Pilot offen |
| [018](ADR-018-actor-recording-and-explicit-delivery.md) | Actor-Aufnahme und ausdrückliche Strava-Auslieferung | Gewählte Softwareform für E10-04 |
| [019](ADR-019-render-worker-isolation.md) | WebGL im getrennten Render-Worker | Softwaregeprüft für E4-04; Hardware-FPS offen |
| [020](ADR-020-explicit-production-provisioning.md) | Einmalige Produktionsprovisionierung und optionales Backup | Angenommen; ausdrückliche Freigabe vom 21.11.2026 |
| [021](ADR-021-membership-and-administration.md) | Mitgliedschaft und Administration trennen | Gewählte Form für Henrys Auftrag vom 21.11.2026 |
| [022](ADR-022-real-strava-provisioning.md) | Echte Strava-Konfiguration und verifizierte Deautorisierung | Gewählte Form für Henrys Aktivierungsauftrag vom 21.11.2026 |
| [023](ADR-023-sequence-browser-gate.md) | Browserprüfung nach CPU-schweren Gate-Aufgaben | Von Henry am 23.11.2026 freigegeben |
| [024](ADR-024-reward-quote-contracts.md) | Domänenverträge für reine Belohnungsangebote | Gewählte Implementierungsform vom 23.11.2026 |
| [025](ADR-025-handwritten-service-worker.md) | Handgeschriebener Service Worker für die installierbare PWA | Angenommen für E10-09 |
| [026](ADR-026-configurable-oidc-providers.md) | Konfigurierbare OIDC-Provider, Cloudflare Access ist einer davon | Vorgeschlagen, Henrys Freigabe ausstehend |
| [027](ADR-027-server-volts-ledger.md) | Serverseitiges Volts-Journal und gemeinsame Rules-Rechnung | Angenommen für E6-05 |
| [028](ADR-028-ride-modes-and-fun-items.md) | Spielmodi als Union mit Eigenschaften; Spaß-Modus-Items wirken in Phase 1 nur auf die Fahrphysik, Malus erst nach Freigabe | Vorgeschlagen; Henrys Freigabe für Phase 2 ausstehend |
| [029](ADR-029-progress-transport-policy.md) | Progress-Transport, Quellenpolitik und UTC-Tagesgrenze | Angenommen für E6-07 bis E6-10 |
| [030](ADR-030-webgpu-renderer.md) | WebGPU ohne zweites Render-Backend, Ultra zurückgestellt | Vorgeschlagen, Henrys Freigabe ausstehend |
| [031](ADR-031-server-inventory-and-operator-grant.md) | Server-Inventar, atomare Käufe und Operator-Gutschrift; Mindestlevel vorerst ungeprüft | Angenommen für E7-02 |
| [032](ADR-032-garage-preview-worker.md) | Garage-Vorschau im Render-Worker | Angenommen |
| [033](ADR-033-connected-worlds.md) | Zusammenhängende Welten aus Straßennetz, Höhenraster und Regionen | Angenommen |
| [034](ADR-034-hardware-capture-fixtures.md) | Hardware-Mitschnitte als BLE-Fixtures | Angenommen |
