# Spec E3-01 – Engine-Physik

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E3, alle 5 Checkboxen + Abnahme („60-min-Sim-Fahrt ± 2 %; Test-Anstieg fühlt sich auf echter Rolle wie Anstieg an")
- **Status:** Implementiert, Teilabnahme. Offene Kriterien und Henry-Prüfungen stehen im Verifikationsstand unten.
- **Betroffene Module:** `packages/engine` (physics, elevation, ride, internal; konsumiert gears/trainer aus E2), `packages/shared` (RiderProfile-Schema, TrainerCommand-Typen), `apps/web/src/ui/profile`, `apps/web/src/sync` (minimaler lokaler Profil-Store), `apps/web/src/game` (Engine-Worker-Bridge), `fixtures/rides/`. Modulübergreifend erlaubt; Grenzen prüft dependency-cruiser.

## Ziel

Nach E3 liefert die Engine aus gemessener Leistung, Kadenz und einem Höhenprofil ein realistisches virtuelles Tempo samt verlässlicher Fahrtsummen (Distanz, Höhenmeter, kJ, Zeit) – deterministisch getickt, im Sim-Modus vollständig maschinell beweisbar (Golden-Fahrten, fast-check-Properties, Mutation ≥ 80 %). Der Trainer bekommt die Steigung aus Route + Gang mit max. 4 Hz. Der Nutzer pflegt sein Rider-Profil in einem Screen, das lokal gespeichert wird (ab E5 Account-Sync).

## Abnahmekriterien (aus der Roadmap übernommen und präzisiert)

- [x] **AK1 – Physik nach `03` §2, deterministischer Tick** (Checkbox 1). Kräfte `F_g`, `F_r`, `F_a`, `F_p` mit Konstanten `g = 9,81 m/s²`, `ρ = 1,225 kg/m³`, `η = 0,97`, `m_eff = m + 1,0 kg`, Antriebsuntergrenze `max(v, 0,5 m/s)`; explizites Euler bei fest `dtS = 0,05` (20 Hz), `v ≥ 0` geclampt. Messbar:
  - Stationär 200 W / 0 % / 83 kg (75 Fahrer + 8 Rad) → **33,0–34,0 km/h** (Rechenwert 33,9).
  - Stationär 250 W / 8 % / 83 kg → **11,5–13,0 km/h** (Rechenwert 12,4).
  - Abfahrt −6 % ohne Leistung → Terminalgeschwindigkeit **54–56 km/h** (Rechenwert 54,9); bergab ohne Treten wird schneller, kJ bleibt konstant.
  - Determinismus: identisches Eingabeskript zweimal ⇒ Deep-Equal der Snapshot-Folge, Events und Trainer-Kommandos (kanonisch gerundet auf 6 Dezimalen). Kein `Date.now()`/`Math.random()` in `packages/engine` (Review + Determinismus-Tests).
- [ ] **AK2 – Golden-Fahrten** (`10-testing.md` §3; Testteil von Checkbox 1). Vier Fixtures `fixtures/rides/{flat-200w-60min, typical-60min, climb-250w-10min, descent-coast-5min}.{input,golden}.json`, Format §5.6. Golden enthält Distanz, Hm, kJ, tS, Endgeschwindigkeit, Lap-/Segmentzeiten, Trainer-Kommando-Folge (Hash) – 6 Nachkommastellen, Vergleich exakt. Update nur per `mise run golden:update` + PR-Label `baseline-update`.
- [ ] **AK3 – Property-Tests (fast-check)** (Testteil von Checkbox 1). Mindestens:
  - P1: Mehr Watt ⇒ nie langsamer (gleiche Ausgangslage/Steigung/Masse; tickweise `v₂ ≥ v₁`, `distance₂ ≥ distance₁`).
  - P2: Steilere Steigung ⇒ bei gleicher Leistung nie schneller.
  - P3: `v` nie negativ, nie NaN/∞ über extremen Zufallsfolgen (P ≤ 2 000 W, grade −30…+30 %, dt-Variation um 0,05).
  - P4: Höherer Gang ⇒ `gradeEff` bei gleicher Kadenz/Steigung nie niedriger (Strategie A) bzw. Zielleistung nie niedriger (Strategie B).
  - P5: Gang bleibt in [1, 24]; n× hoch dann n× runter ⇒ Ausgangsgang.
  - P6: `gradeEff` immer in [−10, +20] % (Clamping statt Überlauf).
  - P7: Summen-Monotonie: `distanceM`, `elevationGainM`, `energyKj`, `tS` nie fallend; `energyKj = Σ P_roh · dtS / 1000`.
  - Seeds bei Fehlschlag ausgeben und als Regressionstest fixieren.
- [x] **AK4 – Mutation & Coverage** (Testteil von Checkbox 1). Stryker-Score ≥ 80 % (break, Ziel 90 %) auf `packages/engine/src/{physics,gears,trainer}`; Vorschlag: um `elevation/` und `internal/` erweitern (→ Doku-Update `10-testing.md` §9, kein Lockern). Coverage engine: Lines/Statements/Functions ≥ 90 %, Branches ≥ 85 %. Stryker-Laufzeit messen (open-questions T9) und im PR dokumentieren.
- [ ] **AK5 – `ElevationProfile` + Test-Routen als reine Daten** (Checkbox 2). `elevationAt` linear interpoliert: an Stützstellen exakt, dazwischen linear, außerhalb `[0, L]` Endwert gehalten (non-loop) bzw. `d mod L` (loop). `gradeAt(d, smoothingM = 25)` = zentrale Differenz `(elev(d + s/2) − elev(d − s/2)) / s · 100`, Fenster am Loop geclosed, am non-loop-Ende geklemmt. Drei Routen als reine Datendateien (§5.3), keine Prozedur, kein DOM/Node; `worldPos`/`headingRad` aus Centerline-Polylinien-Interpolation, Loop schließt nahtlos (Position am Ende = Anfang, Heading stetig).
- [x] **AK6 – RideState-Summen, Auto-Pause, Datenausfall** (Checkbox 3). `distanceM` = Odometer (lap-übergreifend), `routePosM = distanceM mod lengthM` (Loop); `elevationGainM` nur positive Per-Tick-Deltas; `energyKj` aus Rohleistung; `tS` ohne Pausen. Auto-Pause: `speedMps < 0,5` ∧ `cadenceRpm = 0` über **5 s** ⇒ `paused`, alle Summen eingefroren; Resume bei Kadenz > 0 ∨ Leistung > 0. Datenausfall: **> 3 s** kein `trainer.data` ⇒ Rohleistung/-kadenz = 0 (Ausrollen) + `dataAgeS` im Snapshot (HUD-Warnung). Alles durch handgerechnete Tick-Sequenzen als Unit-Tests belegt (z. B. 100 Ticks stehen ⇒ Pause exakt bei Tick 101-Regelwerk).
- [ ] **AK7 – Engine → Trainer: Grade aus Route + Gang, Rate-Limit 4 Hz** (Checkbox 4). Physik- und Trainer-Steigung aus derselben Quelle `gradeAt(routePosM, 25)`; Trainer-Input zusätzlich: Abfahrten auf **−5 %** geklemmt, `gradeEff ∈ [−10, +20] %`, `mT`-Default 83 kg (Kalibrierwert als Daten, aus E2). Rate-Limit deterministisch über Tick-Zähler: regulär max. 1 Kommando pro 5 Ticks (4 Hz), nur bei `|ΔgradeEff| ≥ 0,1 %`; **Gangwechsel sofort** (Ziel < 300 ms, umgeht das 4-Hz-Intervall, zählt aber zur Serialize-Queue von E2). Ohne Kadenz (`cadenceRpm = 0`) letzten Grade halten. Monotonie- und Clamp-Tests (P4/P6), exakte Kommando-Folge im Golden-Hash (AK2).
- [ ] **AK8 – Rider-Profil-Screen, lokal gespeichert** (Checkbox 5, `03` §2a). Screen in `apps/web/src/ui`: `displayName`, `massKg`, `heightCm`, `bike.{massKg, chainringTeeth, cogTeeth}`, `wheelCircM`, `gearPreset` (`zwift-like-24`), `units`; `ftpW`/`maxHrBpm` im Schema reserviert, in E3 **ohne** UI-Feld („später"). Validierung: Masse 30–200 kg, Größe 120–220 cm, Kettenblatt 28–60 Z., Radumfang 1,9–2,4 m – Ungültiges wird abgewiesen und nicht gespeichert (Unit + E2E). Speicherung: IndexedDB, versioniert, `schemaVersion: 1`, plain Web-API, keine Lib; Reload stellt Werte wieder her (E2E). CdA: falls nicht überschrieben, Schätzung `cdaM2 = 0,32 · BSA(heightCm, massKg) / BSA(185, 75)` (DuBois; reproduziert Default 0,32 bei 185 cm/75 kg). Änderungen während einer Fahrt wirken erst ab der nächsten Fahrt (Parameter werden zu Fahrtbeginn eingefroren – gleiche Semantik wie später die Server-Plausibilität).
- [x] **AK9 – Anti-Pause Hintergrund-Tab** (aus `01-architecture.md` Loops; löst open-questions T1). Engine läuft ab E3 in einem **Dedicated Web Worker** (Begründung §5.1); Worker-Treiber integriert per Akkumulator mit festem `dtS = 0,05`, Catch-up pro Aufwachung gekappt auf 120 Ticks (6 s virtuell); darüber hinausgehende Uhr-Lücken ⇒ `ride.clockSkipped`-Event, danach übernimmt die Datenausfall-Regel (Ausrollen statt Stillstand). Unit-Tests: Catch-up-Integration und Gap-Verhalten exakt; E2E (best effort): Tab in Hintergrund ⇒ Distanz läuft weiter; Page-Freezing-Verhalten (> 5 min, mit aktiver BLE-Verbindung) wird manuell auf Henrys Chrome geprüft (§5.8).
- [x] **AK10 – 60-Min-Abnahme, Sim-Hälfte** (Roadmap-Abnahme). Golden `flat-200w-60min`: 60 min konstant 200 W, Cadenz 90 rpm, Defaults (83 kg gesamt), Flat-Route, Standstart ⇒ Distanz ≈ 33,78 km; **|golden − v_stationär · 3600 s| ≤ 2 %** (Referenz 33,88 km, Abweichung −0,28 %). Zusätzlich Unit-Test mit Rolling-Start bei `v_stationär`: |Distanz − v* · 3600| ≤ 0,1 %. Die Hardware-Hälfte der Abnahme („fühlt sich wie Anstieg an") steht in §5.8 und ist kein AK dieses PRs.

## Verifikationsstand (2026-11-20)

`mise run check` ist grün mit 174 Tests und drei Playwright-Tests. `mise run check:mutation` ist nach einem vollständigen Lauf grün mit 95,55 % Gesamt-Score bei 5099 Mutanten. Der Lauf dauerte einmalig 101 s inklusive Task-Start. Die Konfiguration prüft die gesamte Engine einschließlich Routendaten sowie `rules`; einzelne Dateien liegen unter 80 %, die konfigurierte Schwelle gilt für den Gesamt-Score. Der Rolling-Start-Test läuft in `apps/web/src/golden/golden.test.ts` über die öffentliche Engine-Fassade und prüft 3600 s sowie die relative Distanzabweichung ≤ 0,001.

Nicht vollständig abgenommene Kriterien bleiben offen:

- AK2: Alle vier Golden-Vergleiche laufen. `mise run golden:update` zeigt aber noch auf den E3-Platzhalter in der geschützten `mise.toml`. `scripts/golden-update.mjs` ist vorbereitet, nicht verdrahtet. Die bestehende Freigabe für Baselines ersetzt das nicht.
- AK3: P1–P6 sind getestet, P4 nur auf flacher Strecke und bergauf. Bergab kann das vorgegebene lineare Kraftmodell die Gangreihenfolge umkehren. P7 als Property über zufällige Tick-Folgen fehlt; handgerechnete Summen-Tests bestehen.
- AK5: Profile und Routen sind getestet. Polyline-Headings sind stückweise konstant; der Seam-Test erlaubt einen Winkelsprung unter 0,02 rad statt mathematischer Stetigkeit. Das flache Höhenprofil verwendet nur zwei gleich hohe Endpunkte statt 10-m-Stützstellen.
- AK7: Engine-Kommandos und Rate-Limit sind getestet. Die App reicht die Worker-Kommandos noch nicht an einen echten E2-Trainer-Adapter weiter. Die Hardware-Queue und Kalibrierung bleiben E2-Aufgaben.
- AK8: Formular, Schema, IndexedDB und Reload sind getestet. Ein gezielter Test für „Profiländerung wirkt erst nächste Fahrt“ fehlt.

Hardware wurde nicht getestet. Page Freezing über fünf Minuten mit aktivem BLE, Anstiegsgefühl und eine echte Wattreihe bleiben in `docs/open-questions.md` erfasst. Roadmap-Checkboxen wurden auftragsgemäß nicht geändert.

## Testplan (`docs/10-testing.md`)

| AK                  | Ebene                              | Datei / Fixture                                                                                                                                                |
| ------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AK1                 | Unit + Property                    | `packages/engine/src/physics/physics.test.ts`, `physics.property.test.ts`                                                                                      |
| AK1 (Determinismus) | Unit                               | `packages/engine/src/internal/determinism.test.ts`                                                                                                             |
| AK2                 | Golden                             | `fixtures/rides/*.input.json` → `*.golden.json`, Runner `apps/web/src/golden/golden.test.ts`                                                                   |
| AK3                 | Property (fast-check)              | `packages/engine/src/{physics,gears,trainer}/*.property.test.ts`                                                                                               |
| AK4                 | Mutation + Coverage                | `mise run check:mutation` (Pfadfilter engine), Vitest-Coverage-Schwellen aus E0                                                                                |
| AK5                 | Unit                               | `packages/engine/src/elevation/profile.test.ts`, `route.test.ts`                                                                                               |
| AK6                 | Unit                               | `packages/engine/src/internal/{sums,autopause}.test.ts`                                                                                                        |
| AK7                 | Unit + Golden                      | `packages/engine/src/trainer/gradeMap.test.ts` + Kommando-Hashes in AK2                                                                                        |
| AK8                 | Unit + E2E                         | `apps/web/src/ui/profile/profileScreen.test.ts` (Grenzen über `RiderProfileSchema`), `apps/web/src/sync/profile-store.test.ts`, `apps/web/e2e/profile.spec.ts` |
| AK9                 | Unit + E2E (best effort) + manuell | `packages/engine/src/internal/catchup.test.ts`, `apps/web/e2e/background-tab.spec.ts`, Henry-Check §5.8                                                        |
| AK10                | Golden                             | `fixtures/rides/flat-200w-60min.*`                                                                                                                             |

E2E-Flüsse (Playwright, `?sim=1&clock=fast`): (1) Profil-Screen: ungültige Masse abgewiesen, gültige gespeichert, Reload stellt her. (2) Fahrt auf Test-Route: HUD zeigt Distanz/Tempo aus der Physik, 2× hoch schalten ändert Ganganzeige, Distanz wächst mit beschleunigter Sim-Uhr. (3) Background-Tab: Distanz läuft weiter (falls in headless CI instabil → Unit-Tests + manueller Henry-Test tragen das Kriterium, E2E wird dokumentiert entfernt, nicht gelockert).

## Fachlicher Entwurf

### 5.1 Deterministischer Tick & Ownership

**Ownership (unverändert aus `01-architecture.md`):** `RideState` wird **nur** in `packages/engine/src/internal/**` mutiert (depcruise `engine-internal-private`), nach außen nur `DeepReadonly`-Snapshots; Snapshots in Tests per `Object.freeze` gesichert. Route/Profil sind nach Fahrtstart unveränderlich; Render-/UI-Module lesen nur Snapshots; der Server rechnet Fahrten später mit demselben `@voltonaut/engine` nach (ADR-005).

**Interne reine Funktion** (Signatur aus `03` §1):

```ts
function tick(
  s: RideState,
  in_: TickInputs,
  route: EngineRoute,
  p: RiderParams,
  dtS: number,
): { state: RideState; events: RideEvent[]; trainer?: TrainerCommand };
```

Tick-Reihenfolge (verbindlich, aus `03` §1):

1. Shift-Intents anwenden (Gang-Clamp [1, 24], `gear.changed`-Event bei Änderung).
2. Messwerte übernehmen: Physik nutzt **Rohwerte**; Anzeige-Werte (`powerW`, `cadenceRpm`, `hrBpm` im State) per EMA mit `α = 1 − e^(−dtS/τ)`, `τ = 1 s` (≈ 0,0488 pro Tick).
3. Datenausfall prüfen: `dataAgeS += dtS` ohne frisches `trainer.data`; ab > 3 s Rohleistung/-kadenz := 0.
4. Steigung holen: `gradePct = route.profile.gradeAt(routePosM, 25)` (eine Quelle für Physik und Trainer).
5. Tempo integrieren (Euler, §5.2), `v ≥ 0` clampen.
6. Position/Höhe/Summen fortschreiben; Lap-Wrap und Segment-Grenzen prüfen (`lap.completed`, `segment.entered/exited`, `distance.tick`).
7. Auto-Pause-Zustandsmaschine (§5.4); ggf. Trainer-Kommando erzeugen (§5.4, Rate-Limit).

**Öffentliche Fassade:** `createEngine({ route, profile, gears, trainerStrategy, seed? })` → `Engine` mit `ingest(events)`, `advance(dtS)`, `snapshot(): RideSnapshot`, `drainEvents()`, `drainCommands()`. Die Fassade ist dünn; alle Tests der Physik laufen gegen die interne Funktion, Golden gegen die Fassade. Kein Wanduhr-Zugriff in der Engine: Zeit kommt ausschließlich als `dtS` von außen (Treiber siehe AK9).

**Engine-Treiber (T1-Entscheidung): Dedicated Web Worker** `apps/web/src/game/engine-worker.ts` (Bootstrap in `apps/web`, weil `packages/engine` DOM/Worker-frei bleibt und auch serverseitig läuft). Bridge: `DeviceEvent`s (BLE läuft nur auf dem Main Thread) per `postMessage` hinein, `TrainerCommand`s, Snapshots und Events heraus; Nachrichten sind intern typisiert (shared-Bus-Typen), kein Zod nötig (kein externer Daten-Fluss). Worker-Timer weckt den Akkumulator; pro Aufwachung werden ⌊elapsed / 0,05⌋ Ticks nachgeholt (Kappung: 120 Ticks = 6 s; Rest ⇒ `ride.clockSkipped`-Event, danach greift Datenausfall ⇒ Ausrollen). Verworfene Alternative: Main-Thread-Engine + Worker-Timer – scheitert an Chrome Page Freezing (eingefrorener Main Thread integriert nichts mehr, auch nicht auf Worker-Wecksignale). E4 rendert dann aus den letzten zwei Snapshots interpoliert (ADR-008 unverändert).

### 5.2 Physik: Formeln, Einheiten, Konstanten, Integration

Einheiten im Namen, intern SI (`01-architecture.md` Regel 2). Kräfte am Rad mit `θ = atan(gradePct / 100)`:

- Steigung: `F_g = m · g · sin θ` (bergauf positiv, bremsend)
- Rollwiderstand: `F_r = m · g · cos θ · Crr`
- Luft: `F_a = 0,5 · ρ · CdA · (v + v_wind)² · sign(v + v_wind)`; E3: `v_wind = 0` (Wetter/Windschatten erst E8, aber Term ab Tag eins im Modell)
- Antrieb: `F_p = η · P_roh / max(v, 0,5)` (Untergrenze verhindert Division durch 0 beim Anfahren)

Integration: `m_eff · dv/dt = F_p − F_g − F_r − F_a` mit `m_eff = m + 1,0 kg` (Laufräder); explizites Euler bei 20 Hz, `v ≥ 0` (kein Rückwärtsrollen in v1). Das virtuelle Tempo hängt **nur von gemessener Leistung** ab, nie vom Gang (Gang wirkt nur aufs Trainer-Kommando) – dadurch ist die Physik im Sim-Modus trivial testbar und unabhängig vom Trainer-Mapping (`03` §2).

Defaults (`RiderParams`, aus Profil abgeleitet): Fahrer 75 kg + Rad 8 kg, `CdA 0,32 m²` (Oberlenker; Schätzung aus `heightCm`/`massKg` per DuBois, überschreibbar), `Crr 0,004` (Asphalt), `ρ 1,225 kg/m³`, `g 9,81 m/s²`, Radumfang 2,105 m (700×25c).

### 5.3 `ElevationProfile`, Route, Test-Routen als reine Daten

```ts
interface ElevationProfile {
  samples: ReadonlyArray<{ distanceM: Meters; elevationM: Meters }>; // monoton, ~alle 10 m
  elevationAt(distanceM: Meters): Meters;
  gradeAt(distanceM: Meters, smoothingM?: Meters): Pct; // Default smoothingM = 25
}
```

Konstruktion `createElevationProfile(samples)` mit Validierung (monoton steigende `distanceM`, ≥ 2 Stützstellen). `gradeAt` über zentrale Differenz (AK5); eine Steigungsquelle für Physik und Trainer verhindert Ruckeln am Trainer und Divergenz zwischen Anzeige und Widerstand.

**Routen als reine Daten** (`packages/engine/src/elevation/data/`, TS-Datendateien, keine Generierung; Centerline als 2D-Polylinie mit kumulativen Bogenlängen bei Konstruktion):

| Route       | Daten                                                                                                                                                                                                                                                  | Zweck                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `flat-loop` | 5 000 m, elev konstant 100 m, 0 %, Loop, kreisförmige Centerline                                                                                                                                                                                       | AK10, Stationär-Tests                                                                   |
| `test-loop` | 10 000 m, Loop, geschlossen (elev 100 → … → 100): 0–3 000 m 0 % (Sprint-Segment 2 000–2 500), 3 000–4 200 m +4 %, 4 200–5 000 m 0 %, 5 000–5 600 m +8 % (KOM-Segment), 5 600–6 600 m −6 %, 6 600–8 000 m 0 %, 8 000–10 000 m −1,8 %; Samples alle 10 m | typische-60-min-Golden, Abfahrt, Segmente, Lap-Wrap, `gradeAt`                          |
| `kom-climb` | 2 500 m, non-loop, konstant 8 % (100 → 300 m), Samples alle 10 m                                                                                                                                                                                       | climb-250w-10min (600 s × 3,44 m/s = 2 064 m < 2 500 m, Route-Ende wird nicht erreicht) |

Verhalten am non-loop-Ende (nur für spätere echte Strecken relevant): Position klemmt bei `lengthM`; saubere Route-Ende-Semantik kommt mit E4. E3 definiert nur: kein Wrap, keine Lap-Events, `elevationAt` hält Endwert.

### 5.4 Summen, Auto-Pause, Trainer-Rate-Limit

**Summen (pro nicht pausierten Tick):**

- `distanceM += v · dtS` (Odometer); `routePosM = loop ? distanceM mod lengthM : min(distanceM, lengthM)`; Lap-Wrap ⇒ `lap += 1` + `lap.completed`.
- `elevationGainM += max(0, elevationAt(routePosM_neu) − elevationAt(routePosM_alt))` (nur positive Deltas).
- `energyKj += P_roh · dtS / 1000` (Rohleistung, nicht η-beaufschlagt – zählt die Arbeit an den Pedalen wie übliche Trainingsplattformen).
- `tS += dtS` nur wenn nicht pausiert.

**Auto-Pause-Zustandsmaschine:** `stationaryS` akkumuliert, solange `speedMps < 0,5 ∧ cadenceRpm = 0` (Rohwert; Datenausfall zählt als 0); ab 5 s ⇒ `paused = true`, Summen und Integration frieren ein, Trainer hält letzten Grade (keine neuen Kommandos außer Resume). Resume: `cadenceRpm > 0 ∨ P_roh > 0` ⇒ `paused = false`, `stationaryS = 0`, ein frisches Trainer-Kommando. Auto-Pause ist transparent über `snapshot.paused` (HUD); kein neues Event nötig. Ausnahme: ein `ride.clockSkipped`-Event wird ergänzt (Begründung: Auditierbarkeit großer Uhr-Lücken für die spätere Server-Plausibilität; Typ-Erweiterung in `packages/shared`,schema-versioniert).

**Trainer-Kommando-Pfad (Strategie A, Default-Kandidat; Mathematik laut Roadmap E2, E3 integriert sie in den Tick – Koordination §5.9):**

```ts
const cadenceRps = cadenceRpm / 60;
const vv = cadenceRps * gear.ratio * wheelCircM; // virtuelles Tempo
const Fv = m * g * sin(θ) + m * g * cos(θ) * crr + 0.5 * rho * cda * vv * vv;
const Ft = (Fv * gear.ratio) / physicalRatio; // Kraft am Trainer
const vt = cadenceRps * physicalRatio * wheelCircM; // Trainer-Tempo
const gradeEffPct = clamp(
  100 * tan(asin(clamp((Ft - cwT * vt * vt) / (mT * g) - crrT, -1, 1))),
  -10,
  20,
);
```

Mit `θ` aus dem auf −5 % geklemmten Route-Grade, `mT` = 83 kg (Default, kalibrierbar als Daten), `crrT`/`cwT` = unsere gesendeten Werte (`crr = 0,004`, `cwKgPerM = 0,5 · ρ · CdA`). Gesendet wird `TrainerCommand { type: 'simulation', gradePct: gradeEffPct, windMps: 0, crr, cwKgPerM }` (FTMS `0x11`; Encoder/Write-Queue gehört E2). Strategie B (`0x05` Target Power) hinter demselben Schalter, mit denselben Rate-Limit-Regeln; Delta-Schwelle für B: Vorschlag 2 W (nicht aus Doku belegt, Kalibrierung mit E2).

**Rate-Limit (deterministisch über Tick-Zähler, kein Wanduhr-Zugriff):** reguläre Kommandos frühestens 5 Ticks nach dem letzten (4 Hz), nur wenn `|gradeEff − letzterGesendeter| ≥ 0,1 %` (Glättung §4 `03`); Gangwechsel sendet sofort (Latenzziel < 300 ms) und re-armed das Intervall; `cadenceRpm = 0` ⇒ kein neues Kommando (letzten Grade halten). Serialisierung (eine ausstehende FTMS-Prozedur) übernimmt die E2-Write-Queue.

### 5.5 Rider-Profil-Screen & lokale Speicherung (E3)

- **Schema** (`packages/shared`, Zod): `RiderProfile` aus `03` §2a inkl. `ftpW?`/`maxHrBpm?` (reserviert, E3 ohne UI-Feld), `gearPreset: 'zwift-like-24'`, `units`. Gleiche Schema-Datei wird E5 als `PUT /v1/me/profile`-Vertrag wiederverwendet (ADR-005: Client-Cache in `sync/`).
- **Store:** minimaler `apps/web/src/sync/profile-store.ts` – IndexedDB (plain Web-API, **keine** `idb`-Lib, keine neue Abhängigkeit), versioniertes Schema (`schemaVersion: 1`), Lade-/Speicher-API, Migration-Haken für E5 („ersetzt lokales Profil aus E3, Migration lokal → Account"). ADR-003 ist ersetzt (ADR-005): die lokale DB ist bewusst nur Cache auf dem Weg zum Account.
- **Screen** (`apps/web/src/ui/profile`): Formular mit Feldern aus AK8, Inline-Validierung aus dem Zod-Schema, Speichern ⇒ Store, Laden beim App-Start; Composition Root übergibt die gefrorenen `RiderParams` an `createEngine` (Änderungen wirken erst nächste Fahrt, AK8).
- **HUD** (minimal erweitert, `apps/web/src/ui`): Distanz, Tempo, Hm, kJ aus dem Snapshot; `dataAgeS`-Warnung bei Datenausfall; `paused`-Anzeige. Keine visuellen Baselines nötig (plain DOM, E2E-Assertions reichen; Motive-Liste `10-testing.md` §7 bleibt unangetastet).

### 5.6 Golden-Fahrten, Properties, 60-Minuten-Abnahme

**Input-Format** `fixtures/rides/<name>.input.json` (Zod-geparst, Fixture ist CODEOWNERS-geschützt):

```jsonc
{
  "routeId": "flat-loop",
  "profile": {/* RiderProfile */},
  "trainerStrategy": "effectiveGrade",
  "initial": { "gearIndex": 11, "speedMps": 0, "routePosM": 0 },
  "samples": [{ "tS": 0, "powerW": 200, "cadenceRpm": 90, "hrBpm": 130, "shift": 0 }],
} // 1-Hz-Reihe
```

Runner: Zero-Order-Hold – jede 1-Hz-Zeile gilt für genau 20 Ticks à 0,05 s; Shifts gelten auf dem Tick nach ihrer Sekunde. Reine Engine (kein BLE, kein DOM).

**Golden-Format** `<name>.golden.json`: `{ distanceM, elevationGainM, energyKj, tS, endSpeedMps, laps, segments, commandCount, commandHash, schemaVersion }`, 6 Nachkommastellen, exakter Vergleich; `commandHash` = SHA-256 (kanonische Reihenfolge) über die Kommandofolge, berechnet vom Test-Harness, nicht in der Engine.

**Die vier Golden-Fahrten:**

| Name                 | Route                                                                   | Profil                                                                                                                                                           | Erwartung (Rechenwerte)                                                        |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `flat-200w-60min`    | `flat-loop`                                                             | 200 W konstant, 90 rpm, Standstart                                                                                                                               | Distanz ≈ 33,78 km (Referenz 33,88 km, −0,28 % ⇒ AK10 ± 2 %); kJ ≈ 720; Hm = 0 |
| `typical-60min`      | `test-loop`                                                             | 1-Hz-Reihe: 10 min 150 W Warm-up, 3×(8 min 230 W + 4 min 110 W), ein 90-s-Null-Block (⇒ Ausrollen + Auto-Pause + Resume), Rest 150 W; Cadenz 90, im Null-Block 0 | wrappt ~3 Laps, Hm > 0, Pause-Phase eingefroren; exakte Werte im Golden        |
| `climb-250w-10min`   | `kom-climb`                                                             | 250 W konstant                                                                                                                                                   | Endtempo ≈ 12,4 km/h, Distanz ≈ 2 064 m, Hm ≈ 165 m                            |
| `descent-coast-5min` | `test-loop`, Start bei 5 600 m (KOM-Gipfel), 0 W, Rolling-Start 30 km/h | Terminalgeschwindigkeit am −6 %-Stück ≈ 54,9 km/h; kJ bleibt 0; Übergänge 0/4/8/−6/−1,8 % ⇒ reale Kommando-Folge im Hash; Lap-Wrap                               |

XP/Volts-Felder im Golden-Schema bleiben für E6 reserviert (`schemaVersion`), Server-Gegenprobe (`POST /v1/rides`) für E5 – dieselben Fixtures laufen später dort weiter (`10-testing.md` §3).

### 5.7 Datei-Layout (keine neuen Abhängigkeiten)

```
packages/engine/src/
  index.ts                  öffentlicher Einstieg: createEngine, RideSnapshot (DeepReadonly), Intents
  physics/    forces.ts integrate.ts params.ts (+ .test/.property)
  elevation/  profile.ts route.ts data/{flat-loop,test-loop,kom-climb}.ts (+ .test)
  trainer/    gradeMap.ts commands.ts (+ .test/.property)   // Strategien A/B aus E2, Integration+Rate-Limit hier
  gears/      (E2 liefert Presets/Shifts; E3 konsumiert GearModel)
  internal/   state.ts tick.ts sums.ts autopause.ts catchup.ts ratelimit.ts (+ .test, mutierbarer RideState)
  golden/     golden.test.ts (Runner, liest fixtures/rides via Node nur im Test)
packages/shared/src/
  profile.ts   RiderProfile + Zod-Schema        // E5-API wiederverwendet
  ride.ts      TrainerCommand, RideEvent (+ ride.clockSkipped), TickInputs-Typen
apps/web/src/
  ui/profile/  Profil-Screen
  sync/        profile-store.ts (IndexedDB, schemaVersion 1)
  game/        engine-worker.ts (Worker-Bootstrap), engine-link.ts (Main-Thread-RPC)
fixtures/rides/  4× {input,golden}.json (CODEOWNERS-geschützt)
```

Grenzen (depcruise bleibt unangetastet): engine → nur shared; `internal/**` nur aus engine; ble → nur shared (TrainerCommand-Typ liegt deshalb in shared); drei nur in world/avatar/garage (unberührt); Web-Worker-Bootstrap in `apps/web`, damit engine DOM-/Worker-frei bleibt und E5 serverseitig läuft. Neue Abhängigkeiten: **keine** (zod, vitest, fast-check, Stryker, Playwright kommen aus E0; IndexedDB/Worker per nativer API).

### 5.8 Hardware vs. vorab baubar

**Vorab ohne Hardware baubar & beweisbar (Sim/Unit/Golden/Property/Mutation):** AK1–AK10 komplett – die Engine ist per Konstruktion hardwarefrei (virtuelles Tempo nur aus Leistung). E2E im Sim-Modus mit Fake-Trainer und Test-Uhr. Die inverse Sim-Trainer-Maschine (Widerstand → Watt) gehört zu E2s Strategie-Abnahme; E3 prüft Kommandos auf Engine-Ebene (Golden-Hash).

**Benötigt Henrys Hardware / manuell (nicht AK dieses PRs):**

1. **Abnahme-Hälfte „Test-Anstieg fühlt sich wie Anstieg an"**: echte Rolle, `test-loop` fahren, subjektiv 0/4/8 % vergleichen (Gegenprobe: dieselbe Passage in Zwift). Voraussetzungen aus E2: Strategie-Entscheidung (ADR-001-Nachtrag), `mT`-Kalibrierung (Sim 5 %, 200 W konstant, Kadenz messen), Grade-Limit/Sättigung ~16 % am Berg in hohen Gängen.
2. **Background-Tab real:** Page-Freezing-Verhalten Chromes bei > 5 min verstecktem Tab mit aktiver Web-Bluetooth-Verbindung – aus Doku nicht verifizierbar; Henry fährt `?sim=1` mit gewechseltem Tab (Ergebnis in `01-architecture.md`/open-questions nachtragen).
3. **Echte Watt-Reihen:** sobald E1-Hardware-Fixtures liegen, eine echte 1-Hz-Reihe als zusätzliche Golden-Fahrt (Lücken, Spitzen, Null-Kadenz-Phasen realer Trainer).

### 5.9 Koordination mit E2 (parallele Worktrees)

Overlap in `packages/engine`: E2 liefert `gears/` (24er-Preset, Shift-Intents) und die **Strategie-Mathe** A/B; E3 integriert beide in den Tick (Route-Grade + Gang → Kommando, Rate-Limit) und konsumiert `GearModel`/Strategiefunktionen über die öffentlichen Typen aus `01-architecture.md`. Merge-Reihenfolge bevorzugt: E2 zuerst, E3 rebase. Fällt E2 aus, implementiert E3 die Strategie-A-Formel aus `03` §4 selbst in `trainer/` (Formel steht fest; nur `mT` ist Messgut) und das Gang-Preset aus der `03` §3-Tabelle; E2 ersetzt das dann. Datei-Ownership-Konflikt: keine gemeinsamen Dateien, nur gemeinsames Paket – depcruise bleibt Richtlinie.

## Nicht-Ziele

- Windschatten, Bots, Power-ups (E8; `cdaEff`-Seam existiert, Physik-Term ist vorbereitet).
- 3D-Streckendarstellung, echte Strecken, Meshes (E4 world/).
- ERG-Workouts nach `ftpW`, HR-Zonen, Posen (E10); FTP-Feld nur reserviert.
- Server-Upload, Plausibilitätsprüfung, Profil-Sync (E5; Schema vorbereitet).
- FTMS-Byte-Encoder, Write-Queue, Control-Point-Lebenszyklus, Kalibrier-Assistent (E2).
- Neue Gang-Presets über `zwift-like-24` hinaus; GPX-Import (E10).

## Offene Fragen / Risiken

- T1-Entscheidung (Engine im Worker): ADR-011 von Henry im Chat am 2026-11-27 angenommen.
- CdA-Schätzfaktor: Anker-reproduzierend (0,32 bei 185 cm/75 kg) statt Literaturwert – ok?
- Mutation-Scope um `elevation/`+`internal/` erweitern (Doku-Update §9, keine Lockerung)?
- Strategie-B-Delta (2 W Vorschlag) und `gradeEff`-Clamp [−10, +20] aus `03` §4-Skizze vs. echtem FTMS-Bereich (±40 %) – E2-Messung klärt.
- Merge-Reihenfolge E2/E3 (§5.9) – wer zuerst?
- E2E Background-Tab in headless CI stabil? Sonst Unit + Henry-Manuelltest (dokumentiert, kein Gelockere).
- Gang-Zwischenwerte geometrisch interpoliert (Anker 1/14/24 verifiziert, Rest `03` §3 ⚠️) – E2-Kalibrierung prüft nur `physicalRatio`, nicht die Tabelle.

## Doku-Updates (Pflicht beim Abschluss)

- [ ] Roadmap-Checkboxen E3 abhaken; Abnahmezeile mit Sim-Ergebnis + Hardware-Vermerk füllen.
- [x] `docs/03-engine-physics.md`: Worker, CdA-Schätzformel, `gradeAt` (25 m), Catch-up und `clockSkipped` dokumentiert. `mT = 83 kg` bleibt bis zur E2-Kalibrierung vorläufig.
- [x] `docs/open-questions.md`: T1-Implementierung mit ausstehender ADR-Freigabe, T9-Laufzeit und manuelle Prüfungen dokumentiert.
- [x] ADR-011 „Engine im Dedicated Web Worker" als Vorschlag angelegt; von Henry im Chat am 2026-11-27 angenommen.
- [x] `docs/10-testing.md` §9: Tatsächlichen Mutation-Scope einschließlich `elevation/`, Routendaten und `internal/` dokumentiert; Konfiguration unverändert.
