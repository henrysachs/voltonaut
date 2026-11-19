# Voltonaut

Browserbasiertes Indoor-Cycling-Spiel in 3D – ein selbstgebauter Zwift-Ersatz. Läuft komplett im Browser (Chrome/Edge am Laptop), spricht per Web Bluetooth direkt mit Rollentrainer, Pulsgurt und Schalt-Controllern Solo-Fahrten funktionieren ohne Server; Accounts, Freischaltungen, Volts und Gruppenfahrten laufen über einen eigenen Server (Node.js/Fastify auf einem Hetzner-VPS, ADR-004/005).

> **Status:** Planungsphase. Dieses Repo enthält bisher nur Dokumentation, noch keinen Anwendungscode. Start der Umsetzung mit Etappe E0 (siehe [docs/07-roadmap.md](docs/07-roadmap.md)).

## Vision in drei Sätzen
- Ein echter, animierter 3D-Fahrer auf einem echten Rad fährt durch eine gebaute Fantasiewelt; die Beine treten im Takt der realen Trittfrequenz.
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
```bash
npm install
npm run dev          # http://localhost:5173, echte Geräte
npm run dev -- --mode sim   # Simulationsmodus mit Fake-Geräten (oder ?sim=1 in der URL)
npm test
npm run build        # statischer Build für GitHub Pages
```

## Dokumentation
| Datei | Inhalt |
|---|---|
| [AGENTS.md](AGENTS.md) | Einstieg für Coding-Agenten: Regeln, Modulgrenzen, Definition of Done |
| [docs/00-vision.md](docs/00-vision.md) | Ziel, Nicht-Ziele, Nutzungsszenario |
| [docs/01-architecture.md](docs/01-architecture.md) | Module, Datenfluss, State-Ownership, Kerntypen |
| [docs/02-bluetooth.md](docs/02-bluetooth.md) | FTMS, HR, Zwift Play (Click/Ride am Rand), Reverse-Engineering-Plan, Sniffer-Seite |
| [docs/03-engine-physics.md](docs/03-engine-physics.md) | Physikmodell, virtuelle Gänge, Mapping auf FTMS |
| [docs/04-world-3d.md](docs/04-world-3d.md) | three.js-Szene, Strecke, Terrain, Kamera, Performance, Assets |
| [docs/05-avatar-customization.md](docs/05-avatar-customization.md) | Fahrer- und Radmodell, Animation, Customizing |
| [docs/06-gamification.md](docs/06-gamification.md) | XP, Level, Unlocks, Badges, Segmente, Persistenz |
| [docs/07-roadmap.md](docs/07-roadmap.md) | Etappen E0–E7 mit Aufgaben und Abnahmekriterien |
| [docs/08-backend.md](docs/08-backend.md) | Backend: Stack, Accounts, API, Anti-Cheat, Sync, Gruppenfahrten |
| [docs/decisions/](docs/decisions/) | Architekturentscheidungen (ADRs) |
| [docs/open-questions.md](docs/open-questions.md) | Offene Fragen und Risiken |

## Lizenz
Code: [MIT](LICENSE) © 2026 Henry Sachs. Eingebundene 3D-Assets behalten ihre eigene Lizenz (siehe `public/assets/LICENSES.md` und `docs/04-world-3d.md`).

## Haftungsausschluss
Unabhängiges Hobbyprojekt, nicht mit Zwift, Inc. oder Wahoo Fitness verbunden. „Zwift", „Zwift Click", „Zwift Play", „Zwift Cog" und „KICKR" sind Marken ihrer jeweiligen Inhaber.
