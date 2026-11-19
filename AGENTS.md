# AGENTS.md – Orientierung für Coding-Agenten

Du arbeitest an **Voltonaut**, einem browserbasierten 3D-Indoor-Cycling-Spiel (Zwift-Ersatz). Lies diese Datei zuerst, dann die für deine Aufgabe relevante Datei unter `docs/`.

## 1. Wo steht was
- Produktziel: `docs/00-vision.md`
- Architektur, Kerntypen, Datenfluss: `docs/01-architecture.md` ← **Pflichtlektüre**
- Bluetooth-Protokolle: `docs/02-bluetooth.md` (Abschnitte mit **UNVERIFIZIERT** sind Hypothesen)
- Physik & Gänge: `docs/03-engine-physics.md`
- 3D-Welt: `docs/04-world-3d.md`, Avatar: `docs/05-avatar-customization.md`
- Gamification & Volts-Ökonomie: `docs/06-gamification.md`
- Backend (Stack, API, Accounts, Anti-Cheat, Sync, Gruppenfahrten): `docs/08-backend.md`
- Was als Nächstes dran ist: `docs/07-roadmap.md` (Etappen mit Checkboxen)
- Warum etwas so ist: `docs/decisions/ADR-*.md`
- Ungeklärtes: `docs/open-questions.md`

## 2. Stack
Client: Vite + TypeScript (`strict: true`), three.js, Vitest, Playwright für Smoke-Tests im Sim-Modus; statisch auf GitHub Pages. Server (ab E5, `server/`): Node.js 22 + Fastify + TypeBox + `@fastify/websocket` + SQLite (Kysely) auf Henrys Hetzner-VPS – autoritativ für Accounts, Inventar, XP und Volts (ADR-004, ADR-005, `docs/08-backend.md`). E0–E4 und Solo/Gast/Sim-Modus laufen **immer ohne Server**. Zielbrowser: Chrome/Edge Desktop.

## 3. Modulgrenzen (hart)
```
src/
  devices/   Adapter pro Gerät → einheitliche DeviceEvents. Kennt kein three.js, keinen RideState.
  engine/    EINZIGER Besitzer von RideState. Physik, Gangmodell, Trainer-Kommandos.
  world/     3D-Strecke, Terrain, Höhenprofil (Route ist reine Daten + Mesh-Erzeugung).
  avatar/    Fahrer- und Radmodell, Customizing, Animation. Liest RideState.
  game/      XP, Level, Unlocks, Badges, Segmente, Persistenz. Liest RideState, besitzt Progression.
  ui/        HUD, Verbinden-Dialoge, Garage. Liest Snapshots, sendet Intents.
  sim/       Fake-Geräte für Entwicklung/Tests ohne Hardware.
  shared/    Reine Typen, Einheiten-Helfer, Event-Bus. Keine Abhängigkeiten nach außen.
  sync/      (ab E5) Besitzt lokalen Cache von /v1/me (Profil, Inventar, Progression, Volts) + Outbox für Fahrt-Uploads.
  net/       (ab E8) Live-Gruppenfahrt-Client: WebSocket, sendet eigene Distanz, besitzt RemoteRider-Snapshots.
server/      (ab E5) Fastify-Server (auth, accounts, inventory, economy, progression, rides, live, catalog). Importiert nur shared/.
```
Erlaubte Importe (Richtung →): `devices → shared`, `sim → devices, shared`, `engine → shared, world (nur Route-Daten)`, `avatar/world/game/ui → engine (nur lesend über RideSnapshot), shared`. **Verboten:** `devices` importiert `engine`; irgendein Modul außer `engine` schreibt `RideState`; `engine` importiert three.js. Durchgesetzt per ESLint `import/no-restricted-paths` (ab E0).

## 4. Goldene Regeln
1. **Ein Besitzer pro State.** `RideState` → engine. Verbindliche Progression, Inventar, Volts, RiderProfile → **Server**; Client-Spiegel → `sync/`; vorläufige Live-Belohnungen → game. `AvatarConfig` → avatar (gespeichert über sync). Geräteverbindungsstatus → devices. Andere lesen Snapshots oder senden Intents.
2. **Einheiten im Namen:** `powerW`, `cadenceRpm`, `speedMps`, `gradePct`, `distanceM`, `massKg`. Intern SI (m, s, kg, W); km/h nur in der UI.
3. **Bluetooth-Bytes nur in `devices/`.** Außerhalb existieren nur typisierte `DeviceEvent`s und `TrainerCommand`s.
4. **Unverifizierte Protokolldetails** werden im Code mit `// UNVERIFIED: siehe docs/02-bluetooth.md#…` markiert, bis sie an echter Hardware bestätigt und die Doku aktualisiert ist.
5. **Sim-Modus muss immer funktionieren.** Jede Funktion, die Hardware braucht, hat ein Fake-Gerät in `sim/`.
6. **Determinismus:** Engine-Tick ist eine reine Funktion `(state, inputs, dtS) → state`. Keine `Date.now()`-Aufrufe in der Physik; Zeit kommt als Parameter.
7. **Keine Assets ohne Lizenz.** Jede Datei unter `public/assets/` hat einen Eintrag in `public/assets/LICENSES.md` (Quelle, Autor, Lizenz).
8. **Belohnungen nie im Client festschreiben.** XP/Volts/Badges/PBs berechnet der Server aus Fahrt-Samples mit Code aus `shared/`; Client zeigt nur Vorschau.
9. Code, den Client und Server brauchen (Physik, Level-Tabelle, Badge-Prädikate, Katalog, API-Typen), gehört nach `shared/` – keine Duplikate.
10. Keine neuen Laufzeitabhängigkeiten ohne kurze Begründung im PR (Bundle-Größe zählt).

## 5. Lokal starten (ab E0)
```bash
npm install
npm run dev            # echte Geräte, http://localhost:5173 (localhost = secure context)
# Sim-Modus: http://localhost:5173/?sim=1   (Fake-Trainer, Fake-Puls, Fake-Controller per Tastatur ↑/↓)
npm run dev -- --host  # NICHT für Bluetooth geeignet (kein secure context über LAN-IP)
npm test               # Vitest
npm run test:e2e       # Playwright im Sim-Modus
npm run lint && npm run typecheck
npm run server:dev     # ab E5: lokaler API-/WS-Server (SQLite-Datei unter ./data), Client nutzt VITE_API_URL=http://localhost:8787
```
Sniffer/Debug-Seite: `/debug/ble.html` (siehe `docs/02-bluetooth.md` §5).

## 6. Definition of Done (pro PR)
- [ ] `npm run lint`, `npm run typecheck`, `npm test` grün; CI grün.
- [ ] Feature im Sim-Modus bedienbar und (wenn sinnvoll) per Playwright-Smoke-Test abgedeckt.
- [ ] Neue Logik in `engine/`, `game/`, `devices/*/parse*` hat Unit-Tests (Parser mit echten oder dokumentierten Byte-Beispielen).
- [ ] Modulgrenzen eingehalten (Lint-Regel), keine `any` ohne Kommentar.
- [ ] Relevante Doku aktualisiert (Roadmap-Checkbox abgehakt, Protokollwissen in `02-bluetooth.md`, neue Entscheidungen als ADR).
- [ ] Hardwareabhängiges als „getestet an echter Hardware: ja/nein" im PR vermerkt.

## 7. Tests – Erwartungen
- **Unit (Vitest):** Physik (bekannte Werte: z. B. 200 W, 0 %, 75 kg → ~ 33–35 km/h), Gangmodell, FTMS-Encoder/Decoder (Byte-genau), Zwift-Play-Decoder (`0x07`/`0x23`) gegen aufgezeichnete Fixtures aus `fixtures/ble/*.json`, XP/Level-Formeln, Segment-Erkennung.
- **Integration:** Engine + Sim-Geräte 60 s simuliert → plausible Distanz, keine NaN.
- **E2E (Playwright, Sim):** App lädt, Sim-Geräte verbinden, Fahrer bewegt sich, Schalten ändert Gang-Anzeige.
- Hardware-Tests sind manuell; Ergebnisse als Fixture (Sniffer-Export) einchecken.

## 8. Arbeitsweise
- Arbeite etappenweise nach `docs/07-roadmap.md`; kleine PRs, eine Checkbox-Gruppe pro PR.
- Commit-Stil: Conventional Commits (`feat(engine): …`, `fix(devices): …`, `docs: …`).
- Wenn eine Doku-Annahme falsch ist: Doku im selben PR korrigieren, nicht stillschweigend abweichen.
- Sprache: Doku Deutsch, Code/Identifier/Kommentare Englisch.
