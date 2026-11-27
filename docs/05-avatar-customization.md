# 05 – Avatar & Customizing

## Ziel

Ein sichtbarer Fahrer auf einem Rad, der **im Takt der echten Kadenz** tritt, sich mit Tempo/Steigung natürlich verhält (Wiegetritt am Berg, Ducken bergab) und dessen Teile austauschbar sind.

## Modellaufbau

- **Rad** (`bike.glb`): separate Nodes `frame`, `fork`, `wheel_front`, `wheel_rear`, `crank` (Pivot im Tretlager), `pedal_l`, `pedal_r`, `handlebar`, `saddle`. Rahmen und Laufräder sind **Slots**: andere GLBs werden an Anker-Nodes (`anchor_wheel_front`, …) gehängt.
- **Fahrer** (`rider.glb`): ein Skinned Mesh, humanoides Skelett (Mixamo-kompatible Bone-Namen erleichtern Tools), Teile als getrennte Meshes am selben Skelett: `body`(Haut), `jersey`, `bibs`, `helmet`, `shoes`, `glasses`. Austausch = Mesh im Slot ersetzen, Skelett bleibt.
- Farben über Material-Parameter (Masken-Textur: R/G/B-Kanäle = Primär/Sekundär/Akzent), nicht über neue Texturen → Trikot-Designs = Maske + 2–3 Farben.

## Animation (prozedural, nicht Keyframe)

1. **Kurbelwinkel** `φ` integriert aus Kadenz: `φ += 2π · cadenceRpm/60 · dt` (geglättet, damit Kadenzsprünge nicht ruckeln). Kurbel-Node dreht sich mit `φ`.
2. **Beine per Two-Bone-IK** (Hüfte→Knie→Fuß): Fußziel = Pedalposition; Knie-Pole nach vorne. Fußgelenk leichter Winkel abhängig von `φ` (Ankling).
3. **Hände** per IK an Lenker (Oberlenker/Unterlenker je nach Tempo/Pose).
4. **Oberkörper:** Basis-Pose; leichte Hüft-/Schulter-Wippe mit `sin(φ)` proportional zu Leistung; Wiegetritt-Pose bei `gradePct > 6` und `powerW > 1.3 × FTP-Schätzung` (Blend 0,5 s).
5. **Laufräder** drehen mit virtuellem Tempo, nicht mit Kadenz. Rollen ohne Treten → Beine stehen still (Freilauf), Pedale bei 3/9 Uhr.
6. Kopf schaut leicht in Kurvenrichtung; Rad neigt sich minimal in Kurven (`bank ≈ atan(v²/(r·g))`, geclampt 8°).

Vorteil prozedural: exakte Kadenz-Synchronisierung, keine Mixamo-Abhängigkeit, funktioniert mit jedem Rahmen (Sattelhöhe/Reach als Parameter).

## Customizing

```ts
interface ItemDef {
  id: string;
  slot: "skin" | "jersey" | "helmet" | "shoes" | "glasses" | "frame" | "wheels";
  name: string;
  assetRef: string;
  colorable: number;
  unlock: UnlockRule;
  rarity: "common" | "rare" | "epic" | "legendary";
  priceVolts?: number;
}
```

- Die kanonischen Typen und strikten Zod-Schemas liegen in `packages/shared/src/avatarCatalog.ts`. `ItemDef` enthält keine Konto- oder Besitzdaten.
- Der Start-Katalog liegt in `packages/rules/src/avatarCatalogData.ts`. Die provisorischen `assetRef`-Werte verweisen auf die vorhandene prozedurale Vorschau. Finale GLBs ersetzen sie später.
- `AvatarConfig` referenziert nur IDs und Farben. Besitz prüft später der Server (`inventory/`), der Client nur gegen den Cache.
- Körpergröße aus dem Rider-Profil (`heightCm`) skaliert das Skelett. Sattelhöhe und Reach folgen daraus.
- [E7-01](specs/E7-01-garage-shop-foundation.md) integriert den Tab „Garage / Shop" in das bestehende Fahrtmenü. Slot- und Item-Auswahl ändert die provisorische 3D-Vorschau. Preise und Freischaltbedingungen sind sichtbar. Käufe bleiben deaktiviert, weil Server-Inventar und Volts-Buchung fehlen. Die Vorschau wird weder gespeichert noch als Besitz dargestellt.
- [E7-06](specs/E7-06-garage-showroom.md) macht die Vorschau zur Studio-Szene. Boden, Drehteller und Studio-Licht rendern weiterhin im Preview-Worker. Die Orbit-Kamera gehört dem Hauptthread. Avatar-Winkel und Auto-Drehung bleiben im Worker getrennt. Maus, Touch, Stift, Pfeiltasten und `Home` steuern die Kamera. Bei Reduced Motion bleibt die manuelle Steuerung aktiv und die Auto-Drehung aus. Der Fotomodus nutzt denselben Canvas und lädt ihn im Worker als PNG. Stand: implementiert und softwaregeprüft. Henrys Sichtprüfung und Bereitstellung bleiben offen.
- **Rad (E4-09):** Das Laufzeit-Rad ist prozedural (`apps/web/src/avatar/bike*.ts`). Rahmen und Laufräder sind Daten in `bikeSpecs.ts` (`FRAME_SPECS`: Geometrietabelle, Rohrquerschnitte, Reifen, Lenkerbreite, Dekor; `WHEEL_SPECS`: Felgenprofil, Speichen, Scheibe, Finish). Katalog-Items verweisen per `assetRef: procedural://bike/<frame|wheels>/<key>` darauf. Eine neue Option braucht nur einen Spec-Eintrag und ein Katalog-Item. `frameColor` färbt den Klarlack. Unbekannte Refs fallen auf Race/Alu zurück, sodass später auch GLB-Refs ohne Absturz möglich sind.
- **Fahrer (E4-10):** Der Laufzeit-Fahrer ist prozedural (`apps/web/src/avatar/rider*.ts`) und ein Skinned Mesh: ein Skelett mit 22 Mixamo-benannten Knochen (`riderRig.ts`) und ein Mesh pro Material (Trikot/Hose, Haut, Socken, Schuhe, Dunkles, Helm, Gläser). Die IK aus `pose.ts` stellt jedes Bild die Knochen, die Geometrie wird nur bei einem Kit-Wechsel neu gebaut. Körper, Gliedmaßen, Kopf, Helm und Schuhe sind glatte parametrische Flächen. Trikotdesign, Reißverschluss, Taschen, Nähte, Gesicht, Haare, Helmbelüftung und Schuhriemen sind prozedurale Texturen (`riderKitTexture.ts`, `riderGearTexture.ts`), kosten also keine Dreiecke. Trikots, Helme, Schuhe und Brillen sind Daten in `riderSpecs.ts`. Katalog-Items verweisen per `assetRef: procedural://rider/<jersey|helmet|shoes|glasses>/<key>` darauf; unbekannte Refs fallen auf Classic, Standard, Weiß und keine Brille zurück.
- Hautton: direkte Hex-Farbauswahl in der Vorschau. Die bisherigen Preset-IDs bleiben als Kompatibilitätsdaten erhalten, werden aber nicht als Namen angezeigt.

## Start-Katalog (E7)

| Slot      | Anzahl                                   | Default             |
| --------- | ---------------------------------------- | ------------------- |
| Haut      | 6 direkte Farben                         | `#c98d68`           |
| Trikot    | 6 Designs × Farben                       | „Voltonaut Classic" |
| Helm      | 3                                        | Standard            |
| Schuhe    | 2                                        | weiß                |
| Rahmen    | 3 (Race, Aero, Gravel)                   | Race                |
| Laufräder | 4 (Alu, Carbon flach, Carbon tief, Disc) | Alu                 |
| Brille    | 2 + keine                                | keine               |

## Offene Designfrage

Sollen Rahmen/Laufräder **Spielwerte** haben (Gewicht/CdA wie bei Zwift)? Vorschlag: v1 rein kosmetisch, Werte im Datenmodell vorgesehen, später per Einstellung aktivierbar. → `open-questions.md`.
