# Spec E10-09 – Kingsmith WalkingPad R2 (Gehen/Laufen)

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, Checkbox „Kingsmith WalkingPad R2 als Laufband-Gerät (Gehen/Laufen)“
- **Status:** Entwurf (Plan). Nichts implementiert, nichts softwaregeprüft, nichts an Hardware geprüft, nichts bereitgestellt.
- **Betroffene Module:** `packages/shared` (Gerätevertrag, Aktivitätsart), `packages/ble` (Laufband-Adapter, Parser, Sim-Gerät), `packages/engine` (Geh-Modus im Tick), `packages/rules` (Belohnungen für Gehen), `apps/web/src/{rideDevices,ui,avatar,game}`, `apps/server` (Replay/Belohnung, Aufnahme), `debug/ble.html`.

## Ziel

Henry kann auf einem Kingsmith WalkingPad R2 in der Voltonaut-Welt gehen oder laufen. Die gemessene Bandgeschwindigkeit bewegt einen gehenden Avatar über dieselbe Strecke. Distanz, Zeit, Puls und Belohnungen werden wie bei einer Fahrt aufgezeichnet. Der Sim-Modus bietet ein simuliertes Laufband.

## Ausgangslage und Wissensstand

Voltonaut ist bisher reines Radfahren: Die Engine leitet das virtuelle Tempo aus **Leistung** ab (`03-engine-physics.md` §2). Ein Laufband liefert keine Leistung, sondern **Bandgeschwindigkeit**. Das R2 hat keine Steigungsverstellung. Gehen ist daher eine eigene Aktivitätsart, kein weiterer Trainertyp.

Protokoll des R2 — alles ⚠️ **UNVERIFIZIERT**, bis ein Mitschnitt vorliegt:

| Variante                        | Merkmale aus Fremdquellen                                                                                                                          | Bezug zum R2                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| FTMS Treadmill                  | Service `0x1826`, Treadmill Data `0x2ACD` (notify), Control Point `0x2AD9`. Laut `walkingpad-controller` haben FTMS-Geräte Namen mit `KS-HD-`.     | ❓ Nur KS-Z1D als getestet genannt.                   |
| Kingsmith „WiLink“ (proprietär) | Vendor-Service `0xFE00`, Notify `0xFE01`, Write `0xFE02`; Rahmen `F7 … Prüfsumme FD` (ph4-walkingpad, für A1 dokumentiert, R1 Pro laut Community). | ❓ R2 in keiner Quelle bestätigt.                     |
| Fernbedienung / KS-Fit-App      | Herstellerseite: manuelle Steuerung per Fernbedienung oder KS Fit App; Kopplung über die App, nicht über die Bluetooth-Liste des Systems.          | Deutet auf proprietären Pfad hin, belegt aber nichts. |

Konsequenz: **Teil A (Sniffer-Mitschnitt) entscheidet das Protokoll.** Kein Parser wird vor dem Mitschnitt als „R2-Unterstützung“ ausgegeben.

## Sicherheitsgrundsatz (zusätzlich zu AGENTS.md §3.9)

Ein Laufband bewegt eine Person. **Bandsteuerung (Start, Stopp, Geschwindigkeit, Modus) ist in dieser Spec ausgeschlossen.** Voltonaut verbindet sich lesend. Keine Writes außer einem durch den Mitschnitt belegten, rein lesenden Abo-/Abfrageverfahren (z. B. der Statusabfrage der WiLink-Variante, falls ohne sie keine Daten kommen). Das Band wird ausschließlich über Fernbedienung oder Gerät bedient. Ein späteres Steuern braucht eine eigene Spec, ein ADR und Henrys Freigabe. Voltonaut gibt nie aus, dass das Band „gestoppt“ sei; es zeigt nur gemessene Geschwindigkeit.

## Form und Ownership (Vorschlag, im ADR zu bestätigen)

1. **Aktivitätsart als Fahrtparameter (gewählt):** `activity: "ride" | "walk"` wird beim Fahrtstart festgelegt und ist Teil von Aufnahme, Checkpoints und Server-Replay. Die Engine bleibt einziger Besitzer von `RideState`; im Geh-Modus ist das virtuelle Tempo die gemessene Bandgeschwindigkeit (geglättet, mit Datenfrische wie bei `trainer.data`), Gänge und `TrainerCommand`s entfallen.
2. **Laufband als Fake-Trainer mit erfundener Leistung:** verworfen. Erfundene Watt verfälschen Belohnungen, Aufnahmen und Strava, und die Physik würde Steigungen als Tempoverlust darstellen, die das Band nicht fährt.

Vertragsänderungen (alle Aufrufer gemeinsam, keine V1/V2-Fassade, AGENTS.md §9):

```ts
// packages/shared
type DeviceKind = "trainer" | "treadmill" | "heartRate" | "controller" | "keyboard";
type ActivityKind = "ride" | "walk";
// neues DeviceEvent
| {
    readonly type: "treadmill.data";
    readonly tS: Seconds;
    readonly speedMps?: Mps;        // Bandgeschwindigkeit
    readonly distanceM?: Meters;    // Gerätezähler, nur Anzeige/Abgleich
    readonly steps?: number;        // falls geliefert
    readonly beltRunning?: boolean; // falls geliefert
  }
// TickInputs erhalten beltSpeedMps; im "walk"-Modus ignoriert die Engine powerW/shifts.
```

`three` bleibt in `apps/web/src/{world,avatar}`. BLE-Bytes bleiben in `packages/ble`. dependency-cruiser-Regeln bleiben unverändert.

## Implementationsplan

### Teil A – Protokoll klären (Hardware, blockierend für C)

1. `debug/ble.html`: `optionalServices` um `0xFE00` (und ggf. weitere im GATT-Export gefundene Vendor-Services) ergänzen; `0x1826` ist schon enthalten.
2. Henry nimmt mit dem Sniffer auf (KS-Fit-App vorher schließen, Band nur per Fernbedienung bedienen): Advertising-Name, GATT-Export, Device Information `0x2A26`/`0x2A28`, 60 s Stillstand, dann je 30 s bei 1,0 / 3,0 / 6,0 km/h mit Markern, Stopp per Fernbedienung, Moduswechsel Manuell/Auto, ggf. Laufmodus.
3. Export → `fixtures/ble/walkingpad-r2-<datum>.json` plus Herkunftsnotiz wie `zwift-play-hardware-20261120.md` (Geräte-ID/User-Agent anonymisieren, Bytes unverändert).
4. Befund in `docs/02-bluetooth.md` neuer Abschnitt „Laufband: Kingsmith WalkingPad R2“; ⚠️ → ✅ nur für Belegtes. Firmware- und Kalibrierungslücken getrennt nennen.
5. Falls nur über den proprietären Pfad Daten kommen und dafür ein Write nötig ist: diesen einen Write als Befund dokumentieren und vor Teil C Henry zur Freigabe vorlegen (Sicherheitsgrundsatz).

### Teil B – Verträge und Aktivitätsart (ohne Hardware umsetzbar)

1. ADR-025 „Aktivitätsart Gehen und Laufband-Geräte“: Aktivitätsart, `treadmill`-Gerätetyp, Ausschluss der Bandsteuerung, Belohnungsprinzip.
2. `packages/shared`: `DeviceKind`, `ActivityKind`, `treadmill.data`, Zod-Schemas für Aufnahme/Checkpoint/Upload um `activity` erweitern; Contract-Fixtures unter `fixtures/api/` ergänzen (geschützt → Henrys Freigabe).
3. `packages/engine`: Geh-Modus im Tick — Tempo = frische, EMA-geglättete Bandgeschwindigkeit (Rampe begrenzen, damit Avatar nicht springt), Datenausfall > 3 s ⇒ Tempo → 0, Auto-Pause bei Band < 0,2 m/s für 5 s. Höhe/Steigung aus der Route nur für Anzeige und Höhenmeter, kein Einfluss aufs Tempo. Keine Gänge, keine `TrainerCommand`s. `NativeTickFacts` liefern mechanische Arbeit 0 bzw. ein ausgewiesenes Schätzmodell (Entscheidung im ADR).
4. `packages/rules`: XP/Volts für Gehen (z. B. distanz- und zeitbasiert statt kJ), deckeln analog Tagesbudget; Golden-Fixtures neu, bestehende Rad-Goldens unverändert.
5. `apps/server`: Replay (ADR-016) und Reward-Quotes (ADR-024) nach `activity` verzweigen; TCX kennt nur `Running`/`Biking`/`Other`: Gehen ⇒ `Other`, Laufen ⇒ `Running`; Strava-Upload mit Sportart Walk/Run.

### Teil C – BLE-Adapter (nach Teil A)

1. `packages/ble/src/treadmill/`: reiner Parser je belegter Variante (`parseTreadmillData` für FTMS `0x2ACD` und/oder `parseWiLinkStatus` für `0xFE01`, inkl. Prüfsummenprüfung), Adapter auf Basis von `adapterShell`/`webBluetoothConnection`, Reconnect wie Trainer, eigene Write-Queue nur falls Teil A einen Pflicht-Write belegt.
2. Unbekannte Rahmen erzeugen keine Daten; falsche Prüfsumme ⇒ verworfen, gezählt, nicht interpretiert. Unbelegte Felder mit `// UNVERIFIED: docs/02-bluetooth.md#laufband-kingsmith-walkingpad-r2`.
3. `packages/ble/src/sim/fakeTreadmill.ts`: Sim-Laufband (Tastatur ↑/↓ = ±0,5 km/h im Sim, 0,5–6 km/h Gehbereich, R2-Laufmodus bis 10 km/h ⚠️), deterministisch über Seed/Sim-Uhr.

### Teil D – Spieloberfläche

1. Ingame-Menü → Geräte-Overlay: Abschnitt „Laufband“ mit „Laufband verbinden“ (nativer Picker direkt am Klick). Fahrtstart-Auswahl „Radfahren / Gehen“; Gehen nur wählbar mit verbundenem Laufband oder im Sim.
2. HUD im Geh-Modus: Tempo (km/h und min/km), Distanz, Zeit, Puls, Höhenmeter; keine Gang-/Watt-Anzeige. Hinweis „Band wird nur am Gerät/der Fernbedienung bedient“.
3. `apps/web/src/avatar`: Geh-/Laufanimation (Schrittfrequenz aus Tempo, oder aus `steps`, falls geliefert), Avatar ohne Rad. Assets nur lizenziert über `mise run assets`.
4. Bots/Windschatten im Geh-Modus deaktiviert (Nicht-Ziel), Kamera für Fußgängerhöhe.

### Teil E – Abnahme

1. `mise run check` grün, `mise run check:mutation` (engine/rules betroffen).
2. Reviewer-Agent gegen diese Spec und `_review-checklist.md`.
3. Gemeinsame Probefahrt/-gang mit Henry auf dem R2: 10 min Gehen, Tempo-/Distanzabgleich mit Geräteanzeige, Disconnect/Reconnect während des Gehens.

## Abnahmekriterien

- [ ] AK1 – Mitschnitt des R2 liegt als Fixture vor; `02-bluetooth.md` nennt Service, Characteristics, Rahmenformat, Firmware (oder ausdrücklich „unbekannt“).
- [ ] AK2 – Parser dekodiert jede Geschwindigkeitsmarke des Mitschnitts (1,0/3,0/6,0 km/h) mit ≤ 0,1 km/h Abweichung zur Geräteanzeige; Rahmen mit falscher Prüfsumme/abgeschnittene Rahmen liefern keine Werte (Property-Test).
- [ ] AK3 – Der Adapter schreibt im Replay außer belegten Lese-/Abo-Verfahren **keine** Bytes; ein Test schlägt bei jedem anderen Write fehl.
- [ ] AK4 – Engine im Geh-Modus: konstante 1,25 m/s über 600 s ⇒ Distanz 750 m ± 1 m (Golden); Datenausfall > 3 s ⇒ Tempo 0; keine `TrainerCommand`s; Rad-Goldens unverändert.
- [ ] AK5 – Rules: Belohnung für Golden-Gang deterministisch, Client-Vorschau = Server-Quote (Contract-Test).
- [ ] AK6 – E2E im Sim (`?sim=1`): Gehen wählen, Sim-Laufband auf 4 km/h, Avatar bewegt sich, HUD ohne Gang/Watt, Menü öffnen lässt Gehen weiterlaufen; visuelle Baseline für Geh-HUD und Avatar neu (mit Freigabe).
- [ ] AK7 – TCX-Export einer Geh-Aufnahme hat `Sport="Other"` (Laufen: `Running`) und keine Watt-Felder; Strava-Upload nennt Walk/Run.
- [ ] AK8 – Hardwareabnahme mit Henry dokumentiert (sonst Status „softwaregeprüft, Hardwareabnahme offen“).

## Testplan (`docs/10-testing.md`)

| AK  | Ebene                 | Datei / Fixture                                                             |
| --- | --------------------- | --------------------------------------------------------------------------- |
| AK1 | Doku + Fixture-Schema | `fixtures/ble/walkingpad-r2-*.json`, `packages/ble/src/fixtureSchema.ts`    |
| AK2 | BLE-Replay + Property | `packages/ble/src/treadmill/parse.replay.test.ts`, `parse.property.test.ts` |
| AK3 | BLE-Replay            | `packages/ble/src/treadmill/adapter.replay.test.ts`                         |
| AK4 | Golden + Property     | `packages/engine/src/internal/walk.golden.test.ts`, `fixtures/rides/walk-*` |
| AK5 | Golden + Contract     | `packages/rules/src/walkRewards.test.ts`, `fixtures/api/*walk*`             |
| AK6 | E2E + Visual          | `apps/web/e2e/walk-sim.spec.ts`                                             |
| AK7 | Unit                  | `apps/web/src/rideRecording` bzw. Server-TCX-Test                           |
| AK8 | Hardware (manuell)    | Protokoll in dieser Spec                                                    |

## Nicht-Ziele

- Bandsteuerung (Start/Stopp/Tempo/Auto-Modus), auch nicht „nur Stopp im Notfall“.
- Steigung am Band (R2 hat keine), Laufband-ERG/Workouts.
- Bots, Windschatten, Power-ups und Gruppenfahrten im Geh-Modus.
- Andere WalkingPad-Modelle (A1, C2, Z1 …) — nur als Nebenprodukt, falls dasselbe Protokoll belegt ist.
- Verschlüsselte/Cloud-Pfade der KS-Fit-App.

## Offene Fragen / Risiken

- ❓ Protokoll des R2 (FTMS vs. WiLink vs. beides) und Firmware — Teil A.
- ❓ Braucht der WiLink-Pfad einen periodischen Status-Write, damit Daten kommen? Dann ist auch dieser Write ein Freigabepunkt.
- ❓ Lässt das R2 gleichzeitig KS-Fit-App/Fernbedienung und Voltonaut zu? Fernbedienung ist Funk, ggf. nicht BLE.
- ❓ Belohnungsmodell für Gehen (Fairness gegenüber Radfahren, Tagesbudget) — Entscheidung im ADR, mit Henry.
- Risiko: BLE-Budget — Laufband + Pulsgurt sind 2 Verbindungen, unkritisch.
- Risiko: Avatar-Geh-Animation braucht neue lizenzierte Assets.

## Doku-Updates (Pflicht beim Abschluss)

- [ ] Roadmap-Checkbox E10 · [ ] `02-bluetooth.md` Laufband-Abschnitt · [ ] `03-engine-physics.md` Geh-Modus · [ ] `01-architecture.md` Kerntypen · [ ] `06-gamification.md` · [ ] ADR-025 · [ ] `open-questions.md`

## Quellen

- ph4-walkingpad (A1, WiLink-Protokoll): https://github.com/ph4r05/ph4-walkingpad
- walkingpad-controller (FTMS `KS-HD-` und Legacy-WiLink): https://pypi.org/project/walkingpad-controller/0.4.2/
- Herstellerseite R2: https://www.walkingpad.com/products/walkingpad-r2-foldable-treadmill
- KS-Fit-App, Kopplungshinweis: https://uk.walkingpad.com/pages/ks-fit-app
- FTMS-Spezifikation: https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/
