# Spec E0-01 – Monorepo, Leitplanken, Sim-Modus, CI und Server-Gerüst

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E0, alle nicht optionalen Checkboxen
- **Status:** Review
- **Betroffene Module:** Root-Tooling, `packages/*`, `apps/web`, `apps/server`, `fixtures/depcruise`, `deploy`, `.github`

## Ziel

Ein frischer Clone enthält ein vollständig geprüftes Monorepo. Der Browser zeigt veränderliche Sim-Werte und reagiert auf die Gangtasten. Die NestJS-API liefert lokal und in CI eine typisierte Health-Antwort. Deploy-Workflows sind vorbereitet, aber ohne Zugangsdaten beziehungsweise Freigabe inaktiv.

## Abnahmekriterien (aus der Roadmap übernommen und präzisiert)

- [x] AK1 – `apps/web`, `apps/server` und alle vier Pakete sind pnpm-Workspaces mit exakten Versionen und `workspace:*` für interne Abhängigkeiten.
- [x] AK2 – `mise.toml` pinnt Node und pnpm und enthält alle in E0 genannten Tasks.
- [x] AK3 – TypeScript Project References erzwingen die Einstellungen aus `docs/09-tooling.md` §4. DOM und Node sind in `shared`, `engine` und `rules` nicht verfügbar.
- [x] AK4 – Oxlint, die vendorten anti-slop-Regeln, type-aware Linting und Oxfmt laufen mit exakt gepinnten Versionen. Warnungen sind Fehler.
- [x] AK5 – dependency-cruiser erzwingt alle Regeln aus `docs/09-tooling.md` §6. Der Negativtest beweist, dass ein absichtlich verbotener Cross-App-Import scheitert.
- [x] AK6 – `scripts/guard.mjs` erkennt Escape-Hatches, unzulässige TS-Overrides, gelockerte Configs und nicht registrierte Abhängigkeiten.
- [x] AK7 – Vitest, Coverage, fast-check, Stryker und Playwright sind konfiguriert. `mise run check` schließt den Chromium-E2E-Test ein.
- [x] AK8 – `packages/shared` enthält die Kerntypen aus `docs/01-architecture.md`, eine Zod-Basis und typisierte Event-Bus-Verträge.
- [x] AK9 – `?sim=1` verbindet FakeTrainer, FakeHeartRate und FakePlay. Die Werte ändern sich über eine injizierbare Uhr. Pfeil hoch und Pfeil runter ändern den Gang ohne Doppel- oder Randfehler. Seit [E0-15](E0-15-sim-ble-transport.md) laufen Sim-Trainer und Sim-Pulsgurt als Peripherie hinter `BleTransport`; FakePlay ist entfernt, geschaltet wird per Tastatur.
- [x] AK10 – Das minimale HUD zeigt Watt, Kadenz, Puls und Gang. Ein Playwright-Test beweist laufende Werte und beide Schaltrichtungen im echten Browser.
- [x] AK11 – `GET /healthz` liefert `status`, `version` und `uptimeS` gemäß Zod-Schema. Ein Supertest-Test prüft die echte NestJS-App.
- [x] AK12 – `mise run build` baut Web und Server. `pnpm --filter @voltonaut/server deploy --prod ...` erzeugt ein eigenständiges Produktionsverzeichnis.
- [x] AK13 – `check.yml`, `mutation.yml`, `deploy-web.yml` und das deaktivierte `deploy-server.yml` entsprechen ADR-007 und ADR-009.
- [x] AK14 – `deploy/`: produktives Dockerfile für `apps/server` (gepinnte Node-Version, Standalone-Bundle via `pnpm deploy --prod`), Compose-Datei mit Traefik-Labels (Host-Rule `api.voltonaut.stammkneipe.dev`, Entrypoint `websecure`, Certresolver `letsencrypt`, Service-Port 3000, externes Netz `financensor_default`), Litestream-Sidecar (exakt gepinnt, teilt das SQLite-Volume) sowie Docker-Deploy-Skript mit `deploy`/`rollback`/`status`, aufgezeichnetem vorherigen Image-Tag, `docker compose pull`/`up -d` und Health-Verifikation `https://api.voltonaut.stammkneipe.dev/healthz` mit automatischem Rollback. Betriebshinweise in `deploy/README.md` (deutsch). Caddy-Template und systemd-Unit sind entfernt.
- [x] AK15 – CODEOWNERS, Branch-Ruleset, Spec-Vorgaben, Abhängigkeitsregister und die Asset-Lizenzdatei sind vorhanden.
- [x] AK16 – Aus einem frischen Clone sind `mise install && mise run install && mise run check` sowie `mise run check:mutation` grün.
- [x] AK17 – `opencode.jsonc` erzwingt ausschließlich den Provider `opencode-go`, auch für Agenten mit global abweichender Modellkonfiguration.

## Testplan (`docs/10-testing.md`)

| AK            | Ebene                               | Datei / Fixture                                                                                    |
| ------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| AK1–AK4, AK12 | Build und Tooling                   | `mise run install`, `mise run typecheck`, `mise run lint`, `mise run fmt:check`, `mise run build`  |
| AK5           | Import-Integration                  | `fixtures/depcruise/forbidden-cross-app.ts`, `scripts/test-depcruise.mjs`                          |
| AK6           | Guard-Negativtests                  | `scripts/guard.test.mjs`                                                                           |
| AK7, AK16     | Vollständiges Gate                  | `mise run check`, `mise run check:mutation`                                                        |
| AK8           | Unit und Contract                   | `packages/shared/src/*.test.ts`                                                                    |
| AK9           | Unit und Property                   | `packages/ble/src/sim/*.test.ts`                                                                   |
| AK10          | E2E                                 | `apps/web/e2e/sim.spec.ts`                                                                         |
| AK11          | Server-Integration und Schema       | `apps/server/src/health/health.e2e.test.ts`                                                        |
| AK13          | CI                                  | GitHub Actions der Pull Request                                                                    |
| AK14          | Statische Prüfung und lokaler Build | `deploy/README.md`, `mise run build`, `docker build -f deploy/Dockerfile` (falls Docker verfügbar) |
| AK15          | GitHub API und Guard                | Repository-Ruleset, `mise run guard`                                                               |
| AK17          | OpenCode-Laufzeit und Config        | `opencode debug config`, Subagent-Metadaten                                                        |

## Nicht-Ziele

- E0-opt: produktives VPS-Deploy. Host, DNS-A-Record (unproxied) und die CI-Deploy-Secrets (GitHub-Environment `production`) stehen; ausstehend ist allein Henrys Freigabe über `SERVER_DEPLOY_ENABLED=true`.
- Cloudflare-Produktions- oder Preview-Deploy ohne die beiden Cloudflare-Secrets.
- Echte BLE-Geräte, Engine-Physik, Authentifizierung, Datenbank und 3D-Welt.
- Änderungen an Golden-Dateien, Screenshot-Baselines oder BLE-Fixtures.

## Offene Fragen / Risiken

- DNS-A-Record (unproxied, 19.11.2026), Deploy-Secrets und `DEPLOY_USER` im GitHub-Environment `production` sind gesetzt; `SERVER_DEPLOY_ENABLED=false` hält `deploy-server.yml` inaktiv, bis Henry die Variable auf `true` setzt.
- Die verfügbaren Regelnamen der gepinnten Oxlint-Version und TypeScript-Decorator-Unterstützung sind geprüft und in `docs/open-questions.md` dokumentiert (T4, T7).
- Die CI braucht ein Playwright-Image, das zur exakt gepinnten Playwright-Version passt.

## Doku-Updates (Pflicht beim Abschluss)

- [ ] Roadmap-Checkboxen (beim Merge)
- [ ] `docs/open-questions.md` und betroffene Betriebsdoku
- [ ] `docs/dependencies.md`
- [ ] ADR-Nachtrag bei einer Abweichung von bestehenden Entscheidungen
