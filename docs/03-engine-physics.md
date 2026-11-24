# 03 – Engine & Physik

`engine/` ist der **einzige** Besitzer von `RideState`. Eingaben: `DeviceEvent`s (Watt, Kadenz, HR, Tasten), Route (`gradeAt`), `RiderParams`. Ausgaben: `RideSnapshot`, `RideEvent`s, `TrainerCommand`s und native Tickfakten.

## 1. Tick (20 Hz, reine Funktion)

```ts
function tick(
  s: RideState,
  in_: TickInputs,
  route: Route,
  p: RiderParams,
  dtS: number,
): { state: RideState; events: RideEvent[]; trainer?: TrainerCommand };
interface TickInputs {
  powerW: number;
  cadenceRpm: number;
  hrBpm?: number;
  shifts: number /* +n hoch, -n runter */;
  useItem: boolean /* Power-up-Taste seit dem letzten Tick */;
  mode: RideMode /* angeforderter Spielmodus, ADR-028 */;
}
```

Reihenfolge: Schalten anwenden → Messwerte glätten (EMA, τ ≈ 1 s für Anzeige; Physik nutzt Rohwatt) → Spielmodus wechseln und seine Tasten-Intents anwenden (auch pausiert, ADR-028) → Auto-Pause → Steigung holen → Tempo integrieren (mit dem Physik-Effekt des Modus) → Position/Höhe/Summen → Segment-/Lap-Grenzen prüfen → Modus-Schritte nach der Bewegung (z. B. Item-Boxen) → ggf. Trainer-Kommando. Modus-Effekte wirken nie auf das Trainer-Kommando.

Datenausfall: kein `trainer.data` seit > 3 s → `powerW = 0` (Ausrollen), HUD-Warnung. Pause automatisch, wenn `speedMps < 0.5` und `cadence = 0` für 5 s.

Ab E3 läuft die Engine im Dedicated Web Worker (ADR-011, Freigabe ausstehend). `advance(elapsedS)` verarbeitet feste 0,05-s-Ticks mit einem Akkumulator. Pro Aufwachung sind höchstens 120 Ticks erlaubt. Der Rest erzeugt `ride.clockSkipped`. Ohne frische Trainerdaten setzt die Engine nach mehr als 3 s auch die Rohkadenz auf null. Nach 100 stehenden Ticks greift Auto-Pause am Anfang von Tick 101. Leistung oder Kadenz lösen die Pause.

[E6-03](specs/E6-03-native-ride-facts.md) gibt zusätzlich zu jedem tatsächlich verarbeiteten Tick `NativeTickFacts` zurück. Die Werte enthalten effektive Rohleistung und Rohkadenz nach Frischeprüfung sowie die lokalen Beiträge zu Zeit, Strecke, positiver Höhe und mechanischer Arbeit. Pausierte Ticks haben vier Nullbeiträge. Das äußere Array und jeder Eintrag sind eingefroren. Die Fakten ändern weder Advancepartition noch Snapshots, Events oder Trainerkommandos. Sie sind keine Quellenfreigabe und keine Belohnungsbuchung.

[E6-04](specs/E6-04-ride-progress-journal.md) definiert diesen Typ gemeinsam in `packages/shared`; die Engine exportiert denselben Vertrag. Der Worker projiziert die Fakten genau einmal je regulärem Wake in unveränderliche, auf 120 Fakten begrenzte Checkpoints. Vorherige und aktuelle Wake-Zeit, Quelle, Takt, Revisionen, enge Physikparameter sowie Pause, Datenalter und Zeitlücken gehören dazu. Leistung und Kadenz haben keine Protokoll- oder Reward-Obergrenze; berechnete CPS-Kadenz kann größer als der FTMS-Wertebereich sein. Pulsdaten bleiben außen vor. Der Projector speichert nichts, entscheidet keine Quellen- oder Belohnungsfreigabe und verändert die bestehende Aufnahme nicht.

Die Checkpoint-Qualität ist der terminale Batch-Zustand. Pausierte Ticks haben faktisch `timeS === 0`; `timeS`, `distanceM`, `elevationGainM` und `energyKj` sind null. Bei konstanten Eingaben je Advance bedeutet terminales `paused: false`, dass der Batch keine pausierten Ticks enthält. Finales `dataAgeS` plus Faktenzahl rekonstruiert den einzigen Frischewechsel, weil frische Trainerdaten nur im ersten Tick eines Advances zurücksetzen und danach jeder Tick 0,05 s addiert. `clockSkipped` gilt für den ganzen Batch, sobald ein abgeleientes `ride.clockSkipped` vorliegt.

## 2. Physikmodell (virtuelles Tempo aus Leistung)

Kräfte am Rad (θ = atan(grade/100)):

- Steigung: `F_g = m · g · sin θ`
- Rollwiderstand: `F_r = m · g · cos θ · Crr`
- Luft: `F_a = 0.5 · ρ · CdA · (v + v_wind)² · sign(v + v_wind)`
- Antrieb: `F_p = η · P / max(v, 0.5)` (η Antrieb ≈ 0,97; Untergrenze verhindert Division durch 0 beim Anfahren)
- Integration: `m_eff · dv/dt = F_p − F_g − F_r − F_a`, `m_eff = m + I/r² ≈ m + 1,0 kg` (Laufräder). Explizites Euler bei 20 Hz ist ausreichend; `v ≥ 0` clampen (kein Rückwärtsrollen in v1).

Defaults (`RiderParams`): Fahrer 75 kg, Rad 8 kg, CdA 0,32 m² (Oberlenker), Crr 0,004 (Asphalt), ρ 1,225 kg/m³, g 9,81. Plausibilitätstest: 200 W, 0 %, 83 kg → stationär ≈ 33–34 km/h; 250 W bei 8 %, 83 kg → ≈ 12 km/h.

**Wichtig:** Das _virtuelle Tempo_ hängt nur von **gemessener Leistung** ab, nicht vom Gang. Der Gang ändert, **wie** der Fahrer die Leistung erzeugt (Kraft vs. Kadenz) – genau wie draußen. Dadurch ist die Physik unabhängig vom Trainer-Mapping und im Sim-Modus trivial testbar.

## 2a. Rider-Profil (in der App konfigurierbar)

Alle Physik- und Gangparameter kommen aus einem **Rider-Profil**, das der Nutzer im Einstellungs-/Profil-Screen pflegt (synchronisiert mit dem Account, ADR-005; offline lokal).

```ts
interface RiderProfile {
  displayName: string;
  massKg: number; // Beispiel-Default 75
  heightCm: number; // Beispiel-Default 185 → Avatar-Skalierung, CdA-Schätzung
  ftpW?: number; // später (Posen, Zonen, Workouts)
  maxHrBpm?: number; // später (HR-Zonen)
  bike: {
    massKg: number;
    chainringTeeth: number;
    cogTeeth: number /* Zwift Cog: 14 */;
    wheelCircM: number;
  };
  gearPreset: string; // z. B. 'zwift-like-24'
  units: "metric" | "imperial";
}
```

- Validierung: Masse 30–200 kg, Größe 120–220 cm, Kettenblatt 28–60 Z., Radumfang 1,9–2,4 m.
- CdA-Schätzung in E3: `0,32 · BSA(heightCm, massKg) / BSA(185, 75)` mit DuBois `BSA = 0,007184 · heightCm^0,725 · massKg^0,425`. Das Default-Profil ergibt exakt 0,32 m². Ein CdA-Feld im Profil ist noch nicht implementiert.
- Änderungen an Masse während einer Fahrt erst bei der nächsten Fahrt wirksam (Plausibilitätsprüfung am Server nutzt den Wert, der zu Fahrtbeginn galt).

## 3. Virtuelle Gänge

24 Gänge, 1×-Schaltung wie bei Zwift (Wahoo: „24 virtual gears in a linear single-step progression"). Zwift-Standard laut Zwift Insider: Gang 1 = 0,75, Gang 14 = 2,82, Gang 24 = 5,49 (⚠️ Zwischenwerte nicht verifiziert). Unsere Tabelle: geometrisch zwischen diesen Ankern (Gang 1–14 Schritt ≈ +10,7 %, 14–24 ≈ +6,9 %). Startgang 12. Tempo-Spalte = theoretische Geschwindigkeit bei 90 rpm, Radumfang 2,105 m (700×25c).

| Gang | Übersetzung | km/h @ 90 rpm |
| ---- | ----------- | ------------- |
| 1    | 0.75        | 8.5           |
| 2    | 0.83        | 9.4           |
| 3    | 0.92        | 10.5          |
| 4    | 1.02        | 11.6          |
| 5    | 1.13        | 12.8          |
| 6    | 1.25        | 14.2          |
| 7    | 1.38        | 15.7          |
| 8    | 1.53        | 17.4          |
| 9    | 1.69        | 19.3          |
| 10   | 1.88        | 21.3          |
| 11   | 2.08        | 23.6          |
| 12   | 2.30        | 26.1          |
| 13   | 2.55        | 29.0          |
| 14   | 2.82        | 32.1          |
| 15   | 3.01        | 34.3          |
| 16   | 3.22        | 36.6          |
| 17   | 3.44        | 39.1          |
| 18   | 3.68        | 41.8          |
| 19   | 3.93        | 44.7          |
| 20   | 4.21        | 47.8          |
| 21   | 4.50        | 51.1          |
| 22   | 4.81        | 54.6          |
| 23   | 5.14        | 58.4          |
| 24   | 5.49        | 62.4          |

Tabelle als Daten (`engine/gears/presets.ts`), weitere Presets später (z. B. 2×12 „Road", feinere Abstufung).

Physische Übersetzung `R_p = chainringTeeth / cogTeeth` aus dem Rider-Profil (Cog = 14 Zähne laut Zwift Insider; Wahoo empfiehlt Kettenlinie gerade, ~3:1 z. B. 42/14). In E2 per Kalibrierung bestätigen: Trainer-Speed aus `0x2AD2` ÷ (Kadenz × Radumfang) ≈ `R_p` (sofern der Trainer Speed aus Schwungrad-Drehzahl mit Standardumfang meldet ⚠️).

## 4. Gang + Steigung → Trainer (FTMS)

Ziel: Bei gegebener Kadenz soll das Pedaldrehmoment dem entsprechen, was der virtuelle Gang auf der virtuellen Straße erzeugen würde.
Herleitung: Kurbeldrehmoment = Radkraft × Radradius × Übersetzung. Der Trainer erzeugt `F_t(v_t)` bei seiner eigenen „Radgeschwindigkeit" `v_t = ω · R_p · r`. Gewünscht ist `F(v_v) · R_v/R_p` mit `v_v = ω · R_v · r`. Also: **höherer Gang ⇒ Kraft am Trainer um Faktor `R_v/R_p` größer, ausgewertet beim virtuellen Tempo.**

Drei Strategien, umschaltbar (`trainerStrategy`), Entscheidung nach Messung in E2:

| Strategie                                 | Kommando | Idee                                                                                                                                      | Vor-/Nachteile                                                                                                                                                                             |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A: Effective Grade** (Default-Kandidat) | `0x11`   | `grade_eff = grade · k + offset(gear)`, mit `k = R_v/R_p`; Offset kompensiert Roll/Luft-Anteil. Wie BikeControl/Virtual Gears im Prinzip. | Trainer bleibt im Sim-Modus (natürliches Gefühl, schnelle Reaktion). Grade-Limit des Trainers (≈ 16 %) → hohe Gänge am Berg sättigen. Trainer-Annahmen (Gewicht) unbekannt → Kalibrierung. |
| **B: Virtual-Power ERG**                  | `0x05`   | `P_target = F(v_v) · v_v` mit `v_v` aus Kadenz × Gang.                                                                                    | Physikalisch exakt, unabhängig von Trainer-Interna. ERG-Regelschleife träge (1–2 s), Kadenzschwankungen → „Gummiband".                                                                     |
| **C: Resistance Level**                   | `0x04`   | Lookup Gang×Steigung → Level                                                                                                              | Einfach, grob; nur Notlösung.                                                                                                                                                              |

Strategie A, Formel-Skizze:

```ts
// Ziel-Kraft am Trainer (N) bei aktueller Kadenz:
const vv = cadenceRps * gear.ratio * wheelCircM; // virtuelles Tempo
const Fv = m * g * sin(θ) + m * g * cos(θ) * crr + 0.5 * rho * cda * vv * vv; // virtuelle Radkraft
const Ft = (Fv * gear.ratio) / physicalRatio; // gewünschte Kraft am Trainer
const vt = cadenceRps * physicalRatio * wheelCircM; // Trainer-Tempo
// Trainer-Modell (FTMS-Annahme): Ft = mT*g*(sinθ' + crrT) + cwT*vt²  ⇒  nach θ' auflösen
const gradeEffPct = clamp(
  100 * tan(asin(clamp((Ft - cwT * vt * vt) / (mT * g) - crrT, -1, 1))),
  -10,
  20,
);
```

`mT` (Trainer-intern angenommene Masse) ist ❓ – Startwert 75 kg + Rad, per Kalibrierung justieren: bei Sim 5 % konstant 200 W treten, Kadenz messen, mit Erwartung vergleichen. Wir senden `crr` und `cw` selbst mit, damit `crrT`/`cwT` bekannt sind.

E3 verwendet vorläufig `mT = 83 kg`, unabhängig von der Profilmasse. Das ist kein Hardware-Messwert. Die E2-Kalibrierung bleibt offen.

Glättung: Trainer-Grade nur senden bei Änderung ≥ 0,1 % oder Gangwechsel; Streckensteigung über 20–30 m glätten (`gradeAt(d, smoothingM)`); Abfahrten auf −5 % clampen (Trainer kann nicht antreiben). Gangwechsel sofort senden (Latenzziel < 300 ms).

Ohne Kadenz (`cadence = 0`): letzten Grade halten.

E3 verwendet für Physik und Trainer dieselbe Steigung aus `gradeAt(routePosM, 25)`. Die zentrale Differenz teilt am nicht geschlossenen Routenende durch die tatsächliche, geklemmte Fensterbreite. Loop-Fenster laufen über den Übergang. Reguläre Trainer-Kommandos sind fünf Ticks auseinander; Gangwechsel umgehen dieses Intervall.

Die Monotonie „höherer Gang, höherer Grade“ gilt bei Strategie A auf flacher Strecke und bergauf. Bei negativem virtuellem Radkraft-Term kann sich die Reihenfolge bergab umkehren. Ein Test belegt diese Grenze des linearen Kraftmodells; E2 muss das gewünschte Abfahrtsverhalten festlegen.

## 4a. Windschatten, Bots, Power-ups (Engine-seitig)

- **Drafting:** `cdaEff = cda × draftFactor(gapM, lateralM)`; Startwerte ⚠️: Faktor 0,70 bei 0,5–2 m direkt dahinter, linear auf 1,0 bis 10 m, seitlicher Versatz > 0,8 m halbiert den Effekt; in Gruppen hinten bis 0,60. Wirkt auf virtuelles Tempo **und** auf die Trainer-Kraft (Strategie A: Luftanteil `0.5·ρ·cdaEff·v²` im Zielkraft-Term).
- **Bots:** gleiche Physik, Leistungs-Controller pro Persönlichkeit (Ziel-W/kg ± Rauschen per Seed, Attacke am Berg, Sprint), laterale Spurwahl (Überholen). Deterministisch → Golden-Tests.
- **Power-ups (optional):** temporäre Modifikatoren (`cdaFactor`, `massFactor`, `draftBonus`) mit Dauer; jede Aktivierung als Event im Ride-Log, damit der Server identisch nachrechnet.

## 5. Trainer-Kontroll-Lebenszyklus

Verbinden liest `0x2ACC` und abonniert `0x2AD2`, bleibt aber passiv. Erst ausdrückliche Freigabe im Geräte-Overlay: `indications 0x2AD9 (+ status 0x2ADA falls vorhanden) → 0x00 Request Control ACK → 0x07 Start ACK → 0x11 neutral ACK → loop(0x11 Engine-Ziele)`. E2-03 ersetzt den ursprünglich geplanten automatischen 2-s-Rechte-Retry: Rechteverlust oder unbestätigte Verfahren sperren Steuerung bis zu einer neuen GATT-Verbindung und ausdrücklicher Freigabe. Daten-Reconnect setzt keine alten Widerstandsziele fort. Nie `0x01 Reset`; Einzelheiten und Stop-Grenzen in `02-bluetooth.md#e2-03-rollenschaltung`.

## 6. Tests (Details: `10-testing.md`)

- Physik: stationäre Geschwindigkeiten (Tabelle oben), Energieerhaltung bergab ohne Leistung (v steigt plausibel, Terminalgeschwindigkeit).
- Gangmodell: Grenzen (1/24), Mehrfachshift, Persistenz des letzten Gangs.
- Strategie A: Monotonie (höherer Gang ⇒ höherer `gradeEff`), Clamping, Encoder-Bytes.
- Sim-Trainer (`sim/`) implementiert das Trainer-Modell inverse: liefert Watt aus Kadenz × Widerstand, damit der ganze Regelkreis im Sim-Modus geschlossen ist.
- Golden-Fahrten (`fixtures/rides/`) und Property-Tests (mehr Watt ⇒ nie langsamer, höherer Gang ⇒ nie leichter, Drafting ⇒ nie langsamer) laut `10-testing.md`.
