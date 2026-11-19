# Voltonaut

Browserbasiertes Indoor-Cycling-Spiel in 3D – ein selbstgebauter Zwift-Ersatz. Läuft komplett im Browser (Chrome/Edge am Laptop), spricht per Web Bluetooth direkt mit Rollentrainer, Pulsgurt und Schalt-Controllern Web-App auf Cloudflare Pages, Solo-Fahrten funktionieren ohne Server; Accounts, Freischaltungen, Volts und Gruppenfahrten laufen über einen eigenen Server (TypeScript/NestJS auf einem Hetzner-VPS, ADR-004/005).

> **Status:** Planungsphase. Dieses Repo enthält bisher nur Dokumentation, noch keinen Anwendungscode. Start der Umsetzung mit Etappe E0 (siehe [docs/07-roadmap.md](docs/07-roadmap.md)).

## Vision in drei Sätzen
- Ein richtiges 3D-Spiel: animierter Fahrer, der im Takt der realen Trittfrequenz tritt, lebendige Welt mit Tageszeit und Wetter, Bots und Windschatten, Zuschauer, Effekte und Sound.
- Virtuelles Schalten passiert in **unserem** Code: Controller-Tasten → eigenes Gangmodell → Widerstand über den offenen FTMS-Standard an den Trainer.
- Gamification ab Tag eins: XP, Level, Freischaltbares (Trikots, Räder, Laufräder), Abzeichen, Segmente mit Bestzeiten. Währung **Volts** ⚡ (Blitze sammeln durch Leistung). Accounts, Inventar und Fortschritt liegen auf dem eigenen Server; gefahren werden kann immer auch offline/als Gast.

## Zielhardware (Referenz-Setup)
| Gerät | Anbindung | Status |
|---|---|---|
| Wahoo KICKR CORE mit Zwift Cog | BLE FTMS `0x1826` (Fallback: Cycling Power `0x1818`) | Standard, dokumentiert |
| Zwift Play Controller (links + rechts) | proprietärer Zwift-BLE-Service | **UNVERIFIZIERT**, wird am echten Gerät gemappt |
| Bluetooth-Pulsgurt | Heart Rate Service `0x180D` | Standard |

Browser: **Chrome oder Edge** auf dem Desktop/Laptop. Web Bluetooth braucht einen *secure context* (HTTPS oder `localhost`). Safari/iOS und Firefox werden nicht unterstützt.

## Schnellstart (Platzhalter – existiert ab E0)
Voraussetzung: [mise](https://mise.jdx.dev). Alle Werkzeugversionen sind in `mise.toml` gepinnt.
```bash
mise install && mise run install
mise run dev      # Web http://localhost:5173 (+ API http://localhost:3000)
# Simulationsmodus ohne Hardware: http://localhost:5173/?sim=1
mise run check    # Format, Oxlint (anti-slop), Typecheck, Modulgrenzen, Tests – muss grün sein
```

## Repo-Aufbau
pnpm-Monorepo: `apps/web` (Vite + three.js), `apps/server` (NestJS + SQLite/Drizzle), `packages/{shared,engine,rules,ble}`. Details in [AGENTS.md](AGENTS.md).

## Dokumentation
| Datei | Inhalt |
|---|---|
| [AGENTS.md](AGENTS.md) | Einstieg für Coding-Agenten: Regeln, Modulgrenzen, Definition of Done |
| [docs/00-vision.md](docs/00-vision.md) | Ziel, Nicht-Ziele, Nutzungsszenario |
| [docs/01-architecture.md](docs/01-architecture.md) | Module, Datenfluss, State-Ownership, Kerntypen |
| [docs/02-bluetooth.md](docs/02-bluetooth.md) | FTMS, HR, Zwift Play (Click/Ride am Rand), Reverse-Engineering-Plan, Sniffer-Seite |
| [docs/03-engine-physics.md](docs/03-engine-physics.md) | Physikmodell, virtuelle Gänge, Mapping auf FTMS |
| [docs/04-world-3d.md](docs/04-world-3d.md) | 3D-Spiel: PBR, Schatten, Tageszeit/Wetter, Bots, Windschatten, Kameras, Effekte, Audio, Assets, Budget |
| [docs/05-avatar-customization.md](docs/05-avatar-customization.md) | Fahrer- und Radmodell, Animation, Customizing |
| [docs/06-gamification.md](docs/06-gamification.md) | XP, Level, Unlocks, Badges, Segmente, Persistenz |
| [docs/07-roadmap.md](docs/07-roadmap.md) | Etappen E0–E7 mit Aufgaben und Abnahmekriterien |
| [docs/08-backend.md](docs/08-backend.md) | Backend: Stack, Accounts, API, Anti-Cheat, Sync, Gruppenfahrten |
| [docs/09-tooling.md](docs/09-tooling.md) | mise, Oxlint + anti-slop, strengstes TypeScript, dependency-cruiser, Oxfmt, CI |
| [docs/10-testing.md](docs/10-testing.md) | Verifikation: BLE-Replay, Golden, Property-based, Contract, E2E, Visual, Mutation, Perf |
| [docs/11-observability.md](docs/11-observability.md) | Metriken, Traces, Logs (OpenTelemetry, vorhandener Grafana-Stack, ADR-010) |
| [docs/decisions/](docs/decisions/) | Architekturentscheidungen (ADRs) |
| [docs/open-questions.md](docs/open-questions.md) | Offene Fragen und Risiken |

## Lizenz
Code: [MIT](LICENSE) © 2026 Henry Sachs. Eingebundene 3D-Assets behalten ihre eigene Lizenz (siehe `public/assets/LICENSES.md` und `docs/04-world-3d.md`).

## Haftungsausschluss
Unabhängiges Hobbyprojekt, nicht mit Zwift, Inc. oder Wahoo Fitness verbunden. „Zwift", „Zwift Click", „Zwift Play", „Zwift Cog" und „KICKR" sind Marken ihrer jeweiligen Inhaber.
