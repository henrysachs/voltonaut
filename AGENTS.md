# AGENTS.md – Orientierung für Coding-Agenten

Du arbeitest an **Voltonaut**, einem browserbasierten 3D-Indoor-Cycling-Spiel (Zwift-Ersatz) mit eigenem Backend. Dieses Repo ist ein **enges Konstrukt**: Leitplanken werden maschinell durchgesetzt. Lies diese Datei zuerst, dann die für deine Aufgabe relevanten Dateien unter `docs/`.

## 0. Die drei harten Regeln
1. **Vor dem Abschluss jeder Aufgabe: `mise run check` muss grün sein** (Format, Oxlint + anti-slop, Typecheck, dependency-cruiser, guard, Tests). Ändert dein PR `packages/engine` oder `packages/rules`: zusätzlich `mise run check:mutation`. Rot = nicht fertig.
2. **Leitplanken nie lockern:** keine Änderung an `oxlint.config.ts`, `tools/oxlint/**` (anti-slop), `tsconfig*.json`, `.dependency-cruiser.cjs`, `.oxfmtrc.json`, `mise.toml`, `scripts/guard.mjs`, `.github/**`, Golden-Dateien, Screenshot-Baselines oder BLE-Fixtures, um Fehler „wegzumachen". Kein Deaktivieren/Abschwächen einer Regel (auch keiner anti-slop-Regel), keine `@ts-ignore`/`@ts-nocheck`, kein `oxlint-disable` ohne Begründung. Änderungen an Leitplanken nur mit ADR + Henrys Freigabe (CODEOWNERS).
3. **Keine neue Abhängigkeit ohne ADR** (und Eintrag in `docs/dependencies.md`).

## 1. Wo steht was
| Thema | Datei |
|---|---|
| Ziel, Nicht-Ziele | `docs/00-vision.md` |
| Architektur, Kerntypen, Ownership ← **Pflichtlektüre** | `docs/01-architecture.md` |
| Bluetooth (FTMS, HR, Zwift Play; ⚠️ = unverifiziert) | `docs/02-bluetooth.md` |
| Physik, Gänge, Rider-Profil, Windschatten | `docs/03-engine-physics.md` |
| 3D-Spiel: Welt, Licht, Wetter, Bots, Kameras, Effekte, Audio, Assets, Budget | `docs/04-world-3d.md` |
| Avatar & Customizing | `docs/05-avatar-customization.md` |
| Gamification & Volts ⚡ | `docs/06-gamification.md` |
| Etappen mit Abnahmekriterien | `docs/07-roadmap.md` |
| Backend (NestJS, Drizzle, API, Anti-Cheat, Deploy) | `docs/08-backend.md` |
| Tooling & Leitplanken (mise, Oxlint/anti-slop, TS, depcruise, CI) | `docs/09-tooling.md` |
| Verifikation (Replay, Golden, Property, E2E, Visual, Mutation, Perf) | `docs/10-testing.md` |
| Entscheidungen | `docs/decisions/ADR-*.md` |
| Offenes | `docs/open-questions.md` |
| Aufgaben-Specs, Vorlage, Review-Checkliste | `docs/specs/` |
| Abhängigkeits-Register | `docs/dependencies.md` |

## 2. Repo-Layout (pnpm workspaces, ADR-006)
```
apps/web        @voltonaut/web     Vite + three.js Client: world/ avatar/ game/ ui/ sync/ net/ main.ts, debug/ble.html
apps/server     @voltonaut/server  NestJS: health, database, auth, accounts, inventory, economy, progression, rides, live, catalog
packages/shared @voltonaut/shared  Typen, Einheiten, Zod-Schemas (API/WS/Upload) – kein DOM, kein Node
packages/engine @voltonaut/engine  Physik, Gänge, RideState + tick, Bots, Drafting, Trainer-Mapping – kein DOM, kein Node, kein three
packages/rules  @voltonaut/rules   XP/Level, Volts-Formel, Badges, Katalog – kein DOM, kein Node
packages/ble    @voltonaut/ble     Web-Bluetooth-Adapter, Byte-Parser, Sim-Geräte, ReplayTransport – kein Node, kein engine
tools/oxlint/anti-slop/            vendorte Lint-Regeln (nicht anfassen)
fixtures/{ble,rides,api}/          Testdaten (geschützt)
```
Durchgesetzt von **dependency-cruiser** (`docs/09-tooling.md` §6): Apps importieren sich nicht; Pakete nie aus Apps; mutierbarer `RideState` nur in `packages/engine/src/internal/**`; `three` nur in `apps/web/src/{world,avatar}` und `ui/garage`; keine Zyklen. **Modulübergreifende PRs sind erlaubt** – Grenzen sichert depcruise, nicht der PR-Zuschnitt.

## 3. Architekturregeln
1. **Ein Besitzer pro State.** `RideState` → engine (nur über `tick`/Intents). Verbindliche Progression, Inventar, Volts, RiderProfile → Server; Client-Spiegel → `sync/`; vorläufige Live-Belohnungen → `game/`; `RemoteRider[]` → `net/`. Render-Systeme lesen nur Snapshots (ADR-008).
2. **Einheiten im Namen** (`powerW`, `cadenceRpm`, `speedMps`, `gradePct`, `distanceM`, `massKg`); intern SI.
3. **Bytes und Rohdaten nur an Grenzen:** BLE-Bytes nur in `packages/ble`, HTTP/WS-Payloads nur via Zod-Schemas aus `packages/shared`. Danach nur konkrete Typen (anti-slop erzwingt das: kein `unknown`/`Record<string, unknown>` in Verträgen, `as` nur mit `// SAFETY:`).
4. **Determinismus:** Engine-Tick `(state, inputs, dtS) → state`, Zufall nur über Seed, keine `Date.now()` in Engine/Rules.
5. **Belohnungen berechnet der Server** mit denselben Paketen (`engine`, `rules`); der Client zeigt Vorschau.
6. **Sim-Modus muss immer funktionieren**; jede Hardware-Funktion hat ein Sim-Gerät. Tests nutzen Sim-/Replay-Geräte oder DI-Fakes – **kein `vi.mock`** (anti-slop `no-module-mocking`).
7. **UNVERIFIZIERTE Protokolldetails** im Code mit `// UNVERIFIED: docs/02-bluetooth.md#…` markieren, bis eine Hardware-Fixture sie bestätigt.
8. **Assets nur mit Lizenz** (`apps/web/public/assets/LICENSES.md`), über `mise run assets` (glTF + KTX2 + meshopt).
9. **Trainersteuerung ist eine physische Wirkung.** Verbindung und Messwertempfang lösen keine Widerstandsbefehle aus. Erst ausdrückliche Aktivierung, geprüfte Fähigkeiten und bestätigte Control-Point-Prozeduren erlauben begrenzte Kommandos. Bei Timeout, Berechtigungsverlust oder Disconnect keine alten Ziele blind wiederholen. Einen unbestätigten neutralen Zustand nicht als sicheren Stopp ausgeben.

## 4. Befehle (alle über mise)
```bash
mise install            # gepinnte Node/pnpm-Versionen
mise run install        # pnpm install --frozen-lockfile
mise run dev            # Web (http://localhost:5173) + Server (http://localhost:3000)
#   Sim-Modus: http://localhost:5173/?sim=1   (Fake-Trainer/HR/Play; Tastatur ↑/↓ schaltet)
#   Web Bluetooth nur über localhost/HTTPS – nicht über LAN-IP
mise run fix            # oxlint --fix → oxfmt → oxlint
mise run check          # DAS Gate (lokal = CI)
mise run check:mutation # Stryker auf engine/rules
mise run test:e2e       # Playwright im Sim-Modus (Teil von check)
mise run perf           # manueller fps-Report auf echter Hardware
mise run assets         # Asset-Pipeline
```

## 5. Arbeitsablauf pro Aufgabe
1. **Spec anlegen/lesen:** `docs/specs/<Etappe>-<nr>-<slug>.md` aus `_template.md`, Abnahmekriterien aus `docs/07-roadmap.md` übernehmen und präzisieren, Testplan nach `docs/10-testing.md`.
2. Umsetzen – Tests zuerst für Parser/Physik/Regeln (Fixtures, Golden, Properties).
3. `mise run check` grün (+ Mutation falls betroffen).
4. PR mit: Spec-Link, abgehakte Kriterien, „an echter Hardware getestet: ja/nein", Doku-Updates (Roadmap-Checkbox, `02-bluetooth.md`-Befunde, ADRs).
5. **Ein zweiter Agent reviewt** gegen Spec + `docs/specs/_review-checklist.md`. Merge nur nach Review, grünem CI und – bei geschützten Dateien – Henrys Freigabe.

## 6. Definition of Done
- [ ] `mise run check` grün; CI grün (inkl. `mutation`, falls Kernpfade geändert).
- [ ] Alle Abnahmekriterien der Spec erfüllt und durch Tests belegt.
- [ ] Im Sim-Modus bedienbar; E2E/visuelle Tests ergänzt, wenn UI/3D betroffen.
- [ ] Coverage-Schwellen der Kernpakete gehalten (`docs/10-testing.md` §9).
- [ ] Keine gelockerten Regeln, keine neuen Abhängigkeiten ohne ADR.
- [ ] Doku aktuell; Review durch zweiten Agenten bestanden.

## 7. Hosting & Deploy
Web: Cloudflare Pages (`wrangler pages deploy` aus CI nach grünem `check`, Preview pro PR). API: Hetzner-VPS als Docker-Compose-Projekt hinter dem vorhandenen Traefik (ADR-004/ADR-009), Deploy aktiv, sobald `vars.SERVER_DEPLOY_ENABLED=true` gesetzt ist. Henry hat am 2026-11-19 Serverwartung und die Verwaltung dedizierter Deploy-Secrets für Agenten freigegeben. Agenten dürfen den Server nach einem read-only Befund warten und ausschließlich dafür erzeugte Deploy-Zugänge über die GitHub CLI hinterlegen. Private Schlüssel nie ausgeben oder committen. CI nutzt nur einen eingeschränkten Deploy-User und das Environment `production` mit manueller Freigabe. Produktive Deploys und das Löschen bestehender Serverdaten brauchen weiterhin eine gesonderte Freigabe.

## 8. Sprache & Stil
Doku Deutsch; Code, Identifier, Kommentare, Commits Englisch (Conventional Commits: `feat(engine): …`). Formatierung macht Oxfmt – nicht manuell diskutieren. Henry hat am 2026-11-24 alle Provider wieder freigegeben. `opencode.jsonc` beschränkt die Providerwahl nicht. Standard für Implementierung und Agenten ist seit dem 2026-11-25 `kiro/claude-opus-5-5`, weil das Monatskontingent für `github-copilot/gpt-6.1-sol` erschöpft ist.

## 9. Fahrbereitschaft und Bedienung
- **Bei einem angekündigten Fahrttermin zuerst den durchgängigen Fahrbetrieb liefern.** Trainerdaten, beide Griffe, tatsächliche Widerstandsänderung, Reconnect und bedienbare Oberfläche haben Vorrang vor zusätzlicher Aufnahme-/Strava-Infrastruktur. Andere beauftragte Arbeiten weiterführen, aber nicht anstelle des kritischen Fahrpfads.
- **HUD-Schalten ist noch keine Rollenschaltung.** Der Nachweis muss vom Druck am Griff über die echte Engine bis zum passenden FTMS-Kommando und seiner Bestätigung reichen. Erst eine gemeinsame reale Probefahrt bestätigt Widerstandsgefühl und Hardwarezuverlässigkeit. Ohne diesen Test ausdrücklich „softwaregeprüft, Hardwareabnahme offen“ sagen.
- In Specs und Statusmeldungen vier Dinge trennen: **implementiert**, **am tatsächlichen Artefakt softwaregeprüft**, **an echter Hardware geprüft**, **bereitgestellt**. Testzahlen, Sim-/Replay-Läufe, Prototypen oder ein grüner Build ersetzen keinen fehlenden Nachweis. Replay-Konsistenz ist kein Hardwareattest.
- Welt und HUD sind die Spieloberfläche. Geräte, Trainersteuerung, Profil, Aufnahmen und Strava gehören in ein zugängliches **Ingame-Menü mit Overlays**, nicht dauerhaft untereinander auf eine lange Scrollseite. Fahrt und Geräte laufen beim Öffnen eines Menüs weiter. Native Geräteauswahl bleibt unmittelbar an einen Nutzerklick gebunden.
- Vor der ersten stabilen Veröffentlichung keine künstlichen parallelen V1/V2-Subsysteme oder Weiterleitungsfassaden bauen. Verträge und alle Aufrufer gemeinsam umstellen. Bestehende eigene Aufnahmen und Zuordnungen dabei nicht stillschweigend löschen oder als nachgerechnet ausgeben.

## 10. Arbeitsstand, Freigaben und Nachweise
- Vor einer Zusage den tatsächlichen Branch, Worktree und laufenden Prozess prüfen. Ein Merge auf `main` aktualisiert keinen Dev-Server in einem anderen Worktree. Bei lokaler Bereitstellung Commit, URL und echten Geräte- oder Sim-Modus nennen.
- Henry verlangt seit dem 23.11.2026 dauerhaft aktive Main-Deploys. `SERVER_DEPLOY_ENABLED=true` und automatische Pages-Produktionsdeploys nach einem Einzeldeploy nicht zurücksetzen. Beauftragte Funktionen nach grünen Prüfungen und unabhängigem Review mergen und aktivieren, nicht auf den Trainer warten. Menschliche Produktionsfreigabe, persönliche Anbieterzustimmung und Hardwareabnahme bleiben getrennt erforderlich.
- Isolierte Entwicklung, Rendererarbeit und Tests können ohne Neuladen fremder Tabs erfolgen. Für möglicherweise verlorene Mitschnitte den Umfang einmal klären. Ist das Neuladen im laufenden Auftrag freigegeben, nicht nach jeder Zwischenmeldung erneut fragen. Die Freigabe nicht auf Datenlöschung oder Produktionsdeploys ausweiten.
- Bekannte Protokollfakten und vorhandene Hardware-Captures zuerst auswerten. Keine erneute Tastenvermessung verlangen, wenn die notwendige Zuordnung bereits belegt ist. Firmware- und Kalibrierungslücken getrennt benennen.
- Eine Lastkorrektur braucht einen tatsächlich passenden roten Lauf und denselben geprüften Erfolgsfall. Keine Timeouts, Assertions, Sim-Uhr, Datenfrische oder Grafikqualität zum Bestehen verbiegen. Ressourcenbegrenzung als Mitigation benennen, solange keine App-Ursache und Korrektur bewiesen sind. Schwarze Bilder und andere Fehlversuche erhalten, nicht als Weltbeleg verkaufen.
- In GitHub auch **Rulesets** prüfen, nicht nur klassische Branch-Protection. Agentenreview und formale GitHub-Approval sind verschiedene Nachweise. Ein Owner-Merge benötigt ausdrückliche Freigabe und weiterhin grüne Checks des exakten Heads sowie unabhängiges Review. Keine Schutzregel dafür ändern.
- Bei Unterbrechung einen knappen Handoff mit Worktree, Commit, geänderten Dateien, tatsächlichen Prüfungen, offenen Fehlern und eigenen Prozessen hinterlassen. Unfertige WIP-Zweige nicht in den Fahrstand mischen.
