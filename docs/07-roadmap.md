# 07 – Roadmap (Etappen)

Jede Etappe endet mit einem lauffähigen Stand (Web auf Cloudflare Pages, Server lokal/CI und – sobald freigeschaltet – auf dem VPS) und grünem `mise run check`. Hardware-Risiken (E1/E2) werden früh geklärt. **E0–E4 brauchen kein Login** (Solo, Sim, lokales Profil); Accounts kommen in E5, bevor Ökonomie (E6) und Garage/Shop (E7) darauf aufbauen. Solo/Gast/Sim bleiben immer ohne Server lauffähig.

**Spiel-Ambition:** Voltonaut wird ein vollwertiges 3D-Spiel (PBR, Schatten, Tageszeit/Wetter, Bots mit Windschatten, Zuschauer, Effekte, Sound, Cinematic-Kameras – `04-world-3d.md`). Das MVP (E6) ist bewusst schlanker; E4 legt aber schon die Spiel-Architektur (System-Scheduler, Asset-Pipeline, Budgets, visuelle Tests), damit E8/E10 nur noch Inhalte und Systeme ergänzen.

Jede Aufgabe = Spec in `docs/specs/` mit diesen Abnahmekriterien; Review durch zweiten Agenten (`10-testing.md` §10). Checkboxen beim Erledigen abhaken.

---

## E0 – Fundament: Monorepo, Leitplanken, Sim-Modus, CI, Server-Gerüst, Deploy

**Ziel:** Leeres, aber vollständig verdrahtetes und abgesichertes System. Jeder Agent kann `mise install && mise run check` ausführen; Web läuft auf Cloudflare Pages (sobald Secrets da sind), Server läuft lokal und in CI.

- [x] pnpm-Workspace: `apps/web`, `apps/server`, `packages/{shared,engine,rules,ble}` (ADR-006), `workspace:*`, `save-exact`
- [x] `mise.toml`: Node + pnpm exakt gepinnt; Tasks `install, dev, dev:web, dev:server, fmt, fmt:check, lint, fix, typecheck, depcruise, guard, test, test:e2e, check, check:mutation, build, assets, perf, golden:update, visual:update`
- [x] `tsconfig.base.json` strengstens + Project References; `lib` ohne DOM/Node in shared/engine/rules
- [x] Oxlint: `oxlint.config.ts` mit vendortem **anti-slop** (`tools/oxlint/anti-slop/`, `UPSTREAM.md`), `oxlint` + `@oxlint/plugins` exakt gleiche Version, `oxlint-tsgolint`, Warnungen = Fehler
- [x] Oxfmt (exakt gepinnt) + Ignore-Liste
- [x] `.dependency-cruiser.cjs` mit allen Regeln aus `09-tooling.md` §6, inkl. Negativtest (ein absichtlich verbotener Import in einer Test-Fixture schlägt fehl)
- [x] `scripts/guard.mjs` (Escape-Hatches, gelockerte Configs, geschützte Dateien ohne ADR/Label, Deps ohne `docs/dependencies.md`)
- [x] Vitest-Workspace inkl. Coverage-Schwellen, fast-check, Stryker-Config (engine/rules), Playwright (Chromium, Sim-Modus, Screenshot-Setup im Playwright-Docker-Image)
- [x] `packages/shared`: Typen aus `01-architecture.md`, Zod-Basis, Event-Bus-Typen
- [x] `packages/ble/sim`: FakeTrainer (Watt/Kadenz per Slider/Skript), FakeHeartRate, FakePlay + Keyboard (↑/↓); `?sim=1` im Composition Root; Test-Uhr
- [x] `apps/web`: Minimal-HUD (Watt, Kadenz, Puls, Gang) mit Sim-Werten; erster E2E-Test
- [x] `apps/server`: NestJS-App mit `HealthModule` (`GET /healthz` → Version, Uptime), Vitest + `unplugin-swc`, Supertest-Test
- [x] CI: `check.yml` (nur `mise run check`), `mutation.yml` (Pfadfilter + nightly), `deploy-web.yml` (Cloudflare Pages via `wrangler pages deploy`, Preview pro PR; übersprungen bis `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` gesetzt), `deploy-server.yml` (vorhanden, deaktiviert)
- [x] Server-Gerüst läuft lokal (`mise run dev:server`) und in CI (Health-Test, Image-Build); Dockerfile, Compose-Datei mit Traefik-Labels und Litestream-Sidecar sowie Deploy-Skript liegen dokumentiert im Repo (`deploy/`)
- [x] _(Nach Henrys Produktionsfreigabe)_ **E0-opt – VPS-Deploy:** [E0-04](specs/E0-04-production-rollout.md) belegt den CI-Release `916edbb` mit eigenem Compose-Projekt im vorhandenen Traefik-Netz. `https://api.voltonaut.stammkneipe.dev/healthz` antwortet mit 200 und gültigem TLS. Privates OIDC, UID-1000-SQLite, Persistenz und CORS sind geprüft. Seit Henrys Auftrag vom 23.11.2026 bleiben Main-Deploys dauerhaft aktiviert. GitHub-Environment `production` behält seine manuelle Freigabe. Auf Henrys ausdrücklichen Wunsch ohne Backup; Anbieter-/Hardwarepiloten bleiben getrennte Abnahmen.
- [ ] _(Teil von E0-opt, nicht von E0 – E0 selbst bleibt unverändert)_ **Observability-Grund verdrahten** (ADR-010, `11-observability.md`): strukturierte JSON-Logs (pino) nach stdout mit `trace_id`/`span_id`; OTel-Traces per OTLP an Alloy/Tempo; `/metrics` (OTel Prometheus Exporter) nur intern im Docker-Netz, nicht über Traefik; No-Op in Dev/Tests. OTLP-Endpunkte und Observability-Netzname beim Deploy aus der Financensor-Compose eintragen (**TODO**). Grafana-Dashboards und Alarme unter `ops/grafana/` sind spätere Liefergegenstände nach dem ersten Deploy.
- [x] `CODEOWNERS`, Branch-Ruleset für `main` (`09-tooling.md` §8), `docs/specs/_template.md`, `docs/specs/_review-checklist.md`, `docs/dependencies.md`, `apps/web/public/assets/LICENSES.md`
      **Abnahme:** Frischer Clone: `mise install && mise run install && mise run check` grün; `?sim=1` zeigt laufende Werte, Pfeiltasten ändern den Gang; PR mit absichtlich verbotenem Import, `@ts-ignore` oder gelockerter Regel wird von CI abgelehnt; nach Setzen der Cloudflare-Secrets ist `https://voltonaut.stammkneipe.dev` (bzw. `https://voltonaut.pages.dev`) erreichbar und jeder PR bekommt eine Preview-URL; Server-Health-Test grün in CI.

Korrektur vom 20.11.2026: Die beiden E0-opt-Punkte waren versehentlich abgehakt. `SERVER_DEPLOY_ENABLED=false`; Observability ist noch nicht verdrahtet. Die Korrektur dokumentiert offene Arbeit, keine neue Lieferung.

Freigabe vom 21.11.2026: Henry beauftragt Web- und API-Produktionsdeploy sowie eine einmalige sichere OIDC-Provisionierung. Der Betrieb erfolgt ausdrücklich ohne Backup nach [ADR-020](decisions/ADR-020-explicit-production-provisioning.md). [E0-04](specs/E0-04-production-rollout.md) trennt Vorbereitung von tatsächlicher Bereitstellung. Die VPS-Checkbox bleibt bis zum öffentlichen API-Nachweis offen.

Erster Web-Deploy am 20.11.2026: [Sim-Fahrt](https://voltonaut.pages.dev/?sim=1) und [Sniffer](https://voltonaut.pages.dev/debug/ble.html) sind auf dem geprüften `main` veröffentlicht. Die eigene Domain ist eingerichtet. API und automatische Deploys bleiben aus. Nachweise und Grenzen stehen in [E0-02](specs/E0-02-first-web-deploy.md).

## E1 – Bluetooth-Sniffer, Puls, FTMS lesen

**Ziel:** Echte Geräte sehen und verstehen. Grundlage fürs Reverse Engineering.

- [ ] `apps/web/debug/ble.html` nach Spezifikation `02-bluetooth.md` §5 (Scan, GATT-Explorer, Logger, Marker, Presets, Export)
- [ ] `packages/ble/hrs`: Parser `0x2A37` + Adapter; **ReplayTransport** + Replay-Tests aus Fixtures (`10-testing.md` §2)
- [ ] `packages/ble/ftms`: Parser `0x2AD2` (Flags inkl. invertiertem Bit 0, uint24, Kadenz ×0,5), Feature-Lesen `0x2ACC`
- [ ] `packages/ble/cps`: Fallback-Parser `0x2A63` (nur lesen)
- [ ] Verbinden-Dialog im Spiel, Statusanzeige pro Gerät, Reconnect bei Abbruch (Backoff 1/2/5 s)
- [ ] **Hardware-Session mit Henry:** GATT-Exporte Trainer, Pulsgurt, beide Play-Griffe → `fixtures/ble/` (Firmware-Versionen notieren)
      **Abnahme:** Echter Puls und echte Watt/Kadenz im HUD; Sniffer-Exporte aller drei Geräte eingecheckt; `02-bluetooth.md` mit Befunden aktualisiert.

## E2 – Play-Controller-Mapping, virtuelles Schalten, FTMS-Steuerung

**Ziel:** Schalten mit den Zwift-Play-Griffen (LS = runter, RS = hoch) verändert den Widerstand spürbar.

Teilschritt [E2-02](specs/E2-02-verified-play-input.md) verbindet beide hardwarebelegten `0x07`-Griffe mit den virtuellen Gängen und ergänzt den Decoder im BLE-Labor. Klartextantwort, digitale Zuordnung und Flankenerkennung sind durch Capture und Softwaretests belegt. Firmware, reale Parallelverbindungen und Trainersteuerung bleiben offen. Die umfassenderen Checkboxen unten bleiben deshalb offen.

Teilschritt [E2-03](specs/E2-03-ftms-virtual-shifting.md) verbindet die vorhandenen Strategy-A-Worker-Kommandos nach ausdrücklicher Freigabe mit serialisierten FTMS-Verfahren und ACKs. Native Browser-Fakes prüfen Play → Engine → reale Adapter-/Transportlogik; sie sind keine Hardwareabnahme. Kalibrierung, physisches Gefühl, Funkbetrieb und Latenzziel bleiben offen; deshalb keine vollständige E2-Checkbox vorzeitig abhaken.

- [ ] Play-Firmware feststellen (1.x: 2 Verbindungen, `0x07` / 2.0.1: 1 Verbindung, vermutlich `0x23`)
- [ ] Klartext-Handshake („RideOn") + eigener Mini-Protobuf-Decoder für `0x07`, Bitmap-Decoder `0x23` – beide gegen Sniffer-Fixtures; ButtonMap-JSON
- [ ] Bei FW 1.x: zwei Griffe parallel verbinden und zuordnen (Device-Typ 2/3), getrennter Reconnect
- [ ] Entprellung/Dedupe, Flankenerkennung, optional Auto-Repeat bei Halten
- [ ] Haptik-Feedback beim Schalten (`0x12…`-Kommando), abschaltbar
- [ ] Fallback: verschlüsselter Handshake nur falls Klartext scheitert (separates Ticket, AES-CCM-Lib nötig)
- [ ] `packages/engine/gears`: 24-Gang-Preset, Shift-Intents, Anzeige im HUD
- [ ] `packages/ble/ftms` Control Point: Write-Queue, Indications, Request Control, Start, `0x11`-Encoder (geclampt), Fehler-/Permission-Lost-Handling
- [ ] Trainer-Strategie A (Effective Grade) + B (Virtual-Power ERG) hinter Schalter
- [ ] Kalibrier-Assistent: physische Übersetzung + Trainer-Masse (siehe `03` §3–4)
- [ ] Testfahrt-Protokoll mit Henry: 3 Gänge × 3 Steigungen, subjektives Gefühl + Logs
      **Abnahme:** Schalten an beiden Griffen funktioniert zuverlässig (100 Drücke, 0 verloren, 0 doppelt); Widerstandsänderung < 300 ms spürbar; ADR zur gewählten Strategie ergänzt.

## E3 – Engine-Physik

**Ziel:** Realistisches virtuelles Tempo auf einem Höhenprofil.

- [ ] `packages/engine/physics` nach `03` §2, deterministischer Tick; Golden-Fahrten + fast-check-Properties; Mutation-Score ≥ 80 %
- [ ] `ElevationProfile` mit `elevationAt`/`gradeAt(smoothing)`; Test-Route als reine Daten
- [ ] RideState-Summen (Distanz, Hm, kJ, Zeit), Auto-Pause, Datenausfall-Verhalten
- [ ] Engine → Trainer: Grade aus Route + Gang, Rate-Limit 4 Hz
- [ ] Rider-Profil-Screen (`03` §2a: Gewicht, Größe, Rad, Kettenblatt/Cog, Gang-Preset; später FTP) – in E3 lokal gespeichert, ab E5 mit Account synchronisiert
      **Abnahme:** 60-min-Sim-Fahrt mit festem Watt-Profil liefert erwartete Distanz ± 2 %; auf echter Rolle fühlt sich der Test-Anstieg wie Anstieg an.

## E4 – Erste 3D-Welt: Spiel-Fundament

**Ziel:** Das „Zwift-Gefühl" – und die Architektur für ein großes Spiel.

Teilschritt [E4-02](specs/E4-02-first-ride-scene.md) ergänzt eine erste fahrbare Szene auf der vorhandenen E3-Testroute. Die vollständigen E4-Kriterien bleiben offen.

Teilschritt [E4-03](specs/E4-03-lake-forest-world.md) ergänzt begrenztes Relief, einen See mit Ufer, instanzierten Wald und Kilometermarken auf derselben 10-km-Testrunde. Terrain-Streaming, LOD, neue Routendaten, Asset-Pipeline und die Hardware-Abnahme bleiben offen.

Die softwaregeprüften Teilschritte [E4-04](specs/E4-04-render-worker-isolation.md) und [E4-05](specs/E4-05-ingame-menu.md) trennen native Renderwartezeiten vom Fahrbetrieb und halten Welt und HUD neben einem Ingame-Menü sichtbar. Geräte, Profil, Aufnahmen und Konto bleiben bedienbar, ohne die Fahrt zu pausieren. Die gemeinsame Kombination mit FTMS-Steuerung ist softwaregeprüft; reale Hardware-FPS und die gemeinsame Probefahrt bleiben offen. Das vollständige Spiel-HUD ist damit nicht abgenommen.

- [ ] `RenderSystem`-Scheduler (ADR-008), Qualitätsstufen Low–Ultra, dynamische Auflösung, Debug-Overlay (`renderer.info`, fps)
- [ ] PBR-Rendering, HDRI-Umgebung (PMREM), Sonnenlicht mit **Cascaded Shadow Maps**, Kontaktschatten
- [ ] „Voltonaut Loop" (~12 km: See, Wald, KOM, Sprint) als Route-Daten; Straßen-Mesh mit Markierungen/Randsteinen; Terrain-Chunks mit LOD + Geomorphing; Splat-Texturen
- [ ] Vegetation per Instancing + Impostoren, Poisson-Scatter per Seed
- [ ] Asset-Pipeline `mise run assets` (glTF → meshopt + KTX2), Asset-Budget-Check im `check`
- [ ] Rad + Fahrer (CC0-Basis/Blender), Kurbel synchron zur Kadenz, Beine per IK, Laufräder nach Tempo
- [ ] Kameras: Verfolger, Nah, Helikopter, Ego; Speed-FOV
- [ ] Spiel-HUD (`04` §9) inkl. Mini-Höhenprofil und Mini-Map
- [ ] Visuelle Regressionstests (deterministische Szene) + Performance-Budget-Szene (`10-testing.md` §7–8)
      **Abnahme:** ≥ 60 fps p50 auf Henrys Laptop (High oder Medium, `mise run perf`); Beine sichtbar synchron zur echten Kadenz; Runde schließt nahtlos; Budget- und Screenshot-Tests grün.

## E5 – Backend-Grundlage & Accounts

**Ziel:** Server auf dem Hetzner-VPS läuft; man kann sich anmelden, Profil und Fahrten werden synchronisiert. Solo/Gast/Sim funktionieren weiterhin ohne Server.

- [ ] `database/`-Modul: Drizzle + SQLite (WAL), `drizzle-kit`-Migrationen, Litestream-Backup aktiv
- [ ] Zod-API-Schemas in `packages/shared/src/api` + Contract-Fixtures (`fixtures/api/`), Response-Validierung im Test-Interceptor
- [x] Auth-Grundlage aus PR #6 integriert; lokale Accounts und Sessions mit stabiler `users.id`. Seit `191d4e8` auf `main`. Cloudflare-OIDC ist damit noch nicht implementiert.
- [ ] Auth über Cloudflare Access OIDC (ADR-013, [E5-03](specs/E5-03-cloudflare-access-oidc.md)): Code Flow + PKCE, sichere Login-Transaktion, explizite Identitätsverknüpfung, lokale Bearer-Session, Logout, Rate-Limits, Login-Klick und exaktes CORS. Kein Access-Proxy vor Webseite oder API. App, Zwei-Personen-Pilot-Policy und sichere Credential-Hinterlegung sind nach separater Freigabe eingerichtet, siehe [E5-04](specs/E5-04-access-oidc-pilot-setup.md). Die API meldet `Teams Free Base`. Seats, echte Pilot-Anmeldung, Laufzeitumsetzung und Produktionsfreigabe stehen aus. Magic Link nach Cutover deaktivieren oder entfernen; Mailversand nur optional für Transaktionsmails oder ausdrücklich gewählten Legacy-/Entwicklungsbetrieb, keine Mailzugangsdaten als OIDC-Startvoraussetzung.
- [ ] `accounts/`: RiderProfile GET/PUT (ersetzt lokales Profil aus E3, Migration lokal → Account)
- [x] [E5-10](specs/E5-10-membership-admin.md): Normal/Premium/Pro und unabhängiges VIP manuell im Konto-Overlay verwalten. Serverberechtigung bleibt getrennt. Additive Migration, Operator-CLI, Sessiongrenzen und Bestätigungsrennen sind softwaregeprüft und unabhängig geprüft. CI, Integration, Bereitstellung und Henrys erster bestätigter Adminzugang stehen noch aus. Keine Preise oder Spielsperren.
- [ ] `rides/`: Upload (idempotent), Plausibilitätsprüfung Stufe 1–4 (`08-backend.md`), Fahrthistorie
- [ ] Client `sync/`: Cache, Outbox mit Retry, Gastmodus, Status-Anzeige „offline / synchronisiert"
- [ ] `@nestjs/throttler`, Daten-Export/Löschung; VPS-Deploy aktiv (Voraussetzung: E0-opt erledigt)
- [ ] Domänen-Metriken (ADR-010): OIDC-Login success/failed ohne Identitäts- oder Tokenlabels, Fahrt-Uploads accepted/flagged/rejected, SQLite- und Litestream-Gesundheit (Backup-Lag)
- [ ] Tests: `@nestjs/testing` + Supertest, Golden-Fahrten auch gegen `POST /v1/rides`, Plausibilitäts-Fixtures (echte Fahrt ok, manipulierte Fahrt flagged)
      **Abnahme:** Henry meldet sich am Laptop an, fährt eine Stunde, Fahrt erscheint in der Server-Historie; Fahrt offline gefahren wird später automatisch hochgeladen; Sim-Fahrt bringt keine Belohnung.

## E6 – Gamification & Volts-Ökonomie (→ MVP)

**Ziel:** Jede Fahrt bringt verbindlichen Fortschritt – mit Spielgefühl.

- [ ] `progression/`: XP/Level serverseitig aus akzeptierten Fahrten; Level-Up-Effekt im Client
- [ ] `economy/`: Volts-Ledger, Verdienformel (`06`), Tageslimit; Property-Test „Kontostand nie negativ"
- [ ] Domänen-Metriken: Volts-Ledger-Einträge und -Summe (Tageswerte in Grafana aus Countern, keine Datums-Labels)
- [ ] **Blitz-Pickups ⚡** in der Welt (Emissive + Bloom, Funken-Partikel, Flug in den HUD-Zähler), serverseitige Pickup-Prüfung
- [ ] GPU-Partikelsystem (Basis für alle späteren Effekte)
- [ ] Segmente (1 Sprint, 1 KOM) mit Banner-Torbögen, Countdown-Flaggen, Live-Delta, PB-Konfetti; PBs serverseitig
  - [x] [E6-01](specs/E6-01-visible-segments.md): vorläufige Sprint-/KOM-Anzeige mit laufender Zeit, Restdistanz und Rundenergebnis softwaregeprüft. Keine bestätigten PBs oder Belohnungsbuchungen.
- [ ] Zielbogen/Rundenanzeige; 9 Start-Badges (Prädikate in `packages/rules`)
- [ ] Fahrtzusammenfassung: vorläufig → bestätigt (Blitz-Regen-Animation)
- [ ] Erste Sounds: Wind, Freilauf, Schalten, Blitz-Sammeln, PB-Fanfare
      **Abnahme:** Nach einer echten Stunde zeigt der Server XP, Level, Volts, PBs und Badges; identisch auf zweitem Browser nach Login; E2E „fahren → Blitz sammeln → Volts bestätigt" grün.

## E7 – Customizing, Garage & Shop

**Ziel:** Eigener Fahrer, eigenes Rad, Freischalten mit Volts.

- [ ] Modulare Rider-/Bike-Modelle mit Slots und Farbmasken (`05`), Skalierung nach `heightCm`
- [ ] Item-Katalog (`packages/rules/data/catalog`) + Schema-Test; Start-Katalog
- [ ] `inventory/` + `POST /v1/shop/purchase` (atomar), Ausrüsten nur besessener Items
- [ ] Garage-Showroom (Studio-Licht, Drehteller, Fotomodus), Shop mit Preisen in ⚡, gesperrte Items mit Bedingung
- [ ] Wiegetritt/Ducken-Posen, Kurvenneigung
      **Abnahme:** Henry kauft ein Laufrad mit Volts und rüstet es aus; nach Reload/anderem Browser identisch; Kauf ohne genug Volts abgelehnt; visuelle Tests der Garage grün.

## E8 – Lebendige Welt: Bots, Windschatten, Tageszeit, Wetter, Atmosphäre

**Ziel:** Aus der Strecke wird eine Spielwelt.

- [ ] **AI-Bots** (`packages/engine/bots`): Persönlichkeiten, Gruppen, Attacken, Sprints; Fahrer-LODs + Impostoren
- [ ] **Windschatten** in der Engine (auch Trainer-Widerstand) + sichtbarer Effekt (HUD-Indikator, Luftstrom-Partikel, leiserer Wind)
- [ ] Spurwahl/Überholen (laterale Position)
- [ ] **Day/Night-Zyklus** (Sonne, Sky, Sterne, Laternen, Radlicht) und **Wetter** (Wolken, Nebel, Regen mit nasser Straße, Wind-Animation)
- [ ] **Post-Processing:** SMAA, Bloom, SSAO (High), Farb-LUT pro Biom, Tiefenunschärfe für Cinematic
- [ ] **Roadside life:** Zuschauer mit Vertex-Animation an KOM/Sprint/Ziel, Fahnen, Tiere, Vögel, Verpflegungsstand
- [ ] **Kameras:** TV-Seitenkamera, **Cinematic-Modus** mit automatischem Schnitt, Fotomodus
- [ ] **Audio/Musik:** räumlicher Jubel, Reifen/Untergrund, Wetter-Ambience, Biom-Musik (CC0/eigen), Mixer
- [ ] Performance-Budget-Szene „Peloton am KOM" (30 Bots, Regen, Abend) im Budget
      **Abnahme:** 60-min-Fahrt mit 20 Bots bei Wetterwechsel und Sonnenuntergang ≥ 60 fps p50 auf Henrys Laptop (Medium); Windschatten messbar (Golden-Test) und spürbar; visuelle Tests für Tag/Nacht/Regen grün.

## E9 – Live-Gruppenfahrten

**Ziel:** Mit Freunden gemeinsam fahren.

- [ ] `live/`: `LiveGateway` (`@nestjs/websockets` + `platform-ws`), Auth im ersten Frame, Räume (Route + Raumcode), Limits
- [ ] Client `net/`: Join, 2–4 Hz State, Interpolation, Reconnect; Contract-Tests der WS-Schemas
- [ ] Remote-Fahrer als `RiderView` (Name-Tag, Avatar aus Server); Windschatten hinter Freunden (v2, Latenz prüfen)
- [ ] `mise run sim:crowd` (Fake-Clients für Lasttest)
- [ ] Domänen-Metriken: aktive Fahrten, offene WebSocket-Verbindungen, Gruppenfahrt-Räume
      **Abnahme:** Zwei Accounts sehen sich flüssig auf derselben Strecke; Server übersteht Client-Abbrüche; 30 Fake-Clients ohne Ruckeln.

## E10 – Mehr Spiel: Inhalte & Extras

- [ ] Biome Küste, Alpenpass (Serpentinen), Nachtstadt (Neon); Streckenauswahl mit Vorschau
- [ ] **Power-ups** (Aero-Boost, Leichtgewicht, Windschatten-Magnet) inkl. serverseitiger Nachrechnung
- [ ] Ghost der PB-Fahrt; Events/Herausforderungen (z. B. „Wochen-KOM")
- [ ] GPX-Import (optional), FIT-Export (Strava/Garmin)
- [ ] Optionale ERG-Workouts (nutzt `ftpW`)
- [ ] Weitere Login-Methoden wie Passkeys im Broker prüfen; keine parallele direkte Auth-Implementierung ohne neue Entscheidung (ADR-013)
- [ ] WebGPU-Renderer evaluieren; Ultra-Qualitätsstufe
- [ ] Onboarding, Einstellungen, Barrierefreiheit HUD
- [ ] Optionale Client-Telemetrie (ADR-010): aggregierte FPS/Framezeit und BLE-Trennungen sowie Fehler-Signaturen an einen eigenen Server-Endpunkt, keine Third-Party-Tracker
- [ ] Strava-Integration (optional): OAuth-Verbindung eines Strava-Kontos, akzeptierte Fahrt als Activity hochladen
  - [x] [E10-04](specs/E10-04-complete-ride-delivery.md): Worker-Journal, kanonische API und ausdrücklicher dauerhafter TCX-Versand gegen lokale Testanbieter softwaregeprüft. Bestehende Aufnahmen bleiben erhalten.
  - [ ] Echter Anbieterpilot mit Zustimmung, Callback-/Logprüfung, Sichtbarkeit und Betriebsfreigabe. Replay-Konsistenz bleibt ausdrücklich kein Hardwareattest.
