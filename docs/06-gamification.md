# 06 – Gamification & Ökonomie

Ab Tag eins Teil der Architektur. Clientseitig hört `game/` auf `RideEvent`s und zeigt **vorläufige** Werte live an; **verbindlich** (autoritativ) sind XP, Level, Volts-Kontostand und Inventar auf dem Server (ADR-005). `game/` schreibt nie in `RideState`.

## Volts – die Ingame-Währung

Volts sind Voltonauts Währung, vergleichbar mit Zwifts Ingame-Währung: man verdient sie durch Leistung auf dem Rad und gibt sie im Garage-Shop für Räder, Laufräder und Kleidung aus.

### Darstellung: Blitze ⚡

- Symbol ist ein **kleiner Blitz**. HUD: animierter Blitz-Zähler oben rechts; bei jedem verdienten Volt-Paket „fliegt" ein Blitz in den Zähler (Partikel + kurzer Glow, max. 1 Animation/s, damit es nicht nervt).
- **In-World-Pickups:** schwebende, rotierende Blitz-Sprites/Meshes über der Straße (Emissive-Material, leichte Bloom-Aura, Sammel-Sound). Positionen deterministisch pro Route (`route.seed`), z. B. alle 1–2 km und auf Bergwertungen dichter. Einsammeln = Fahrer passiert die Distanzmarke (keine Lenkung nötig).
- Zusammenfassung nach der Fahrt: Blitz-Regen-Animation mit Aufschlüsselung (Arbeit, Höhenmeter, Pickups, Boni).
- Asset: eigenes Low-Poly-Blitz-Mesh (Blender, CC0) + Icon als SVG; Farbe Elektrisch-Gelb `#FFD60A` mit Cyan-Akzent.

### Verdienformel (pro Fahrt, Server berechnet nach)

```
volts_work   = floor(arbeit_kJ × 1.0)            // 1 Volt pro kJ mechanischer Arbeit
volts_climb  = floor(hoehenmeter × 1.5)          // Bergbonus
volts_pickup = Σ eingesammelte Blitze × 10       // nur Pickups, deren Distanzmarke laut Ride-Samples passiert wurde
volts_bonus  = Segment-PB 50 · Badge 100–500 · erste Fahrt des Tages 25
volts_total  = min(volts_work + volts_climb + volts_pickup + volts_bonus, tageslimit = 3000)
```

Größenordnung: 1 h @ 180 W ≈ 650 kJ, 300 Hm, 8 Pickups → ≈ 650 + 450 + 80 = **≈ 1 180 Volts/h**.
Regeln: keine Volts im Sim-Modus und ohne echten Leistungsmesser; Abfahrt ohne Treten bringt 0 kJ. Werte sind Startwerte ⚠️, nach 2–3 Wochen Nutzung nachjustieren.

### Shop & Freischalt-Ökonomie

| Seltenheit | Preis (Volts) | ≈ Fahrstunden | Zusätzliche Bedingung |
| ---------- | ------------- | ------------- | --------------------- |
| common     | 1 500         | ~1,3          | –                     |
| rare       | 6 000         | ~5            | Level ≥ 5             |
| epic       | 20 000        | ~17           | Level ≥ 15            |
| legendary  | 60 000        | ~50           | Level ≥ 30 oder Badge |

- Manche Items sind **nicht kaufbar**, sondern nur über Level, Badges oder Distanz-Meilensteine erreichbar (z. B. KOM-Trikot nur per `kom-hunter`).
- Käufe sind endgültig (kein Wiederverkauf in v1); Kauf ist eine **Server-Transaktion** (Kontostand prüfen, abbuchen, Inventar ergänzen – atomar).
- Kontostand und Transaktionen als Ledger (`volts_ledger`), Kontostand = Summe; nie direkt überschreiben.

```ts
type UnlockRule =
  | { kind: "default" }
  | { kind: "level"; level: number }
  | { kind: "badge"; badgeId: string }
  | { kind: "distanceTotal"; km: number }
  | { kind: "shop"; priceVolts: number; minLevel?: number };
```

### Power-ups (optional, später)

Seltene Pickups neben den Blitzen (Aero-Boost, Leichtgewicht, Windschatten-Magnet, `04-world-3d.md` §7). Aktivierung per Play-Power-up-Taste; physikrelevant → im Ride-Upload protokolliert, serverseitig nachgerechnet; Segmentzeiten mit Power-up werden getrennt markiert. Kosten nichts, bringen keine Volts.

## XP & Level

- XP pro Fahrt: **20 XP/km** + **2 XP/Hm** + **1 XP/Minute** + Boni (Segment-PB 50, Badge 100–500, erste Fahrt des Tages 25).
- XP nur bei `powerW > 30` und `cadence > 20`; Sim-Modus vergibt keine XP.
- Level-Kurve (kumulierte XP, ab der Level n erreicht ist): `xpForLevel(n) = round(500 · n^1.6)` → Level 2 ≈ 1 500 XP ≈ 1 h; Level 10 ≈ 20 000 XP ≈ 14 h. Max. Level 50 zunächst. ⚠️ justieren.
- Jedes Level vergibt mindestens ein Item oder Volts-Bonus (`game/data/levels.json`, Server und Client teilen die Datei).

## Badges / Achievements (Startliste)

| ID                                                                                                                                                                | Bedingung                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `first-ride`                                                                                                                                                      | erste Fahrt beendet               |
| `hour-of-power`                                                                                                                                                   | 60 min am Stück                   |
| `century-km`                                                                                                                                                      | 100 km gesamt                     |
| `everest-lite`                                                                                                                                                    | 1 000 Hm in einer Woche           |
| `kom-hunter`                                                                                                                                                      | KOM-Segment 5× gefahren           |
| `streak-7`                                                                                                                                                        | 7 Tage in Folge gefahren          |
| `gear-masher`                                                                                                                                                     | 200 Schaltvorgänge in einer Fahrt |
| `bolt-collector`                                                                                                                                                  | 100 Blitz-Pickups gesamt          |
| `night-owl`                                                                                                                                                       | Fahrt nach 22 Uhr (Lokalzeit)     |
| Badges als Daten + reine Prädikat-Funktion `(ctx: BadgeContext) => boolean` in `shared/`, damit Client (Vorschau) und Server (verbindlich) dieselbe Logik nutzen. |

## Segmente

- Definition in der Route (`SegmentDef`: `sprint` | `kom` | `lap`, `startM`–`endM`).
- Erkennung in `engine` über `segment.entered/exited`. Die vorhandenen Ereigniszeiten markieren das Tickende (0,05 s), nicht interpolierte Grenzübertritte. [E6-01](specs/E6-01-visible-segments.md) zeigt daraus eine ausdrücklich vorläufige Spielsession-Vorschau mit laufender Zeit, Restdistanz und letztem Abschluss je Segment und Runde. Auto-Pause hält die Enginezeit und damit die laufende Segmentzeit an. Zeitlücken, fehlende Grenzen und Engineausfall entwerten betroffene Versuche.
- Interpolierte Grenzzeiten, Live-Delta zur bestätigten PB und serverseitige PBs bleiben Zielzustand. Die Vorschau gehört nicht zum gewählten Aufnahmefenster und schreibt weder PBs noch Belohnungen, Aufnahmeresultate oder Exporte.
- PBs liegen auf dem Server (pro Account), lokal gecacht. Ghost der PB-Fahrt (1-Hz-Positionen) später.

## Fahrtzusammenfassung

Distanz, Zeit, Hm, Ø/Max-Watt, Ø-Kadenz, Ø/Max-Puls, kJ, XP, Volts (vorläufig → nach Sync „bestätigt"), neue Badges/Unlocks/PBs.

## Speicherung (ADR-005)

- **Server (autoritativ):** Account, Rider-Profil, Inventar, XP/Level, Volts-Ledger, Badges, PBs, Fahrt-Zusammenfassungen (+ komprimierte 1-Hz-Samples für Plausibilitätsprüfung, Aufbewahrung begrenzt).
- **Client (Cache + Outbox):** IndexedDB-Spiegel von Profil/Inventar/Progression für Offline-Start; abgeschlossene Fahrten landen in einer **Outbox** und werden beim nächsten Online-Kontakt hochgeladen (idempotent über `rideId` = UUID).
- **Gastmodus:** ohne Account fahrbar; Fahrten bleiben lokal und können innerhalb von 30 Tagen nach Account-Erstellung nachträglich hochgeladen werden.
