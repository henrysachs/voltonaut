# 07 – Roadmap (Etappen)

Jede Etappe endet mit einem lauffähigen Stand auf GitHub Pages. Reihenfolge so gewählt, dass Hardware-Risiken (E1/E2) früh geklärt werden. **E0–E4 brauchen keinen Server** (Solo, Sim, lokales Profil); ab E5 kommt das Backend, bevor Ökonomie (E6) und Garage/Shop (E7) darauf aufbauen. Solo/Gast/Sim bleiben in jeder Etappe ohne Server lauffähig. Checkboxen beim Erledigen abhaken (im selben PR).

---
## E0 – Repo-Gerüst, Sim-Modus, CI, Pages
**Ziel:** Leere, aber vollständig verdrahtete App, die jeder Agent lokal und im Sim-Modus starten kann.
- [ ] Vite + TS (`strict`), ESLint (inkl. `import/no-restricted-paths` für Modulgrenzen), Prettier, Vitest, Playwright
- [ ] Ordnerstruktur aus `01-architecture.md`, `shared/` Typen aus den Skizzen, typisierter Event-Bus
- [ ] `sim/`: FakeTrainer (Watt/Kadenz per Slider oder Skript-Profil), FakeHeartRate, Keyboard-Controller (↑/↓ = schalten)
- [ ] `?sim=1` schaltet Composition Root auf Sim-Geräte
- [ ] Minimal-HUD (Watt, Kadenz, Puls, Gang) mit Sim-Werten
- [ ] GitHub Actions: lint, typecheck, test, build; Deploy nach GitHub Pages (`base: '/voltonaut/'`)
- [ ] `public/assets/LICENSES.md`, `fixtures/ble/README.md`
**Abnahme:** `npm run dev` + `?sim=1` zeigt laufende Werte; Pfeiltasten ändern Gang; CI grün; Pages-URL erreichbar über HTTPS.

## E1 – Bluetooth-Sniffer, Puls, FTMS lesen
**Ziel:** Echte Geräte sehen und verstehen. Grundlage fürs Reverse Engineering.
- [ ] `debug/ble.html` nach Spezifikation `02-bluetooth.md` §5 (Scan, GATT-Explorer, Logger, Marker, Presets, Export)
- [ ] `devices/hrs`: Parser `0x2A37` + Adapter, Tests mit Fixtures
- [ ] `devices/ftms`: Parser `0x2AD2` (Flags inkl. invertiertem Bit 0, uint24, Kadenz ×0,5), Feature-Lesen `0x2ACC`
- [ ] `devices/cps`: Fallback-Parser `0x2A63` (nur lesen)
- [ ] Verbinden-Dialog im Spiel, Statusanzeige pro Gerät, Reconnect bei Abbruch (Backoff 1/2/5 s)
- [ ] **Hardware-Session mit Henry:** GATT-Exporte Trainer, Pulsgurt, beide Play-Griffe → `fixtures/ble/` (Firmware-Versionen notieren)
**Abnahme:** Echter Puls und echte Watt/Kadenz im HUD; Sniffer-Exporte aller drei Geräte eingecheckt; `02-bluetooth.md` mit Befunden aktualisiert.

## E2 – Play-Controller-Mapping, virtuelles Schalten, FTMS-Steuerung
**Ziel:** Schalten mit den Zwift-Play-Griffen (LS = runter, RS = hoch) verändert den Widerstand spürbar.
- [ ] Play-Firmware feststellen (1.x: 2 Verbindungen, `0x07` / 2.0.1: 1 Verbindung, vermutlich `0x23`)
- [ ] Klartext-Handshake („RideOn") + eigener Mini-Protobuf-Decoder für `0x07`, Bitmap-Decoder `0x23` – beide gegen Sniffer-Fixtures; ButtonMap-JSON
- [ ] Bei FW 1.x: zwei Griffe parallel verbinden und zuordnen (Device-Typ 2/3), getrennter Reconnect
- [ ] Entprellung/Dedupe, Flankenerkennung, optional Auto-Repeat bei Halten
- [ ] Haptik-Feedback beim Schalten (`0x12…`-Kommando), abschaltbar
- [ ] Fallback: verschlüsselter Handshake nur falls Klartext scheitert (separates Ticket, AES-CCM-Lib nötig)
- [ ] `engine/gears`: 24-Gang-Preset, Shift-Intents, Anzeige im HUD
- [ ] `devices/ftms` Control Point: Write-Queue, Indications, Request Control, Start, `0x11`-Encoder (geclampt), Fehler-/Permission-Lost-Handling
- [ ] Trainer-Strategie A (Effective Grade) + B (Virtual-Power ERG) hinter Schalter
- [ ] Kalibrier-Assistent: physische Übersetzung + Trainer-Masse (siehe `03` §3–4)
- [ ] Testfahrt-Protokoll mit Henry: 3 Gänge × 3 Steigungen, subjektives Gefühl + Logs
**Abnahme:** Schalten an beiden Griffen funktioniert zuverlässig (100 Drücke, 0 verloren, 0 doppelt); Widerstandsänderung < 300 ms spürbar; ADR zur gewählten Strategie ergänzt.

## E3 – Engine-Physik
**Ziel:** Realistisches virtuelles Tempo auf einem Höhenprofil.
- [ ] `engine/physics` nach `03` §2, deterministischer Tick, Tests (Referenzgeschwindigkeiten)
- [ ] `ElevationProfile` mit `elevationAt`/`gradeAt(smoothing)`; Test-Route als reine Daten
- [ ] RideState-Summen (Distanz, Hm, kJ, Zeit), Auto-Pause, Datenausfall-Verhalten
- [ ] Engine → Trainer: Grade aus Route + Gang, Rate-Limit 4 Hz
- [ ] Rider-Profil-Screen (`03` §2a: Gewicht, Größe, Rad, Kettenblatt/Cog, Gang-Preset; später FTP) – in E3 lokal gespeichert, ab E5 mit Account synchronisiert
**Abnahme:** 60-min-Sim-Fahrt mit festem Watt-Profil liefert erwartete Distanz ± 2 %; auf echter Rolle fühlt sich der Test-Anstieg wie Anstieg an.

## E4 – Erste 3D-Welt mit tretendem Fahrer
**Ziel:** Das „Zwift-Gefühl": Fahrer fährt sichtbar durch die Welt.
- [ ] three.js-Szene, Licht, Himmel, Fog, Qualitätsstufen, fps-Anzeige im Debug-HUD
- [ ] „Voltonaut Loop" (~12 km) als Route-Daten; Straßen-Mesh, Terrain-Chunks, Instanced-Szenerie (CC0-Assets)
- [ ] Platzhalter-Rad + Platzhalter-Fahrer (Low-Poly), Kurbel dreht mit Kadenz, Beine per IK
- [ ] Verfolgerkamera + 2 weitere Ansichten
- [ ] Mini-Höhenprofil im HUD mit Positionsmarker
**Abnahme:** ≥ 60 fps auf Henrys Laptop (High oder Medium); Beine sichtbar synchron zur echten Kadenz; Runde schließt nahtlos.

## E5 – Backend-Grundlage & Accounts
**Ziel:** Server auf dem Hetzner-VPS läuft; man kann sich anmelden, Profil und Fahrten werden synchronisiert. Solo/Gast/Sim funktionieren weiterhin ohne Server.
- [ ] `server/` (Node 22, Fastify, TypeBox, Kysely + SQLite WAL), Migrationen, `/healthz`; `npm run server:dev`
- [ ] `shared/api/` Typen; `shared/physics` + Level-/Katalog-Daten von Client und Server gemeinsam genutzt
- [ ] Auth: Magic Link (SMTP), Bearer-Session, Logout, Rate-Limits; Login-Screen im Client
- [ ] `accounts/`: RiderProfile GET/PUT (ersetzt lokales Profil aus E3, Migration lokal → Account)
- [ ] `rides/`: Upload (idempotent), Plausibilitätsprüfung Stufe 1–4 (`08-backend.md`), Fahrthistorie
- [ ] Client `sync/`: Cache, Outbox mit Retry, Gastmodus, Status-Anzeige „offline / synchronisiert"
- [ ] VPS: Caddy/TLS, systemd, Litestream-Backup, CORS; Daten-Export/Löschung
- [ ] Tests: Fastify `inject`, Plausibilitäts-Fixtures (echte Fahrt ok, manipulierte Fahrt flagged)
**Abnahme:** Henry meldet sich am Laptop an, fährt eine Stunde, Fahrt erscheint in der Server-Historie; Fahrt offline gefahren wird später automatisch hochgeladen; Sim-Fahrt bringt keine Belohnung.

## E6 – Gamification & Volts-Ökonomie (→ MVP)
**Ziel:** Jede Fahrt bringt verbindlichen Fortschritt.
- [ ] `progression/`: XP/Level serverseitig aus akzeptierten Fahrten; Level-Up im Client
- [ ] `economy/`: Volts-Ledger, Verdienformel (`06`), Tageslimit
- [ ] Blitz-Pickups ⚡ in der Welt (deterministisch pro Route) + HUD-Zähler mit Animation; serverseitige Pickup-Prüfung
- [ ] Segmente (1 Sprint, 1 KOM) mit Live-Delta, PBs serverseitig
- [ ] 9 Start-Badges (Prädikate in `shared/`)
- [ ] Fahrtzusammenfassung: vorläufig → bestätigt
**Abnahme:** Nach einer echten Stunde zeigt der Server XP, Level, Volts, PBs und Badges; Werte identisch auf zweitem Browser nach Login.

## E7 – Customizing, Garage & Shop
**Ziel:** Eigener Fahrer, eigenes Rad, Freischalten mit Volts.
- [ ] Modulare Rider-/Bike-Modelle mit Slots und Farbmasken (`05`), Avatar-Skalierung nach `heightCm`
- [ ] Item-Katalog (`shared/data/catalog`) + Schema-Test; Start-Katalog
- [ ] `inventory/` + `POST /v1/shop/purchase` (atomar), Ausrüsten nur besessener Items (`PUT /v1/me/avatar`)
- [ ] Garage-Screen mit 3D-Showroom, Shop mit Preisen in ⚡, gesperrte Items mit Bedingung
- [ ] Wiegetritt/Ducken-Posen, Kurvenneigung
**Abnahme:** Henry kauft ein Laufrad mit Volts, rüstet es aus; nach Reload/anderem Browser identisch; Kauf ohne genug Volts wird abgelehnt.

## E8 – Live-Gruppenfahrten
**Ziel:** Mit Freunden gemeinsam fahren.
- [ ] `live/`: WSS `/v1/live`, Auth im ersten Frame, Räume (Route + Raumcode), Limits
- [ ] Client `net/`: Join, 2–4 Hz State, Interpolation, Reconnect
- [ ] Remote-Avatare (Name-Tag, Avatar-Config aus Server) in der Welt
- [ ] `npm run sim:crowd` (Fake-Clients für Lasttest)
**Abnahme:** Zwei Accounts sehen sich gegenseitig flüssig auf derselben Strecke; Server übersteht Client-Abbrüche.

## E9 – Feinschliff, mehr Strecken, GPX, Workouts
- [ ] 2 weitere Strecken/Biome; Streckenauswahl
- [ ] Ghost der PB-Fahrt
- [ ] GPX-Import (optional), FIT-Export der Fahrt (für Strava/Garmin)
- [ ] Optionale ERG-Workouts (nutzt `ftpW` aus dem Profil)
- [ ] Passkeys als zweite Login-Methode
- [ ] Sound (Wind, Freilauf, Blitz-Sammeln, Jubel bei PB), Onboarding, Performance-Pass, Barrierefreiheit HUD
- [ ] Deploy-Workflow Server per SSH (erst nach Henrys Freigabe der Secrets)
